export type Decision =
	| { kind: "pass" }
	| { kind: "block"; reason: string }
	| { kind: "augment"; append: string }
	| { kind: "notify"; level: "info" | "warning" | "error"; message: string };

export const MODULE_NAMES = [
	"hard-deny",
	"subagent-policy",
	"writer-lock",
	"git-evidence",
	"completion-diff-recheck",
] as const;

export type ModuleName = (typeof MODULE_NAMES)[number];

export function isModuleName(value: string): value is ModuleName {
	return (MODULE_NAMES as readonly string[]).includes(value);
}

export interface HardDenyOptions {
	commands: string[];
	protectedPaths: string[];
}

export interface SubagentPolicyOptions {
	weakModelPatterns: string[];
	externalCliAgents: string[];
	nativeOnlyOptions: string[];
	reviewIntentPatterns: string[];
}

export interface SubagentPolicyFacts {
	capabilitiesListed: boolean;
	isSubagentChild: boolean;
}

export interface WriterLockSelf {
	sessionId: string;
	pid: number;
	host: string;
	isSubagentChild: boolean;
}

export interface WriterLockOptions {
	heartbeatTimeoutMs: number;
	/** @deprecated Advisory mode never blocks Git commands. */
	blockedGitSubcommands: string[];
	/** @deprecated Advisory mode never blocks tools. */
	blockedTools: string[];
}

export interface GitEvidenceOptions {
	maxAppendBytes: number;
	checkCi: boolean;
}

export type GitEvent = { kind: "commit" } | { kind: "push"; remote?: string };

export interface CompletionDiffRecheckOptions {
	followUp: boolean;
	maxFollowUpsPerSession: number;
}

export interface RecheckFacts {
	hadWrites: boolean;
	followUpCount: number;
}

export interface RecheckResult {
	changed: boolean;
	summary: string;
	shouldFollowUp: boolean;
}

export interface ModuleState {
	enabled: boolean;
}

export interface AgentsGuardConfig {
	enabled: boolean;
	modules: {
		"hard-deny": ModuleState & HardDenyOptions;
		"subagent-policy": ModuleState & SubagentPolicyOptions;
		"writer-lock": ModuleState & WriterLockOptions;
		"git-evidence": ModuleState & GitEvidenceOptions;
		"completion-diff-recheck": ModuleState & CompletionDiffRecheckOptions;
	};
}

export type WriterNotice = {
	level: "info" | "warning" | "error";
	message: string;
};
export type WriterRefreshReason = "startup" | "status" | "enabled";
export type WriterIssueCode =
	| "not-checked"
	| "git-failed"
	| "git-timeout"
	| "git-aborted"
	| "git-invalid-output"
	| "root-unresolved"
	| "record-invalid"
	| "record-io"
	| "record-stale"
	| "record-clock"
	| "record-collision"
	| "record-unowned"
	| "record-missing"
	| "scan-limit"
	| "record-size"
	| "record-symlink"
	| "legacy-present"
	| "legacy-unknown"
	| "options-invalid"
	| "temp-cleanup"
	| "own-cleanup";
export type WriterBranch =
	| { kind: "branch"; name: string }
	| { kind: "detached" | "unknown" };
export type WriterSnapshot =
	| {
			kind: "git";
			cwd: string;
			root: string;
			branch: WriterBranch;
			dirty: boolean | null;
			checkedAt: number;
			issues: WriterIssueCode[];
	  }
	| {
			kind: "not-applicable" | "unknown";
			cwd: string;
			checkedAt: number;
			issues: WriterIssueCode[];
	  };
export interface PresenceRecord {
	version: 1;
	instanceId: string;
	sessionId: string;
	pid: number;
	host: string;
	worktreeRoot: string;
	startedAt: number;
	lastSeenAt: number;
}
export type PresencePeer = {
	record: PresenceRecord;
	freshness: "recent" | "uncertain";
};
export type PresenceScan = {
	records: PresenceRecord[];
	issues: WriterIssueCode[];
};
export type WriterReport = {
	snapshot: WriterSnapshot;
	peers: PresencePeer[];
	issues: WriterIssueCode[];
};

export type ConfigSource = "default" | "file" | "env" | "flag" | "command";

export interface Provenance {
	enabled: ConfigSource;
	modules: Record<ModuleName, ConfigSource>;
}
