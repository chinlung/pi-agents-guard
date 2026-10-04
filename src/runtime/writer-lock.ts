import { randomUUID } from "node:crypto";
import {
	assessPresence,
	formatWriterNotice,
	writerNoticeSignature,
} from "../modules/writer-lock.js";
import {
	createPresenceFiles,
	type PresenceFiles,
	type PresenceMutation,
} from "../state.js";
import type {
	Decision,
	PresenceRecord,
	WriterIssueCode,
	WriterLockOptions,
	WriterLockSelf,
	WriterNotice,
	WriterRefreshReason,
	WriterReport,
	WriterSnapshot,
} from "../types.js";

type Worktree = { root: string; branch: string };
export interface WriterLockControllerDeps {
	self: WriterLockSelf;
	stateDir: string;
	/** Deprecated compatibility seam; never called by advisory mode. */
	isPidAlive: (pid: number) => boolean;
	getSettings: () => { enabled: boolean; options: WriterLockOptions };
	files?: PresenceFiles;
	newInstanceId?: () => string;
}
export interface WriterLockController {
	setSessionId(sessionId: string): void;
	init(worktree: Worktree | null, now: number): WriterNotice | undefined;
	refresh(
		snapshot: WriterSnapshot,
		now: number,
		reason: WriterRefreshReason,
	): WriterNotice | undefined;
	heartbeat(now: number): void;
	release(): void;
	takeover(worktree: Worktree, now: number): WriterNotice;
	isReadonly(): boolean;
	checkReadonlyCall(toolName: string, input: Record<string, unknown>): Decision;
	summary(): string;
	takeNotice(): WriterNotice | undefined;
}

/** One cooperative session's presence and notices. No tool admission or process tracking. */
export function createWriterLockController(
	deps: WriterLockControllerDeps,
): WriterLockController {
	const files = deps.files ?? createPresenceFiles(deps.stateDir);
	const newId = deps.newInstanceId ?? randomUUID;
	const self = { ...deps.self };
	let instanceId = newId();
	let own: PresenceRecord | undefined;
	let active = false;
	let report: WriterReport | undefined;
	let scanIssues: WriterIssueCode[] = [];
	let operationIssues: WriterIssueCode[] = [];
	// Abandoned paths are not retried or implicitly proven clean by a new record.
	const cleanupIssues = new Set<WriterIssueCode>();
	let lastAutomatic: string | undefined;
	let pending: WriterNotice | undefined;
	const enabled = () => !self.isSubagentChild && deps.getSettings().enabled;
	function currentReport(): WriterReport | undefined {
		return report === undefined
			? undefined
			: {
					...report,
					issues: [...scanIssues, ...operationIssues, ...cleanupIssues],
				};
	}
	function notice(reason: WriterRefreshReason): WriterNotice | undefined {
		const current = currentReport();
		if (current === undefined) return undefined;
		const signature = writerNoticeSignature(self.sessionId, current);
		if (reason !== "status") {
			if (signature === lastAutomatic) return undefined;
			lastAutomatic = signature;
		}
		return formatWriterNotice(current);
	}
	function perform(operation: () => PresenceMutation): PresenceMutation {
		try {
			const result = operation();
			if (result.issues.includes("temp-cleanup"))
				cleanupIssues.add("temp-cleanup");
			return result;
		} catch {
			return { outcome: "failed", issues: ["record-io"] };
		}
	}
	function clearOwn(): void {
		active = false;
		const old = own;
		own = undefined;
		if (old === undefined) return;
		instanceId = newId();
		const result = perform(() => files.remove(old));
		operationIssues = result.issues;
		if (result.outcome !== "done") {
			cleanupIssues.add("own-cleanup");
			operationIssues = [...operationIssues, "own-cleanup"];
		}
		if (operationIssues.length > 0) pending = notice("startup") ?? pending;
	}
	function publish(
		snapshot: Extract<WriterSnapshot, { kind: "git" }>,
		now: number,
	): void {
		const next: PresenceRecord =
			own === undefined
				? {
						version: 1,
						instanceId,
						sessionId: self.sessionId,
						pid: self.pid,
						host: self.host,
						worktreeRoot: snapshot.root,
						startedAt: now,
						lastSeenAt: now,
					}
				: { ...own, lastSeenAt: now };
		const previous = own;
		const result = perform(() =>
			previous === undefined ? files.create(next) : files.update(previous, now),
		);
		operationIssues = result.issues;
		if (result.outcome === "done") own = next;
		else if (
			previous === undefined ||
			result.outcome === "missing" ||
			result.outcome === "unowned"
		) {
			own = undefined;
			instanceId = newId();
		}
	}
	function refresh(
		snapshot: WriterSnapshot,
		now: number,
		reason: WriterRefreshReason,
	): WriterNotice | undefined {
		if (!enabled()) return undefined;
		if (
			own !== undefined &&
			(snapshot.kind !== "git" || snapshot.root !== own.worktreeRoot)
		)
			clearOwn();
		pending = undefined; // Fresh reports incorporate diagnostics; never replay an old location.
		report = { snapshot, peers: [], issues: [] };
		scanIssues = [];
		if (snapshot.kind !== "git") {
			active = false;
			return notice(reason);
		}
		active = true;
		publish(snapshot, now);
		try {
			const scan = files.scan(snapshot.root);
			const assessed = assessPresence(
				scan.records,
				{
					instanceId: own?.instanceId ?? null,
					host: self.host,
					worktreeRoot: snapshot.root,
				},
				now,
				deps.getSettings().options.heartbeatTimeoutMs,
			);
			report.peers = assessed.peers;
			scanIssues = [...scan.issues, ...assessed.issues];
		} catch {
			scanIssues.push("record-io");
		}
		try {
			const legacy = files.legacy(snapshot.root);
			if (legacy === "present") scanIssues.push("legacy-present");
			if (legacy === "unknown") scanIssues.push("legacy-unknown");
		} catch {
			scanIssues.push("legacy-unknown");
		}
		return notice(reason);
	}
	return {
		setSessionId(value) {
			if (self.sessionId === value) return;
			clearOwn();
			self.sessionId = value;
			instanceId = newId();
			lastAutomatic = undefined;
		},
		init(worktree, now) {
			if (worktree === null) {
				clearOwn();
				return undefined;
			}
			return refresh(
				{
					kind: "git",
					cwd: worktree.root,
					root: worktree.root,
					branch:
						worktree.branch === "HEAD"
							? { kind: "detached" }
							: worktree.branch === ""
								? { kind: "unknown" }
								: { kind: "branch", name: worktree.branch },
					dirty: null,
					checkedAt: now,
					issues: ["not-checked"],
				},
				now,
				"startup",
			);
		},
		refresh,
		heartbeat(now) {
			if (!enabled() || !active || own === undefined) return;
			const expected = own;
			const failedReport =
				operationIssues.length > 0 ? currentReport() : undefined;
			const recoveringAutomatic =
				failedReport !== undefined &&
				writerNoticeSignature(self.sessionId, failedReport) === lastAutomatic;
			const result = perform(() => files.update(expected, now));
			operationIssues = result.issues;
			if (result.outcome === "done") own = { ...expected, lastSeenAt: now };
			else if (result.outcome === "missing" || result.outcome === "unowned") {
				own = undefined;
				instanceId = newId();
			}
			if (operationIssues.length > 0) pending = notice("startup") ?? pending;
			else if (result.outcome === "done" && recoveringAutomatic) {
				// Recover only an automatically observed fault, not status-only changes.
				const current = currentReport();
				if (current !== undefined)
					lastAutomatic = writerNoticeSignature(self.sessionId, current);
			}
		},
		release: clearOwn,
		takeover: () => ({
			level: "warning",
			message:
				"agents-guard: 已改為提示，不需接管或解鎖；status 重新檢查，off writer-lock 停用提示。",
		}),
		isReadonly: () => false,
		checkReadonlyCall: () => ({ kind: "pass" }),
		summary() {
			if (self.isSubagentChild)
				return "writer-lock: 由 parent 管理，未進行檢查。";
			const current = currentReport();
			if (!deps.getSettings().enabled)
				return `writer-lock: 提示已停用。${cleanupIssues.size > 0 ? "自身記錄清理未完成。" : ""}`;
			return current === undefined
				? "writer-lock: advisory（不鎖定寫入），尚未檢查。"
				: `${formatWriterNotice(current).message}\n檢查時間：${current.snapshot.checkedAt}`;
		},
		takeNotice() {
			const result = pending;
			pending = undefined;
			return result;
		},
	};
}
