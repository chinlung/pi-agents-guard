import { describe, expect, it } from "vitest";
import {
	assessPresence,
	formatWriterNotice,
	parsePresenceRecord,
	presenceDirectoryKey,
	writerNoticeSignature,
} from "../src/modules/writer-lock.js";
import type { PresenceRecord, WriterReport } from "../src/types.js";

const record: PresenceRecord = {
	version: 1,
	instanceId: "00000000-0000-4000-8000-000000000001",
	sessionId: "s",
	pid: 123,
	host: "fixture",
	worktreeRoot: "/repo",
	startedAt: 1000,
	lastSeenAt: 2000,
};
const self = { instanceId: null, host: "fixture", worktreeRoot: "/repo" };
const report: WriterReport = {
	snapshot: {
		kind: "git",
		cwd: "/repo/sub",
		root: "/repo",
		branch: { kind: "branch", name: "main" },
		dirty: true,
		checkedAt: 3000,
		issues: [],
	},
	peers: [{ record, freshness: "recent" }],
	issues: [],
};

describe("writer presence data", () => {
	it("uses a full stable root hash, not a branch key", () => {
		expect(presenceDirectoryKey("/repo")).toMatch(/^[a-f0-9]{64}$/);
		expect(presenceDirectoryKey("/repo")).toBe(presenceDirectoryKey("/repo"));
		expect(presenceDirectoryKey("/other")).not.toBe(
			presenceDirectoryKey("/repo"),
		);
	});
	it("parses only known fields without retaining the input object", () => {
		const input = { ...record, secret: "do not retain" };
		expect(parsePresenceRecord(input)).toEqual(record);
		expect(parsePresenceRecord(input)).not.toBe(input);
	});
	it.each([
		null,
		[],
		{},
		{ ...record, version: 2 },
		{ ...record, instanceId: "../elsewhere" },
		{ ...record, sessionId: "" },
		{ ...record, host: "" },
		{ ...record, worktreeRoot: "relative" },
		{ ...record, pid: 0 },
		{ ...record, pid: 1.5 },
		{ ...record, startedAt: Number.NaN },
		{ ...record, lastSeenAt: Number.POSITIVE_INFINITY },
		{ ...record, lastSeenAt: -1 },
	])("rejects invalid presence %j", (raw) => {
		expect(parsePresenceRecord(raw)).toBeNull();
	});
	it("excludes only this registered instance, not equal pid or sessionId", () => {
		expect(assessPresence([record], self, 3000, 10000).peers).toEqual([
			{ record, freshness: "recent" },
		]);
		expect(
			assessPresence(
				[record],
				{ ...self, instanceId: record.instanceId },
				3000,
				10000,
			).peers,
		).toEqual([]);
	});
	it("ignores other hosts and worktrees", () => {
		expect(
			assessPresence(
				[
					{ ...record, host: "other" },
					{ ...record, worktreeRoot: "/other" },
				],
				self,
				3000,
				10000,
			).peers,
		).toEqual([]);
	});
	it.each([
		[{ ...record, lastSeenAt: 1000 }, 12000, 10000, "record-stale"],
		[{ ...record, lastSeenAt: 9000 }, 3000, 10000, "record-clock"],
		[{ ...record, startedAt: 2500 }, 3000, 10000, "record-clock"],
	] as const)(
		"keeps uncertain records visible",
		(peer, now, timeout, issue) => {
			const found = assessPresence([peer], self, now, timeout);
			expect(found.peers).toEqual([{ record: peer, freshness: "uncertain" }]);
			expect(found.issues).toContain(issue);
		},
	);
	it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
		"falls back to four hours for invalid timeout %s",
		(timeout) => {
			const found = assessPresence([record], self, 4000, timeout);
			expect(found.issues).toContain("options-invalid");
			expect(found.peers[0]?.freshness).toBe("recent");
			expect(
				assessPresence([record], self, 2000 + 14_400_001, timeout).peers[0]
					?.freshness,
			).toBe("uncertain");
		},
	);
	it("accepts the freshness boundary and small future clock drift", () => {
		expect(assessPresence([record], self, 12000, 10000).issues).toEqual([]);
		expect(assessPresence([record], self, 1000, 10000).issues).toEqual([]);
	});
});

describe("writer notice signatures and presentation", () => {
	it("does not change for heartbeat or inspection time alone", () => {
		const later: WriterReport = {
			...report,
			snapshot: { ...report.snapshot, checkedAt: 5000 },
			peers: [{ record: { ...record, lastSeenAt: 4000 }, freshness: "recent" }],
		};
		expect(writerNoticeSignature("s", later)).toBe(
			writerNoticeSignature("s", report),
		);
	});
	it.each([
		{ ...report, issues: ["record-io"] },
		{ ...report, peers: [] },
		{
			...report,
			snapshot: { ...report.snapshot, kind: "unknown", cwd: "/elsewhere" },
		},
	] as WriterReport[])("changes for changed reasons or location", (changed) => {
		expect(writerNoticeSignature("s", changed)).not.toBe(
			writerNoticeSignature("s", report),
		);
	});
	it("sorts peer and issue order and distinguishes session identity", () => {
		const second = {
			record: { ...record, instanceId: "00000000-0000-4000-8000-000000000002" },
			freshness: "recent" as const,
		};
		const two = { ...report, peers: [...report.peers, second] };
		expect(writerNoticeSignature("s", two)).toBe(
			writerNoticeSignature("s", { ...two, peers: [...two.peers].reverse() }),
		);
		expect(writerNoticeSignature("other", report)).not.toBe(
			writerNoticeSignature("s", report),
		);
	});
	it("warns about existing changes without requesting a clean tree", () => {
		const notice = formatWriterNotice(report);
		expect(notice.level).toBe("warning");
		expect(notice.message).toContain("保留");
		expect(notice.message).toContain("/repo");
		expect(notice.message).toContain("main");
		expect(notice.message).toContain("其他視窗");
		expect(notice.message).toContain("不是互斥鎖");
	});
	it("does not equate a missing peer with no other writer", () => {
		const notice = formatWriterNotice({ ...report, peers: [] });
		expect(notice.message).toContain("未觀察到其他參與記錄");
		expect(notice.message).not.toContain("沒有其他 writer");
	});
	it("shows unknown, non-applicable and detached states truthfully", () => {
		const unknown = formatWriterNotice({
			snapshot: {
				kind: "unknown",
				cwd: "/x",
				checkedAt: 1,
				issues: ["git-failed"],
			},
			peers: [],
			issues: [],
		});
		expect(unknown.message).toContain("資訊不完整");
		const na = formatWriterNotice({
			snapshot: { kind: "not-applicable", cwd: "/x", checkedAt: 1, issues: [] },
			peers: [],
			issues: [],
		});
		expect(na.message).toContain("不適用");
		const detached = formatWriterNotice({
			...report,
			snapshot: {
				kind: "git",
				cwd: "/repo",
				root: "/repo",
				branch: { kind: "detached" },
				dirty: null,
				checkedAt: 1,
				issues: [],
			},
		});
		expect(detached.message).toContain("detached HEAD");
		expect(detached.message).toContain("未確認");
	});
	it("bounds and escapes dynamic fields and lists only five peers", () => {
		const peers = Array.from({ length: 7 }, (_, i) => ({
			record: {
				...record,
				instanceId: `${i}`,
				sessionId: `${i}\u001b\n${"😀".repeat(400)}`,
			},
			freshness: "recent" as const,
		}));
		const message = formatWriterNotice({ ...report, peers }).message;
		expect(message).not.toContain("\u001b");
		expect(message).not.toContain("😀".repeat(257));
		expect(message).toContain("另有 2");
		expect(message).not.toContain("5\\u001b");
	});
});
