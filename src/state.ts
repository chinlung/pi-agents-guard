import { randomUUID } from "node:crypto";
import * as nodeFs from "node:fs";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	lockFilePath,
	parsePresenceRecord,
	presenceDirectoryKey,
} from "./modules/writer-lock.js";
import type { PresenceRecord, PresenceScan, WriterIssueCode } from "./types.js";

export type PresenceFsOps = Pick<
	typeof nodeFs,
	| "mkdirSync"
	| "lstatSync"
	| "opendirSync"
	| "openSync"
	| "fstatSync"
	| "readSync"
	| "writeFileSync"
	| "closeSync"
	| "linkSync"
	| "renameSync"
	| "unlinkSync"
>;
export type PresenceMutation = {
	outcome: "done" | "missing" | "unowned" | "failed";
	issues: WriterIssueCode[];
};
export interface PresenceFiles {
	create(record: PresenceRecord): PresenceMutation;
	update(expected: PresenceRecord, lastSeenAt: number): PresenceMutation;
	remove(expected: PresenceRecord): PresenceMutation;
	scan(root: string): PresenceScan;
	legacy(root: string): "absent" | "present" | "unknown";
}
class PresenceProblem extends Error {
	constructor(readonly issue: WriterIssueCode) {
		super(issue);
	}
}
function errno(error: unknown): string | undefined {
	return error !== null && typeof error === "object" && "code" in error
		? String(error.code)
		: undefined;
}
function presenceIssue(error: unknown): WriterIssueCode {
	return error instanceof PresenceProblem ? error.issue : "record-io";
}

/** Per-instance record operations, not a worktree ownership/locking protocol. */
export function createPresenceFiles(
	stateDir: string,
	overrides?: Partial<PresenceFsOps>,
): PresenceFiles {
	const fs: PresenceFsOps = { ...nodeFs, ...overrides };
	const base = join(stateDir, "presence");
	const directory = (root: string) => join(base, presenceDirectoryKey(root));

	function checkDirectory(path: string, create: boolean): void {
		try {
			fs.lstatSync(path);
		} catch (error) {
			if (!create || errno(error) !== "ENOENT") throw error;
			try {
				fs.mkdirSync(path, { mode: 0o700 });
			} catch (mkdirError) {
				if (errno(mkdirError) !== "EEXIST") throw mkdirError;
			}
		}
		const stat = fs.lstatSync(path);
		if (stat.isSymbolicLink()) throw new PresenceProblem("record-symlink");
		if (!stat.isDirectory()) throw new PresenceProblem("record-invalid");
	}
	function prepare(root: string, create: boolean): string {
		if (create) fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
		checkDirectory(base, create);
		const dir = directory(root);
		checkDirectory(dir, create);
		return dir;
	}
	function readRecord(path: string): PresenceRecord {
		const stat = fs.lstatSync(path);
		if (stat.isSymbolicLink()) throw new PresenceProblem("record-symlink");
		if (!stat.isFile()) throw new PresenceProblem("record-invalid");
		const fd = fs.openSync(
			path,
			nodeFs.constants.O_RDONLY |
				nodeFs.constants.O_NOFOLLOW |
				nodeFs.constants.O_NONBLOCK,
		);
		let text: string;
		try {
			if (!fs.fstatSync(fd).isFile())
				throw new PresenceProblem("record-invalid");
			const buffer = Buffer.alloc(16 * 1024 + 1);
			let total = 0;
			while (total < buffer.length) {
				const count = fs.readSync(
					fd,
					buffer,
					total,
					buffer.length - total,
					null,
				);
				if (count === 0) break;
				total += count;
			}
			if (total > 16 * 1024) throw new PresenceProblem("record-size");
			text = buffer.subarray(0, total).toString("utf8");
		} finally {
			fs.closeSync(fd);
		}
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch {
			throw new PresenceProblem("record-invalid");
		}
		const parsed = parsePresenceRecord(raw);
		if (parsed === null) throw new PresenceProblem("record-invalid");
		return parsed;
	}
	function verifyOwn(path: string, expected: PresenceRecord): void {
		const actual = readRecord(path);
		for (const key of [
			"instanceId",
			"sessionId",
			"host",
			"pid",
			"worktreeRoot",
		] as const) {
			if (actual[key] !== expected[key])
				throw new PresenceProblem("record-unowned");
		}
	}
	function mutate(
		kind: "create" | "update" | "remove",
		expected: PresenceRecord,
		now = expected.lastSeenAt,
	): PresenceMutation {
		const result: PresenceMutation = { outcome: "failed", issues: [] };
		let temp: string | undefined;
		try {
			const next = parsePresenceRecord({ ...expected, lastSeenAt: now });
			if (next === null) throw new PresenceProblem("record-invalid");
			const dir = prepare(expected.worktreeRoot, kind === "create");
			const path = join(dir, `${expected.instanceId}.json`);
			if (kind !== "create") verifyOwn(path, expected);
			if (kind === "remove") fs.unlinkSync(path);
			else {
				const candidate = join(dir, `.tmp-${randomUUID()}`);
				const fd = fs.openSync(candidate, "wx", 0o600);
				temp = candidate; // Only cleanup a file this call actually created.
				try {
					fs.writeFileSync(fd, `${JSON.stringify(next)}\n`, "utf8");
				} finally {
					fs.closeSync(fd);
				}
				if (kind === "create") fs.linkSync(candidate, path);
				else {
					fs.renameSync(candidate, path);
					temp = undefined;
				}
			}
			result.outcome = "done";
		} catch (error) {
			if (errno(error) === "ENOENT") {
				result.outcome = "missing";
				result.issues.push("record-missing");
			} else if (errno(error) === "EEXIST") {
				result.outcome = "unowned";
				result.issues.push("record-collision");
			} else {
				result.outcome =
					error instanceof PresenceProblem ? "unowned" : "failed";
				result.issues.push(presenceIssue(error));
			}
		} finally {
			if (temp !== undefined) {
				try {
					fs.unlinkSync(temp);
				} catch {
					result.issues.push("temp-cleanup");
				}
			}
		}
		return result;
	}
	function scan(root: string): PresenceScan {
		const records: PresenceRecord[] = [];
		const issues = new Set<WriterIssueCode>();
		try {
			const dir = prepare(root, false);
			const entries = fs.opendirSync(dir);
			try {
				let count = 0;
				for (
					let entry = entries.readSync();
					entry !== null;
					entry = entries.readSync()
				) {
					if (++count > 256) {
						issues.add("scan-limit");
						break;
					}
					if (/^\.tmp-[a-f0-9-]{36}$/.test(entry.name)) continue;
					if (!entry.name.endsWith(".json")) {
						issues.add("record-invalid");
						continue;
					}
					try {
						const record = readRecord(join(dir, entry.name));
						if (
							entry.name !== `${record.instanceId}.json` ||
							record.worktreeRoot !== root
						)
							throw new PresenceProblem("record-invalid");
						records.push(record);
					} catch (error) {
						issues.add(presenceIssue(error));
					}
				}
			} finally {
				entries.closeSync();
			}
		} catch (error) {
			if (errno(error) !== "ENOENT") issues.add(presenceIssue(error));
		}
		return { records, issues: [...issues] };
	}
	return {
		create: (record) => mutate("create", record),
		update: (record, now) => mutate("update", record, now),
		remove: (record) => mutate("remove", record),
		scan,
		legacy(root) {
			try {
				const locks = fs.lstatSync(join(stateDir, "locks"));
				if (!locks.isDirectory() || locks.isSymbolicLink()) return "unknown";
				const stat = fs.lstatSync(join(stateDir, "locks", lockFilePath(root)));
				return stat.isSymbolicLink() ? "unknown" : "present";
			} catch (error) {
				return errno(error) === "ENOENT" ? "absent" : "unknown";
			}
		},
	};
}

const STATE_SUBDIR = join("state", "agents-guard");

export function resolveStateDir(
	env: Record<string, string | undefined>,
	home: string,
): string {
	const agentDir = env.PI_CODING_AGENT_DIR ?? join(home, ".pi", "agent");
	return join(agentDir, STATE_SUBDIR);
}

export function readJsonFile(path: string): { value: unknown; error?: string } {
	if (!existsSync(path)) return { value: undefined };
	try {
		return { value: JSON.parse(readFileSync(path, "utf8")) };
	} catch (error) {
		return {
			value: undefined,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** Write via tmp + rename so a reader never observes a partial file. */
export function writeJsonFileAtomic(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	renameSync(tmp, path);
}

export function statMtimeMs(path: string): number | null {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return null;
	}
}

export function removeFile(path: string): void {
	rmSync(path, { force: true });
}
