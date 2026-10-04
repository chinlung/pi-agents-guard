import {
	type AgentsGuardConfig,
	type ConfigSource,
	isModuleName,
	MODULE_NAMES,
	type ModuleName,
	type Provenance,
} from "./types.js";

export const DEFAULT_HARD_DENY_COMMANDS: string[] = [
	"git add -A",
	"git add --all",
	"git add .",
	"git commit -a*",
	"git push --force*",
	"git push -f",
	"git push --delete",
	"sudo",
	"npm publish",
	"gh release delete",
	"crontab",
	"at",
	"chown",
];

export const DEFAULT_PROTECTED_PATHS: string[] = [
	"**/.pi/agent/settings.json",
	"**/.pi/agent/AGENTS.md",
	"**/.pi/agent/SYSTEM.md",
	"**/.pi/agent/APPEND_SYSTEM.md",
	"**/.pi/agent/keybindings.json",
	"**/.pi/agent/auth.json",
	"**/.pi/agent/trust.json",
	"**/.pi/agent/npm/**",
	"**/.pi/agent/extensions/**",
	"**/.pi/agent/state/agents-guard/**",
	"**/.pi/settings.json",
	"**/.pi/extensions/**",
	"**/.zshrc",
	"**/.bashrc",
	"**/.bash_profile",
	"**/.profile",
	"**/.zshenv",
	"**/.git/hooks/**",
	"**/.env*",
	"**/*.pem",
	"**/id_rsa*",
	"**/.netrc",
	"**/.npmrc",
];

export const DEFAULT_WEAK_MODEL_PATTERNS: string[] = [
	"haiku",
	"mini",
	"flash",
	"lite",
	"small",
];

export const DEFAULT_EXTERNAL_CLI_AGENTS: string[] = [
	"codex-exec",
	"codex-exec-writer",
	"claude-code",
	"claude-code-writer",
	"cursor-agent",
	"cursor-agent-writer",
];

export const DEFAULT_NATIVE_ONLY_OPTIONS: string[] = [
	"model",
	"context",
	"acceptance",
	"outputSchema",
	"toolBudget",
	"fast",
	"skill",
	"mission",
];

export const DEFAULT_REVIEW_INTENT_PATTERNS: string[] = [
	"review",
	"audit",
	"security",
	"threat",
];

export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 14_400_000; // 4h

export const DEFAULT_BLOCKED_GIT_SUBCOMMANDS: string[] = [
	"checkout",
	"switch",
	"rebase",
	"merge",
	"reset",
	"stash",
	"restore",
	"clean",
	"apply",
	"cherry-pick",
	"revert",
	"commit",
	"worktree remove",
];

export const DEFAULT_BLOCKED_TOOLS: string[] = [
	"write",
	"edit",
	"ast_grep_replace",
];

export const DEFAULT_MAX_APPEND_BYTES = 2048;
export const DEFAULT_CHECK_CI = true;

export const DEFAULT_FOLLOW_UP = false;
export const DEFAULT_MAX_FOLLOW_UPS_PER_SESSION = 2;

/**
 * Per-module array-valued option keys that a layer may override wholesale.
 * Adding a new list-typed module option means adding one entry here; the
 * merge and serialize logic below stay generic instead of special-casing
 * each module name.
 */
const ARRAY_FIELDS: Record<ModuleName, readonly string[]> = {
	"hard-deny": ["commands", "protectedPaths"],
	"subagent-policy": [
		"weakModelPatterns",
		"externalCliAgents",
		"nativeOnlyOptions",
		"reviewIntentPatterns",
	],
	"writer-lock": ["blockedGitSubcommands", "blockedTools"],
	"git-evidence": [],
	"completion-diff-recheck": [],
};

/** Per-module number-valued option keys, same generalization as ARRAY_FIELDS. */
const NUMBER_FIELDS: Record<ModuleName, readonly string[]> = {
	"hard-deny": [],
	"subagent-policy": [],
	"writer-lock": ["heartbeatTimeoutMs"],
	"git-evidence": ["maxAppendBytes"],
	"completion-diff-recheck": ["maxFollowUpsPerSession"],
};

/** Per-module boolean-valued option keys, same generalization as ARRAY_FIELDS. */
const BOOLEAN_FIELDS: Record<ModuleName, readonly string[]> = {
	"hard-deny": [],
	"subagent-policy": [],
	"writer-lock": [],
	"git-evidence": ["checkCi"],
	"completion-diff-recheck": ["followUp"],
};

export const DEFAULT_CONFIG: AgentsGuardConfig = {
	enabled: true,
	modules: {
		"hard-deny": {
			enabled: true,
			commands: DEFAULT_HARD_DENY_COMMANDS,
			protectedPaths: DEFAULT_PROTECTED_PATHS,
		},
		"subagent-policy": {
			enabled: true,
			weakModelPatterns: DEFAULT_WEAK_MODEL_PATTERNS,
			externalCliAgents: DEFAULT_EXTERNAL_CLI_AGENTS,
			nativeOnlyOptions: DEFAULT_NATIVE_ONLY_OPTIONS,
			reviewIntentPatterns: DEFAULT_REVIEW_INTENT_PATTERNS,
		},
		"writer-lock": {
			enabled: true,
			heartbeatTimeoutMs: DEFAULT_HEARTBEAT_TIMEOUT_MS,
			blockedGitSubcommands: DEFAULT_BLOCKED_GIT_SUBCOMMANDS,
			blockedTools: DEFAULT_BLOCKED_TOOLS,
		},
		"git-evidence": {
			enabled: true,
			maxAppendBytes: DEFAULT_MAX_APPEND_BYTES,
			checkCi: DEFAULT_CHECK_CI,
		},
		"completion-diff-recheck": {
			enabled: true,
			followUp: DEFAULT_FOLLOW_UP,
			maxFollowUpsPerSession: DEFAULT_MAX_FOLLOW_UPS_PER_SESSION,
		},
	},
};

export function parseShorthand(raw: string): ConfigPatch | null {
	const trimmed = raw.trim();
	if (trimmed === "") return null;
	if (trimmed === "off") return { enabled: false };
	if (trimmed === "on") return { enabled: true };

	const names = trimmed
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part !== "");
	if (names.length === 0 || !names.every(isModuleName)) return null;

	const allowed = new Set(names as ModuleName[]);
	const modules: ConfigPatch["modules"] = {};
	for (const name of MODULE_NAMES)
		modules[name] = { enabled: allowed.has(name) };
	return { enabled: true, modules };
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asStringArray(value: unknown): string[] | null {
	return Array.isArray(value) && value.every((item) => typeof item === "string")
		? (value as string[])
		: null;
}

/**
 * One layer's contribution. Deliberately not `Partial<AgentsGuardConfig>`:
 * `Partial` only makes the top-level keys optional, so a caller could not
 * supply a single module without naming all five.
 */
export interface ConfigPatch {
	enabled?: boolean;
	modules?: Partial<
		Record<
			ModuleName,
			{
				enabled?: boolean;
				commands?: string[];
				protectedPaths?: string[];
				weakModelPatterns?: string[];
				externalCliAgents?: string[];
				nativeOnlyOptions?: string[];
				reviewIntentPatterns?: string[];
				heartbeatTimeoutMs?: number;
				blockedGitSubcommands?: string[];
				blockedTools?: string[];
				maxAppendBytes?: number;
				checkCi?: boolean;
				followUp?: boolean;
				maxFollowUpsPerSession?: number;
			}
		>
	>;
}

function validateLayer(
	value: unknown,
	label: string,
	warnings: string[],
): ConfigPatch {
	const root = asRecord(value);
	if (root === null) {
		warnings.push(
			`agents-guard: ignoring ${label} config — expected an object`,
		);
		return {};
	}
	const patch: ConfigPatch = {};
	if (typeof root.enabled === "boolean") patch.enabled = root.enabled;

	const modules = asRecord(root.modules);
	if (modules !== null) {
		patch.modules = {};
		for (const [key, raw] of Object.entries(modules)) {
			if (!isModuleName(key)) {
				warnings.push(
					`agents-guard: ignoring unknown module "${key}" in ${label} config`,
				);
				continue;
			}
			const entry = asRecord(raw);
			if (entry === null) {
				warnings.push(
					`agents-guard: ignoring module "${key}" in ${label} config — expected an object`,
				);
				continue;
			}
			const target: {
				enabled?: boolean;
				commands?: string[];
				protectedPaths?: string[];
				weakModelPatterns?: string[];
				externalCliAgents?: string[];
				nativeOnlyOptions?: string[];
				reviewIntentPatterns?: string[];
				heartbeatTimeoutMs?: number;
				blockedGitSubcommands?: string[];
				blockedTools?: string[];
				maxAppendBytes?: number;
				checkCi?: boolean;
				followUp?: boolean;
				maxFollowUpsPerSession?: number;
			} = {};
			if (typeof entry.enabled === "boolean") target.enabled = entry.enabled;
			for (const field of ARRAY_FIELDS[key]) {
				const value = asStringArray(entry[field]);
				if (value !== null) {
					(target as Record<string, string[]>)[field] = value;
				}
			}
			for (const field of NUMBER_FIELDS[key]) {
				const value = entry[field];
				if (typeof value === "number") {
					(target as Record<string, number>)[field] = value;
				}
			}
			for (const field of BOOLEAN_FIELDS[key]) {
				const value = entry[field];
				if (typeof value === "boolean") {
					(target as Record<string, boolean>)[field] = value;
				}
			}
			patch.modules[key] = target;
		}
	}
	return patch;
}

/**
 * Reads an array-valued module option by name. `field` must be one of
 * ARRAY_FIELDS[name] — the array-valued keys that module's own config type
 * declares — so this type-erasing read cannot observe an unrelated property.
 */
function readArrayField(
	moduleConfig: unknown,
	field: string,
): string[] | undefined {
	// SAFETY: see readArrayField's doc comment above — callers only ever pass
	// a `field` drawn from ARRAY_FIELDS[name], and that field is always typed
	// as `string[]` on every module config that declares it.
	const value = (moduleConfig as Record<string, unknown>)[field];
	return Array.isArray(value) ? (value as string[]) : undefined;
}

/**
 * Writes an array-valued module option by name, under the same invariant as
 * readArrayField above.
 */
function writeArrayField(
	moduleConfig: unknown,
	field: string,
	value: string[],
): void {
	// SAFETY: see readArrayField's doc comment — `field` is always one of
	// ARRAY_FIELDS[name].
	(moduleConfig as Record<string, unknown>)[field] = value;
}

/**
 * Reads/writes a number- or boolean-valued module option by name, under the
 * same invariant as readArrayField/writeArrayField: `field` must be one of
 * NUMBER_FIELDS[name]/BOOLEAN_FIELDS[name] — the scalar keys that module's
 * own config type declares.
 */
function readNumberField(
	moduleConfig: unknown,
	field: string,
): number | undefined {
	// SAFETY: see readArrayField's doc comment — same invariant, scalar type.
	const value = (moduleConfig as Record<string, unknown>)[field];
	return typeof value === "number" ? value : undefined;
}

function writeNumberField(
	moduleConfig: unknown,
	field: string,
	value: number,
): void {
	// SAFETY: see readArrayField's doc comment.
	(moduleConfig as Record<string, unknown>)[field] = value;
}

function readBooleanField(
	moduleConfig: unknown,
	field: string,
): boolean | undefined {
	// SAFETY: see readArrayField's doc comment — same invariant, scalar type.
	const value = (moduleConfig as Record<string, unknown>)[field];
	return typeof value === "boolean" ? value : undefined;
}

function writeBooleanField(
	moduleConfig: unknown,
	field: string,
	value: boolean,
): void {
	// SAFETY: see readArrayField's doc comment.
	(moduleConfig as Record<string, unknown>)[field] = value;
}

export function resolveConfig(layers: {
	file?: unknown;
	env?: string;
	flag?: string;
	command?: ConfigPatch;
}): { config: AgentsGuardConfig; provenance: Provenance; warnings: string[] } {
	const warnings: string[] = [];

	const config: AgentsGuardConfig = {
		enabled: DEFAULT_CONFIG.enabled,
		modules: {
			"hard-deny": { ...DEFAULT_CONFIG.modules["hard-deny"] },
			"subagent-policy": { ...DEFAULT_CONFIG.modules["subagent-policy"] },
			"writer-lock": { ...DEFAULT_CONFIG.modules["writer-lock"] },
			"git-evidence": { ...DEFAULT_CONFIG.modules["git-evidence"] },
			"completion-diff-recheck": {
				...DEFAULT_CONFIG.modules["completion-diff-recheck"],
			},
		},
	};
	const provenance: Provenance = {
		enabled: "default",
		modules: {
			"hard-deny": "default",
			"subagent-policy": "default",
			"writer-lock": "default",
			"git-evidence": "default",
			"completion-diff-recheck": "default",
		},
	};

	const ordered: Array<{ source: ConfigSource; patch: ConfigPatch }> = [];
	if (layers.file !== undefined) {
		ordered.push({
			source: "file",
			patch: validateLayer(layers.file, "file", warnings),
		});
	}
	if (layers.env !== undefined && layers.env.trim() !== "") {
		const shorthand = parseShorthand(layers.env);
		if (shorthand !== null) {
			ordered.push({
				source: "env",
				patch: validateLayer(shorthand, "env", warnings),
			});
		} else {
			try {
				ordered.push({
					source: "env",
					patch: validateLayer(JSON.parse(layers.env), "env", warnings),
				});
			} catch {
				warnings.push(
					"agents-guard: ignoring AGENTS_GUARD — not a shorthand or valid JSON",
				);
			}
		}
	}
	if (layers.flag !== undefined && layers.flag.trim() !== "") {
		const shorthand = parseShorthand(layers.flag);
		if (shorthand !== null) {
			ordered.push({
				source: "flag",
				patch: validateLayer(shorthand, "flag", warnings),
			});
		} else {
			warnings.push(
				`agents-guard: ignoring --agents-guard=${layers.flag} — unrecognized value`,
			);
		}
	}
	if (layers.command !== undefined) {
		ordered.push({
			source: "command",
			patch: validateLayer(layers.command, "command", warnings),
		});
	}

	for (const { source, patch } of ordered) {
		if (patch.enabled !== undefined) {
			config.enabled = patch.enabled;
			provenance.enabled = source;
		}
		for (const [key, entry] of Object.entries(patch.modules ?? {})) {
			const name = key as ModuleName;
			if (entry.enabled !== undefined) {
				config.modules[name].enabled = entry.enabled;
				provenance.modules[name] = source;
			}
			for (const field of NUMBER_FIELDS[name]) {
				const value = (entry as Record<string, number | undefined>)[field];
				if (value !== undefined) {
					writeNumberField(config.modules[name], field, value);
					provenance.modules[name] = source;
				}
			}
			for (const field of BOOLEAN_FIELDS[name]) {
				const value = (entry as Record<string, boolean | undefined>)[field];
				if (value !== undefined) {
					writeBooleanField(config.modules[name], field, value);
					provenance.modules[name] = source;
				}
			}
			for (const field of ARRAY_FIELDS[name]) {
				const value = readArrayField(entry, field);
				if (value !== undefined) {
					writeArrayField(config.modules[name], field, value);
					provenance.modules[name] = source;
				}
			}
		}
	}

	return { config, provenance, warnings };
}

/**
 * Only values whose provenance is not "default" are written, so the file never
 * freezes a default and a future default change reaches an existing install.
 * This is the direct lesson from pi-guard's saveConfig, which serialized its
 * in-memory DEFAULT_CONFIG.matchers into the file and froze the matcher set.
 */
export function serializeExplicit(
	config: AgentsGuardConfig,
	provenance: Provenance,
): Record<string, unknown> {
	const out: Record<string, unknown> = { version: 1 };
	if (provenance.enabled !== "default") out.enabled = config.enabled;

	const modules: Record<string, unknown> = {};
	for (const name of MODULE_NAMES) {
		if (provenance.modules[name] === "default") continue;
		const entry: Record<string, unknown> = {
			enabled: config.modules[name].enabled,
		};
		for (const field of ARRAY_FIELDS[name]) {
			const current = readArrayField(config.modules[name], field);
			const defaultValue = readArrayField(DEFAULT_CONFIG.modules[name], field);
			if (current !== defaultValue) entry[field] = current;
		}
		for (const field of NUMBER_FIELDS[name]) {
			const current = readNumberField(config.modules[name], field);
			const defaultValue = readNumberField(DEFAULT_CONFIG.modules[name], field);
			if (current !== defaultValue) entry[field] = current;
		}
		for (const field of BOOLEAN_FIELDS[name]) {
			const current = readBooleanField(config.modules[name], field);
			const defaultValue = readBooleanField(
				DEFAULT_CONFIG.modules[name],
				field,
			);
			if (current !== defaultValue) entry[field] = current;
		}
		modules[name] = entry;
	}
	if (Object.keys(modules).length > 0) out.modules = modules;
	return out;
}
