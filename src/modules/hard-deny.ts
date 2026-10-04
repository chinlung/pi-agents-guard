import {
	enumerateCommands,
	extractWriteTargets,
	type ParsedCommand,
} from "../lib/bash.js";
import { matchesProtected, type PathResolver } from "../lib/paths.js";
import type { Decision, HardDenyOptions } from "../types.js";

/** Tools whose `path` argument is a write and must be gated. */
const GATED_PATH_TOOLS: ReadonlySet<string> = new Set([
	"write",
	"edit",
	"ast_grep_replace",
]);

function tokenMatches(pattern: string, token: string): boolean {
	if (!pattern.includes("*") && !pattern.includes("?"))
		return pattern === token;
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");
	return new RegExp(`^${escaped}$`).test(token);
}

/**
 * Rule tokens must appear in order within the command's tokens; extra arguments
 * anywhere are allowed. Same subsequence semantics pi-guard uses, so a rule
 * like "git add -A" also covers "git add -A --verbose" without enumerating
 * flags, while token equality keeps it from covering "git add -Apatch".
 */
function isSubsequence(needle: string[], haystack: string[]): boolean {
	let index = 0;
	for (const token of haystack) {
		const pattern = needle[index];
		if (pattern !== undefined && tokenMatches(pattern, token)) index += 1;
		if (index >= needle.length) break;
	}
	return index === needle.length;
}

function commandMatchesRule(command: ParsedCommand, rule: string): boolean {
	const [ruleName, ...ruleArgs] = rule
		.split(/\s+/)
		.filter((part) => part !== "");
	if (ruleName === undefined) return false;
	if (!tokenMatches(ruleName, command.name)) return false;
	return ruleArgs.length === 0 || isSubsequence(ruleArgs, command.args);
}

function blockReason(what: string, detail: string): string {
	return [
		`[agents-guard/hard-deny] 已阻擋：${what}`,
		`  ${detail}`,
		"  這是 AGENTS.md 的 MUST 級防線，不提供單次放行選項。",
		"  若確實需要此操作，請由操作者手動執行，或調整 agents-guard 的 hardDeny 設定。",
	].join("\n");
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function decideHardDeny(
	toolName: string,
	input: Record<string, unknown>,
	opts: HardDenyOptions,
	resolver: PathResolver,
): Decision {
	if (GATED_PATH_TOOLS.has(toolName)) {
		const path = asString(input.path);
		if (path === undefined) return { kind: "pass" };
		const pattern = matchesProtected(path, opts.protectedPaths, resolver);
		if (pattern !== null) {
			return {
				kind: "block",
				reason: blockReason(
					`${toolName} 寫入受保護路徑`,
					`path=${path}  命中規則=${pattern}`,
				),
			};
		}
		return { kind: "pass" };
	}

	if (toolName !== "bash") return { kind: "pass" };

	const command = asString(input.command);
	if (command === undefined) return { kind: "pass" };

	// A syntax error does not stop the check: whatever did parse is still
	// judged, so a deliberate error cannot hide an earlier denied command.
	const { commands } = enumerateCommands(command);
	for (const parsed of commands) {
		for (const rule of opts.commands) {
			if (commandMatchesRule(parsed, rule)) {
				const rendered = `${parsed.name} ${parsed.args.join(" ")}`.trim();
				return {
					kind: "block",
					reason: blockReason(
						"命令命中 hard-deny 清單",
						`命令=${rendered}  命中規則=${rule}`,
					),
				};
			}
		}
	}

	const { targets } = extractWriteTargets(command);
	for (const target of targets) {
		const pattern = matchesProtected(target, opts.protectedPaths, resolver);
		if (pattern !== null) {
			return {
				kind: "block",
				reason: blockReason(
					"命令寫入受保護路徑",
					`目標=${target}  命中規則=${pattern}`,
				),
			};
		}
	}

	return { kind: "pass" };
}
