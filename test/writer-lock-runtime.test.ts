import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../src/config.js";
import {
	lockFilePath,
	presenceDirectoryKey,
} from "../src/modules/writer-lock.js";
import { createWriterLockController } from "../src/runtime/writer-lock.js";
import {
	createPresenceFiles,
	type PresenceFiles,
	writeJsonFileAtomic,
} from "../src/state.js";
import type { WriterLockSelf, WriterSnapshot } from "../src/types.js";

describe("writer advisory controller", () => {
	let root: string;
	let stateDir: string;
	let worktree: { root: string; branch: string };
	let settings: {
		enabled: boolean;
		options: ReturnType<
			typeof resolveConfig
		>["config"]["modules"]["writer-lock"];
	};
	const now = 10_000;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "ag-controller-"));
		stateDir = join(root, "state", "agents-guard");
		worktree = { root: join(root, "repo"), branch: "main" };
		mkdirSync(worktree.root);
		settings = {
			enabled: true,
			options: resolveConfig({}).config.modules["writer-lock"],
		};
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));
	function controller(
		self: Partial<WriterLockSelf> = {},
		files?: PresenceFiles,
		directory = stateDir,
	) {
		return createWriterLockController({
			self: {
				sessionId: "a",
				pid: 111,
				host: "fixture",
				isSubagentChild: false,
				...self,
			},
			stateDir: directory,
			isPidAlive: () => {
				throw new Error("must not probe processes");
			},
			getSettings: () => settings,
			files,
		});
	}
	function snapshot(): WriterSnapshot {
		return {
			kind: "git",
			cwd: worktree.root,
			root: worktree.root,
			branch: { kind: "branch", name: "main" },
			dirty: false,
			checkedAt: now,
			issues: [],
		};
	}
	const records = () =>
		createPresenceFiles(stateDir).scan(worktree.root).records;
	it("peer notice never blocks writes, including old configured tools", () => {
		controller().init(worktree, now);
		const second = controller({ sessionId: "b", pid: 222 });
		second.init(worktree, now);
		expect(second.isReadonly()).toBe(false);
		for (const tool of ["write", "edit", "ast_grep_replace", "read"])
			expect(second.checkReadonlyCall(tool, {}).kind).toBe("pass");
		settings = {
			...settings,
			options: { ...settings.options, blockedTools: ["custom"] },
		};
		expect(second.checkReadonlyCall("custom", {}).kind).toBe("pass");
	});
	it("uses replacement settings and only registers after enabled", () => {
		settings = { ...settings, enabled: false };
		const c = controller();
		c.init(worktree, now);
		expect(records()).toEqual([]);
		settings = { ...settings, enabled: true };
		c.init(worktree, now);
		expect(records()).toHaveLength(1);
		c.release();
		expect(records()).toEqual([]);
	});
	it("sets identity, updates heartbeat and only deletes its own record", () => {
		const a = controller();
		a.setSessionId("actual");
		a.init(worktree, now);
		const b = controller({ sessionId: "b" });
		b.init(worktree, now);
		const other = records().find((r) => r.sessionId === "b");
		a.heartbeat(now + 1000);
		expect(records().find((r) => r.sessionId === "actual")?.lastSeenAt).toBe(
			now + 1000,
		);
		a.release();
		a.heartbeat(now + 2000);
		expect(records()).toEqual([other]);
	});
	it("deduplicates automatic notices but status remains fresh", () => {
		const c = controller();
		expect(c.refresh(snapshot(), now, "startup")).toBeDefined();
		expect(c.refresh(snapshot(), now + 1, "startup")).toBeUndefined();
		expect(c.refresh(snapshot(), now + 2, "status")).toBeDefined();
		expect(c.refresh(snapshot(), now + 3, "startup")).toBeUndefined();
		controller({ sessionId: "b" }).init(worktree, now);
		expect(c.refresh(snapshot(), now + 4, "startup")?.message).toContain(
			"其他視窗",
		);
	});
	it("skips before all file I/O when disabled or a background child", () => {
		const no = vi.fn(() => {
			throw new Error("unexpected I/O");
		});
		const files: PresenceFiles = {
			create: no,
			update: no,
			remove: no,
			scan: no,
			legacy: no,
		};
		const child = controller({ isSubagentChild: true }, files);
		child.init(worktree, now);
		child.refresh(snapshot(), now, "status");
		child.heartbeat(now);
		child.release();
		settings = { ...settings, enabled: false };
		controller({}, files).refresh(snapshot(), now, "startup");
		expect(no).not.toHaveBeenCalled();
	});
	it("does not let stale heartbeat or release touch a replaced record", () => {
		const c = controller();
		c.init(worktree, now);
		const own = records()[0];
		if (!own) throw new Error("missing own");
		const path = join(
			stateDir,
			"presence",
			presenceDirectoryKey(worktree.root),
			`${own.instanceId}.json`,
		);
		writeFileSync(path, JSON.stringify({ ...own, sessionId: "other" }));
		const before = readFileSync(path);
		c.heartbeat(now + 1);
		c.release();
		expect(readFileSync(path)).toEqual(before);
		expect(c.takeNotice()).toBeDefined();
		expect(c.takeNotice()).toBeUndefined();
		c.refresh(snapshot(), now + 2, "status");
		expect(records()).toHaveLength(2);
	});
	it("never modifies v1 files or performs takeover side effects", () => {
		const path = join(stateDir, "locks", lockFilePath(worktree.root));
		writeJsonFileAtomic(path, { version: 1, malformed: true });
		const before = readFileSync(path);
		const c = controller();
		expect(c.init(worktree, now)?.message).toContain("舊版");
		const ownBefore = records();
		expect(c.takeover(worktree, now)?.message).toContain("不需接管");
		expect(records()).toEqual(ownBefore);
		c.release();
		expect(readFileSync(path)).toEqual(before);
	});
	it("does not rebuild identity on same sessionId, but replaces on a new session", () => {
		const c = controller();
		c.init(worktree, now);
		const before = records();
		c.setSessionId("a");
		expect(records()).toEqual(before);
		c.setSessionId("new");
		expect(records()).toEqual([]);
		c.init(worktree, now + 1);
		expect(records()[0]?.instanceId).not.toBe(before[0]?.instanceId);
	});
	it("cleans old location on unknown and keeps independent state namespaces", () => {
		const c = controller();
		c.init(worktree, now);
		const otherState = join(root, "other", "state", "agents-guard");
		controller({}, undefined, otherState).init(worktree, now);
		c.refresh(
			{
				kind: "unknown",
				cwd: "/unknown",
				checkedAt: now,
				issues: ["git-failed"],
			},
			now,
			"status",
		);
		expect(records()).toEqual([]);
		expect(
			createPresenceFiles(otherState).scan(worktree.root).records,
		).toHaveLength(1);
		expect(c.summary()).toContain("資訊不完整");
	});
	it("does not hide failed old-root cleanup behind successful new-root registration", () => {
		const real = createPresenceFiles(stateDir);
		const c = controller(
			{},
			{ ...real, remove: () => ({ outcome: "failed", issues: ["record-io"] }) },
		);
		c.refresh(snapshot(), now, "startup");
		const next = {
			...snapshot(),
			root: join(root, "second"),
		} as WriterSnapshot;
		expect(c.refresh(next, now + 1, "status")?.message).toContain("清理未完成");
		expect(c.summary()).toContain("清理未完成");
		expect(c.takeNotice()).toBeUndefined(); // The fresh report already incorporates cleanup, not an old-root replay.
	});

	it("notifies once when a heartbeat fault recurs after recovery", () => {
		let denied = false;
		const files = createPresenceFiles(stateDir, {
			renameSync: (...args) => {
				if (denied)
					throw Object.assign(new Error("fixture permission failure"), {
						code: "EACCES",
					});
				renameSync(...args);
			},
		});
		const c = controller({}, files);
		c.refresh(snapshot(), now, "startup");
		denied = true;
		c.heartbeat(now + 1);
		expect(c.takeNotice()?.message).toContain("讀寫失敗");
		expect(c.takeNotice()).toBeUndefined();
		denied = false;
		c.heartbeat(now + 2);
		expect(records()[0]?.lastSeenAt).toBe(now + 2);
		expect(c.summary()).not.toContain("讀寫失敗");
		expect(c.takeNotice()).toBeUndefined();
		denied = true;
		c.heartbeat(now + 3);
		expect(c.takeNotice()?.message).toContain("讀寫失敗");
		c.heartbeat(now + 4);
		expect(c.takeNotice()).toBeUndefined();
	});

	it.each([false, true])(
		"does not consume status-only peer changes after heartbeat (status update failed: %s)",
		(statusFails) => {
			const real = createPresenceFiles(stateDir);
			let failUpdate = statusFails;
			const c = controller(
				{},
				{
					...real,
					update: (record, time) =>
						failUpdate
							? { outcome: "failed", issues: ["record-io"] }
							: real.update(record, time),
				},
			);
			c.refresh(snapshot(), now, "startup");
			controller({ sessionId: "b" }).init(worktree, now);
			expect(c.refresh(snapshot(), now + 1, "status")?.message).toContain(
				"其他視窗",
			);
			expect(c.summary().includes("讀寫失敗")).toBe(statusFails);
			failUpdate = false;
			c.heartbeat(now + 2);
			expect(c.takeNotice()).toBeUndefined();
			expect(c.summary()).not.toContain("讀寫失敗");
			expect(c.refresh(snapshot(), now + 3, "startup")?.message).toContain(
				"其他視窗",
			);
			expect(c.refresh(snapshot(), now + 4, "startup")).toBeUndefined();
		},
	);

	it("drains one failure notice, retains status diagnostics and stops after release failure", () => {
		const real = createPresenceFiles(stateDir);
		const update = vi.fn(() => ({
			outcome: "failed" as const,
			issues: ["record-io" as const],
		}));
		const c = controller(
			{},
			{
				...real,
				update,
				remove: () => {
					throw new Error("private");
				},
			},
		);
		c.refresh(snapshot(), now, "startup");
		c.heartbeat(now + 1);
		expect(c.takeNotice()?.message).toContain("讀寫失敗");
		expect(c.takeNotice()).toBeUndefined();
		expect(c.summary()).toContain("讀寫失敗");
		c.heartbeat(now + 2);
		expect(c.takeNotice()).toBeUndefined();
		c.release();
		const count = update.mock.calls.length;
		c.heartbeat(now + 3);
		expect(update.mock.calls.length).toBe(count);
		expect(c.summary()).toContain("清理未完成");
	});
});
