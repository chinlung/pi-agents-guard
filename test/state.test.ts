import {
	fstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	lockFilePath,
	presenceDirectoryKey,
} from "../src/modules/writer-lock.js";
import {
	createPresenceFiles,
	readJsonFile,
	removeFile,
	resolveStateDir,
	statMtimeMs,
	writeJsonFileAtomic,
} from "../src/state.js";
import type { PresenceRecord } from "../src/types.js";

describe("resolveStateDir", () => {
	it("defaults to ~/.pi/agent/state/agents-guard", () => {
		expect(resolveStateDir({}, "/Users/me")).toBe(
			"/Users/me/.pi/agent/state/agents-guard",
		);
	});

	it("honours PI_CODING_AGENT_DIR", () => {
		expect(
			resolveStateDir({ PI_CODING_AGENT_DIR: "/custom/agent" }, "/Users/me"),
		).toBe("/custom/agent/state/agents-guard");
	});
});

describe("writeJsonFileAtomic / readJsonFile", () => {
	it("round-trips a value and creates the file 0600", () => {
		const dir = mkdtempSync(join(tmpdir(), "ag-state-"));
		const file = join(dir, "nested", "config.json");
		writeJsonFileAtomic(file, { hello: "world" });

		expect(readJsonFile(file).value).toEqual({ hello: "world" });
		expect(statSync(file).mode & 0o777).toBe(0o600);
		expect(readFileSync(file, "utf8").endsWith("\n")).toBe(true);
	});

	it("reports a parse error instead of throwing", () => {
		const dir = mkdtempSync(join(tmpdir(), "ag-state-"));
		const file = join(dir, "broken.json");
		writeJsonFileAtomic(file, { ok: true });
		writeFileSync(file, "{ not json");
		const result = readJsonFile(file);
		expect(result.value).toBeUndefined();
		expect(result.error).toBeDefined();
	});

	it("reports a missing file as undefined without an error", () => {
		const result = readJsonFile(join(tmpdir(), "definitely-missing-ag.json"));
		expect(result.value).toBeUndefined();
		expect(result.error).toBeUndefined();
	});

	it("leaves no temp file behind", () => {
		const dir = mkdtempSync(join(tmpdir(), "ag-state-"));
		const file = join(dir, "config.json");
		writeJsonFileAtomic(file, { a: 1 });
		writeJsonFileAtomic(file, { a: 2 });
		expect(readdirSync(dir).filter((n) => n.includes(".tmp-"))).toEqual([]);
		expect(readJsonFile(file).value).toEqual({ a: 2 });
	});
});

describe("statMtimeMs", () => {
	it("returns the file's mtime in milliseconds", () => {
		const dir = mkdtempSync(join(tmpdir(), "ag-state-"));
		const file = join(dir, "a.json");
		writeJsonFileAtomic(file, { a: 1 });
		const mtime = statMtimeMs(file);
		expect(mtime).not.toBeNull();
		expect(mtime).toBeGreaterThan(0);
	});

	it("returns null for a missing file", () => {
		expect(
			statMtimeMs(join(tmpdir(), "definitely-missing-ag.json")),
		).toBeNull();
	});
});

describe("removeFile", () => {
	it("deletes an existing file", () => {
		const dir = mkdtempSync(join(tmpdir(), "ag-state-"));
		const file = join(dir, "a.json");
		writeJsonFileAtomic(file, { a: 1 });
		removeFile(file);
		expect(readJsonFile(file).value).toBeUndefined();
	});

	it("is a no-op for a missing file", () => {
		expect(() =>
			removeFile(join(tmpdir(), "definitely-missing-ag.json")),
		).not.toThrow();
	});
});

describe("presence files", () => {
	let root: string;
	let stateDir: string;
	let directory: string;
	let path: string;
	const record: PresenceRecord = {
		version: 1,
		instanceId: "00000000-0000-4000-8000-000000000001",
		sessionId: "a",
		pid: 123,
		host: "fixture",
		worktreeRoot: "/repo",
		startedAt: 1000,
		lastSeenAt: 1000,
	};
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "ag-presence-"));
		stateDir = join(root, "state", "agents-guard");
		directory = join(stateDir, "presence", presenceDirectoryKey("/repo"));
		path = join(directory, `${record.instanceId}.json`);
	});
	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(root, { recursive: true, force: true });
	});
	const fault = (code: string) =>
		Object.assign(new Error("private error details"), { code });

	it("constructs without I/O and writes two independent 0600 records", () => {
		const blocked = vi.fn(() => {
			throw fault("EACCES");
		});
		createPresenceFiles(stateDir, { mkdirSync: blocked, lstatSync: blocked });
		expect(blocked).not.toHaveBeenCalled();
		const files = createPresenceFiles(stateDir);
		expect(files.create(record)).toEqual({ outcome: "done", issues: [] });
		const other = {
			...record,
			instanceId: "00000000-0000-4000-8000-000000000002",
			sessionId: "b",
		};
		expect(files.create(other).outcome).toBe("done");
		expect(files.scan("/repo").records).toHaveLength(2);
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(statSync(directory).mode & 0o777).toBe(0o700);
		expect(statSync(join(stateDir, "presence")).mode & 0o777).toBe(0o700);
		expect(files.update(record, 2000).outcome).toBe("done");
		expect(JSON.parse(readFileSync(path, "utf8")).lastSeenAt).toBe(2000);
		expect(files.remove(record).outcome).toBe("done");
		expect(files.scan("/repo").records).toEqual([other]);
	});
	it("never replaces an existing registration on create", () => {
		const files = createPresenceFiles(stateDir);
		files.create(record);
		const before = readFileSync(path);
		expect(files.create({ ...record, sessionId: "other" })).toMatchObject({
			outcome: "unowned",
			issues: ["record-collision"],
		});
		expect(readFileSync(path)).toEqual(before);
		expect(readdirSync(directory)).toEqual([`${record.instanceId}.json`]);
	});
	it.each([
		{ instanceId: "00000000-0000-4000-8000-000000000009" },
		{ sessionId: "other" },
		{ host: "other" },
		{ pid: 321 },
		{ worktreeRoot: "/other" },
	])("leaves changed ownership untouched %j", (changed) => {
		const files = createPresenceFiles(stateDir);
		files.create(record);
		writeFileSync(path, JSON.stringify({ ...record, ...changed }));
		const before = readFileSync(path);
		expect(files.update(record, 9000).outcome).toBe("unowned");
		expect(files.remove(record).outcome).toBe("unowned");
		expect(readFileSync(path)).toEqual(before);
	});
	it("distinguishes absence from denied access", () => {
		const files = createPresenceFiles(stateDir);
		expect(files.scan("/repo")).toEqual({ records: [], issues: [] });
		expect(files.update(record, 2).outcome).toBe("missing");
		const denied = createPresenceFiles(stateDir, {
			lstatSync: () => {
				throw fault("EACCES");
			},
		});
		expect(denied.scan("/repo")).toEqual({
			records: [],
			issues: ["record-io"],
		});
		expect(denied.legacy("/repo")).toBe("unknown");
	});
	it.each([
		"{broken",
		JSON.stringify({ version: 1 }),
		"x".repeat(16 * 1024 + 1),
	])("rejects invalid or oversized records without changing them", (raw) => {
		const files = createPresenceFiles(stateDir);
		files.create(record);
		writeFileSync(path, raw);
		expect(files.scan("/repo").issues).toContain(
			raw.length > 16384 ? "record-size" : "record-invalid",
		);
		expect(files.update(record, 2000).outcome).toBe("unowned");
		expect(files.remove(record).outcome).toBe("unowned");
		expect(readFileSync(path, "utf8")).toBe(raw);
	});
	it("does not follow a leaf symlink or a presence directory symlink", () => {
		const files = createPresenceFiles(stateDir);
		files.create(record);
		const target = join(root, "target.json");
		writeFileSync(target, JSON.stringify(record));
		rmSync(path);
		symlinkSync(target, path);
		expect(files.scan("/repo").issues).toContain("record-symlink");
		expect(files.remove(record).outcome).toBe("unowned");
		expect(files.update(record, 3000).outcome).toBe("unowned");
		expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(record);
		rmSync(join(stateDir, "presence"), { recursive: true });
		const elsewhere = join(root, "elsewhere");
		mkdirSync(elsewhere);
		symlinkSync(elsewhere, join(stateDir, "presence"));
		expect(files.create(record).outcome).not.toBe("done");
		expect(files.scan("/repo").issues).toContain("record-symlink");
		expect(readdirSync(elsewhere)).toEqual([]);
	});
	it("bounds scans and treats unknown items as incomplete, not absent", () => {
		const files = createPresenceFiles(stateDir);
		files.create(record);
		for (let i = 0; i < 257; i++)
			writeFileSync(join(directory, `unknown-${i}`), "private");
		expect(files.scan("/repo").issues).toContain("scan-limit");
		expect(files.scan("/repo").issues).toContain("record-invalid");
	});
	it("cleans only its own temp on rename failure and retains the old record", () => {
		const files = createPresenceFiles(stateDir);
		files.create(record);
		writeFileSync(join(directory, ".tmp-foreign"), "keep");
		const failing = createPresenceFiles(stateDir, {
			renameSync: () => {
				throw fault("EIO");
			},
		});
		expect(failing.update(record, 2000)).toMatchObject({
			outcome: "failed",
			issues: ["record-io"],
		});
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(record);
		expect(readdirSync(directory).sort()).toEqual(
			[".tmp-foreign", `${record.instanceId}.json`].sort(),
		);
	});
	it("retains publication success if only temp cleanup fails", () => {
		const files = createPresenceFiles(stateDir, {
			unlinkSync: () => {
				throw fault("EACCES");
			},
		});
		expect(files.create(record)).toEqual({
			outcome: "done",
			issues: ["temp-cleanup"],
		});
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(record);
		expect(files.remove(record)).toMatchObject({ outcome: "failed" });
	});
	it("does not use overwriting fallback when linking is unavailable", () => {
		const files = createPresenceFiles(stateDir, {
			linkSync: () => {
				throw fault("ENOTSUP");
			},
		});
		expect(files.create(record)).toMatchObject({ outcome: "failed" });
		expect(readdirSync(directory)).toEqual([]);
	});
	it.each(["valid", "invalid", "oversized", "read-error"])(
		"closes the actual read descriptor after %s",
		(kind) => {
			createPresenceFiles(stateDir).create(record);
			if (kind === "invalid") writeFileSync(path, "{broken");
			if (kind === "oversized") writeFileSync(path, "x".repeat(20_000));
			let captured: number | undefined;
			const files = createPresenceFiles(stateDir, {
				openSync: (...args: Parameters<typeof openSync>) => {
					captured = openSync(...args);
					return captured;
				},
				...(kind === "read-error"
					? {
							readSync: () => {
								throw fault("EIO");
							},
						}
					: {}),
			});
			const result = files.scan("/repo");
			expect(result.records).toHaveLength(kind === "valid" ? 1 : 0);
			if (kind !== "valid") expect(result.issues.length).toBeGreaterThan(0);
			const fd = captured;
			if (fd === undefined) throw new Error("no fd opened");
			expect(() => fstatSync(fd)).toThrow(
				expect.objectContaining({ code: "EBADF" }),
			);
		},
	);
	it("counts protocol temps toward the cap and rejects mismatched filenames", () => {
		const files = createPresenceFiles(stateDir);
		files.create(record);
		writeFileSync(
			join(directory, "00000000-0000-4000-8000-000000000002.json"),
			JSON.stringify(record),
		);
		expect(files.scan("/repo")).toEqual({
			records: [record],
			issues: ["record-invalid"],
		});
		files.remove(record);
		rmSync(join(directory, "00000000-0000-4000-8000-000000000002.json"));
		for (let i = 0; i < 256; i++)
			writeFileSync(
				join(
					directory,
					`.tmp-00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`,
				),
				"{partial",
			);
		expect(files.scan("/repo")).toEqual({ records: [], issues: [] });
		writeFileSync(
			join(directory, ".tmp-00000000-0000-4000-8000-000000000100"),
			"{partial",
		);
		expect(files.scan("/repo").issues).toEqual(["scan-limit"]);
	});
	it("preserves legacy bytes and separates other roots", () => {
		const files = createPresenceFiles(stateDir);
		const legacy = join(stateDir, "locks", lockFilePath("/repo"));
		writeJsonFileAtomic(legacy, { version: 1, private: "legacy" });
		const before = readFileSync(legacy);
		expect(files.legacy("/repo")).toBe("present");
		expect(files.legacy("/other")).toBe("absent");
		files.create(record);
		files.update(record, 2000);
		files.remove(record);
		expect(files.scan("/other")).toEqual({ records: [], issues: [] });
		expect(readFileSync(legacy)).toEqual(before);
	});
});
