import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import type {
	PresencePeer,
	PresenceRecord,
	WriterIssueCode,
	WriterNotice,
	WriterReport,
} from "../types.js";

export function presenceDirectoryKey(root: string): string {
	return createHash("sha256").update(root).digest("hex");
}

export function parsePresenceRecord(raw: unknown): PresenceRecord | null {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw))
		return null;
	const r = raw as Record<string, unknown>;
	if (
		r.version !== 1 ||
		typeof r.instanceId !== "string" ||
		!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
			r.instanceId,
		)
	)
		return null;
	if (
		!isNonEmptyString(r.sessionId) ||
		!isNonEmptyString(r.host) ||
		!isNonEmptyString(r.worktreeRoot) ||
		!isAbsolute(r.worktreeRoot)
	)
		return null;
	if (typeof r.pid !== "number" || !Number.isSafeInteger(r.pid) || r.pid <= 0)
		return null;
	if (
		typeof r.startedAt !== "number" ||
		!Number.isFinite(r.startedAt) ||
		r.startedAt < 0 ||
		typeof r.lastSeenAt !== "number" ||
		!Number.isFinite(r.lastSeenAt) ||
		r.lastSeenAt < 0
	)
		return null;
	return {
		version: 1,
		instanceId: r.instanceId,
		sessionId: r.sessionId,
		host: r.host,
		pid: r.pid,
		worktreeRoot: r.worktreeRoot,
		startedAt: r.startedAt,
		lastSeenAt: r.lastSeenAt,
	};
}

export function assessPresence(
	records: readonly PresenceRecord[],
	self: { instanceId: string | null; host: string; worktreeRoot: string },
	now: number,
	timeoutMs: number,
): { peers: PresencePeer[]; issues: WriterIssueCode[] } {
	const issues = new Set<WriterIssueCode>();
	const peers: PresencePeer[] = [];
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		timeoutMs = 14_400_000;
		issues.add("options-invalid");
	}
	for (const record of records) {
		if (record.host !== self.host || record.worktreeRoot !== self.worktreeRoot)
			continue;
		let freshness: PresencePeer["freshness"] = "recent";
		if (
			record.lastSeenAt > now + 5000 ||
			record.startedAt > record.lastSeenAt
		) {
			issues.add("record-clock");
			freshness = "uncertain";
		} else if (now - record.lastSeenAt > timeoutMs) {
			issues.add("record-stale");
			freshness = "uncertain";
		}
		if (record.instanceId !== self.instanceId)
			peers.push({ record, freshness });
	}
	peers.sort((a, b) => a.record.instanceId.localeCompare(b.record.instanceId));
	return { peers, issues: [...issues].sort() };
}

export function writerNoticeSignature(
	sessionId: string,
	report: WriterReport,
): string {
	const s = report.snapshot;
	return createHash("sha256")
		.update(
			JSON.stringify([
				sessionId,
				s.kind,
				s.kind === "git" ? s.root : s.cwd,
				s.kind === "git" ? s.branch : null,
				s.kind === "git" ? s.dirty : null,
				report.peers.map((p) => [p.record.instanceId, p.freshness]).sort(),
				[...new Set([...s.issues, ...report.issues])].sort(),
			]),
		)
		.digest("hex");
}

const ISSUE_TEXT: Record<WriterIssueCode, string> = {
	"not-checked": "尚未檢查",
	"git-failed": "Git 檢查失敗",
	"git-timeout": "Git 檢查超過時間預算",
	"git-aborted": "Git 檢查已中止",
	"git-invalid-output": "Git 結果無法解析",
	"root-unresolved": "無法確認實際工作位置",
	"record-invalid": "存在記錄損壞或格式不符",
	"record-io": "存在記錄讀寫失敗",
	"record-stale": "存在過期記錄，狀態不明",
	"record-clock": "記錄時間不合理，狀態不明",
	"record-collision": "記錄路徑已存在，未覆寫",
	"record-unowned": "無法確認記錄歸屬，未修改",
	"record-missing": "自身記錄已不在原位置",
	"scan-limit": "記錄掃描超過上限",
	"record-size": "記錄超過大小上限",
	"record-symlink": "記錄路徑為符號連結，未跟隨",
	"legacy-present": "舊版鎖記錄仍存在，不參與本版提醒，未修改",
	"legacy-unknown": "無法確認舊版鎖記錄",
	"options-invalid": "新鮮度門檻無效，改用預設四小時",
	"temp-cleanup": "自身暫存記錄清理未完成",
	"own-cleanup": "自身存在記錄清理未完成",
};

/** Bound metadata before escaping terminal control characters. Never display raw records. */
function displayField(value: string): string {
	const points: string[] = [];
	for (const point of value) {
		if (points.length === 256) {
			points.push("…");
			break;
		}
		points.push(point);
	}
	return JSON.stringify(points.join(""))
		.slice(1, -1)
		.replace(
			/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
			(c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
		);
}

export function formatWriterNotice(report: WriterReport): WriterNotice {
	const s = report.snapshot;
	const issues = [...new Set([...s.issues, ...report.issues])];
	const lines = ["agents-guard/writer-lock: advisory（不鎖定寫入）"];
	if (s.kind === "git") {
		const branch =
			s.branch.kind === "branch"
				? displayField(s.branch.name)
				: s.branch.kind === "detached"
					? "detached HEAD"
					: "分支未確認";
		lines.push(`worktree: ${displayField(s.root)}；${branch}`);
		lines.push(
			s.dirty === true
				? "有未提交變更，請保留既有修改。"
				: s.dirty === false
					? "本次工作樹檢查未見未提交變更。"
					: "未提交變更狀態未確認。",
		);
	} else {
		lines.push(
			`${displayField(s.cwd)}：${s.kind === "not-applicable" ? "不適用 worktree 檢查" : "無法確認是否為 worktree，資訊不完整"}`,
		);
	}
	if (report.peers.length > 0) {
		lines.push("可能重複開啟 session；請確認其他視窗或改用不同 worktree。");
		for (const { record, freshness } of report.peers.slice(0, 5))
			lines.push(
				`  session=${displayField(record.sessionId)} pid=${record.pid}（${freshness === "recent" ? "近期登記，非存活保證" : "記錄存在但狀態不明"}）`,
			);
		if (report.peers.length > 5)
			lines.push(`另有 ${report.peers.length - 5} 個參與記錄未列出。`);
	} else if (s.kind === "git") lines.push("本次未觀察到其他參與記錄。");
	if (issues.length > 0)
		lines.push(
			`資訊不完整：${issues.map((code) => ISSUE_TEXT[code]).join("；")}。`,
		);
	lines.push("僅供提醒，不是互斥鎖。");
	return {
		level:
			issues.length > 0 ||
			report.peers.length > 0 ||
			s.kind === "unknown" ||
			(s.kind === "git" && s.dirty !== false)
				? "warning"
				: "info",
		message: lines.join("\n"),
	};
}

export function lockFilePath(worktreeRoot: string): string {
	const digest = createHash("sha256").update(worktreeRoot).digest("hex");
	return `${digest.slice(0, 16)}.json`;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value !== "";
}
