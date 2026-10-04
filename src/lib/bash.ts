import type { Command, Redirect, Word } from "unbash";
import { parse } from "unbash";

export interface ParsedCommand {
	name: string;
	args: string[];
}

/** Redirect operators that may truncate or write to the destination file. */
export const WRITE_REDIRECT_OPERATORS: ReadonlySet<string> = new Set([
	">",
	">>",
	">|",
	"&>",
	"&>>",
	"<>",
]);

/** Operators whose destination may be a file OR a descriptor number. */
const AMBIGUOUS_REDIRECT_OPERATORS: ReadonlySet<string> = new Set([">&", "<&"]);

/** Wrappers whose trailing tokens are themselves a command to inspect. */
const PREFIX_WRAPPERS: ReadonlySet<string> = new Set([
	"sudo",
	"doas",
	"env",
	"nohup",
	"time",
	"nice",
	"ionice",
	"stdbuf",
	"xargs",
	"command",
	"exec",
	"timeout",
]);

/** Wrappers that take the command as a single string argument after a flag. */
const STRING_PAYLOAD_WRAPPERS: ReadonlySet<string> = new Set([
	"bash",
	"sh",
	"zsh",
	"dash",
	"ash",
	"ksh",
]);

const MAX_EXPANSION_DEPTH = 4;

function wordValue(word: Word | undefined): string | undefined {
	if (word === undefined) return undefined;
	const value = word.value ?? word.text;
	return typeof value === "string" && value !== "" ? value : undefined;
}

function collectCommandNodes(node: unknown, out: Command[]): void {
	if (node === null || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const item of node) collectCommandNodes(item, out);
		return;
	}
	const record = node as Record<string, unknown>;
	if (record.type === "Command") out.push(node as Command);
	for (const [key, value] of Object.entries(record)) {
		if (key === "type" || key === "pos" || key === "end") continue;
		collectCommandNodes(value, out);
	}
	// unbash's Word keeps `value`/`parts` as non-enumerable prototype getters, so
	// enumerating own properties cannot see them and a command nested in `$(...)`
	// would be missed entirely. Verified across all 20 node types: Word is the
	// only one with a substantive prototype getter.
	const parts = (node as { parts?: unknown }).parts;
	if (parts !== undefined) collectCommandNodes(parts, out);
}

/**
 * Parse and collect Command nodes, reporting syntax errors without discarding
 * what did parse. unbash reports errors on `Script.errors` rather than throwing.
 *
 * Returning the partial result matters for safety: discarding everything on a
 * syntax error would make `git add -A ; echo 'unterminated` a bypass.
 */
function parseCommandNodes(source: string): {
	nodes: Command[];
	parseFailed: boolean;
} {
	const nodes: Command[] = [];
	try {
		const ast = parse(source);
		collectCommandNodes(ast, nodes);
		const errors = (ast as { errors?: unknown }).errors;
		return { nodes, parseFailed: Array.isArray(errors) && errors.length > 0 };
	} catch {
		return { nodes: [], parseFailed: true };
	}
}

function toParsed(command: Command): ParsedCommand | null {
	const name = wordValue(command.name);
	if (name === undefined) return null;
	const args: string[] = [];
	for (const suffix of command.suffix) {
		const value = wordValue(suffix);
		if (value !== undefined) args.push(value);
	}
	return { name, args };
}

/**
 * Index within `args` of the inner command's first token, for wrappers that
 * consume leading tokens of their own (`timeout 5 cmd`, `nice -n 5 cmd`,
 * `env FOO=1 cmd`). Returns -1 when no inner command is present.
 */
function innerCommandStart(name: string, args: string[]): number {
	if (name === "timeout") {
		return args.findIndex(
			(arg) => !arg.startsWith("-") && !/^\d+(\.\d+)?[smhd]?$/.test(arg),
		);
	}
	if (name === "nice" || name === "ionice" || name === "stdbuf") {
		let index = 0;
		while (index < args.length && args[index]?.startsWith("-")) index += 2;
		return index < args.length ? index : -1;
	}
	if (name === "env") {
		return args.findIndex((arg) => !arg.includes("=") && !arg.startsWith("-"));
	}
	return args.findIndex((arg) => !arg.startsWith("-"));
}

function expand(
	command: ParsedCommand,
	depth: number,
	out: ParsedCommand[],
): void {
	out.push(command);
	if (depth >= MAX_EXPANSION_DEPTH) return;

	if (STRING_PAYLOAD_WRAPPERS.has(command.name)) {
		const flagIndex = command.args.findIndex(
			(arg) => arg === "-c" || arg === "-lc" || arg === "-ic",
		);
		const payload = flagIndex >= 0 ? command.args[flagIndex + 1] : undefined;
		if (payload !== undefined) {
			for (const inner of enumerateCommands(payload, depth + 1).commands)
				out.push(inner);
		}
		return;
	}

	if (PREFIX_WRAPPERS.has(command.name)) {
		const start = innerCommandStart(command.name, command.args);
		if (start >= 0 && start < command.args.length) {
			const innerName = command.args[start];
			if (innerName !== undefined) {
				expand(
					{ name: innerName, args: command.args.slice(start + 1) },
					depth + 1,
					out,
				);
			}
		}
	}
}

export function enumerateCommands(
	source: string,
	depth = 0,
): { commands: ParsedCommand[]; parseFailed: boolean } {
	const { nodes, parseFailed } = parseCommandNodes(source);

	const out: ParsedCommand[] = [];
	for (const node of nodes) {
		const parsed = toParsed(node);
		if (parsed !== null) expand(parsed, depth, out);
	}
	return { commands: out, parseFailed };
}

function redirectTarget(redirect: Redirect): string | undefined {
	const target = wordValue(redirect.target);
	if (target === undefined) return undefined;
	if (WRITE_REDIRECT_OPERATORS.has(redirect.operator)) return target;
	if (AMBIGUOUS_REDIRECT_OPERATORS.has(redirect.operator)) {
		// `2>&1` duplicates a descriptor and names no file; `cmd >& out` names one.
		return /^\d+$/.test(target) ? undefined : target;
	}
	return undefined;
}

/** Destination-argument positions for commands that write without a redirect. */
function commandWriteTargets(command: ParsedCommand): string[] {
	const positional = command.args.filter((arg) => !arg.startsWith("-"));
	const last = positional[positional.length - 1];
	switch (command.name) {
		case "tee":
			return positional;
		case "cp":
		case "mv":
		case "install":
		case "rsync":
		case "ln":
			return positional.length >= 2 && last !== undefined ? [last] : [];
		case "sed":
		case "perl":
		case "ruby": {
			const inPlace = command.args.some(
				(arg) => arg === "-i" || arg.startsWith("-i.") || arg.startsWith("-pi"),
			);
			return inPlace ? positional : [];
		}
		case "truncate":
		case "touch":
			return positional;
		default:
			return [];
	}
}

export function extractWriteTargets(source: string): {
	targets: string[];
	parseFailed: boolean;
} {
	const { nodes, parseFailed } = parseCommandNodes(source);

	const targets = new Set<string>();
	for (const node of nodes) {
		for (const redirect of node.redirects) {
			const target = redirectTarget(redirect);
			if (target !== undefined) targets.add(target);
		}
	}
	for (const command of enumerateCommands(source).commands) {
		for (const target of commandWriteTargets(command)) targets.add(target);
	}
	return { targets: [...targets], parseFailed };
}
