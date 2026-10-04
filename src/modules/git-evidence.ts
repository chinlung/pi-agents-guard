import { enumerateCommands } from "../lib/bash.js";
import type { GitEvent } from "../types.js";

/**
 * Pure detector: only fires on a successful (isError === false) bash call
 * that actually invoked `git commit`/`git push` as a real subcommand —
 * never on a string that merely contains those words (`echo "git push"`).
 * Deliberately returns an array: `git commit -m x && git push` triggers
 * both events from one bash call (design.md deviation #2).
 */
export function detectGitEvents(command: string, isError: boolean): GitEvent[] {
	if (isError) return [];
	const { commands, parseFailed } = enumerateCommands(command);
	if (parseFailed) return [];

	const events: GitEvent[] = [];
	for (const parsed of commands) {
		if (parsed.name !== "git") continue;
		const sub = parsed.args[0];
		if (sub === "commit") {
			events.push({ kind: "commit" });
		} else if (sub === "push") {
			const remote = parsed.args.slice(1).find((arg) => !arg.startsWith("-"));
			events.push({ kind: "push", remote });
		}
	}
	return events;
}

export function formatCommitEvidence(logOutput: string): string {
	const trimmed = logOutput.trim();
	return [
		"--- [agents-guard] commit 驗證 ---",
		trimmed !== "" ? `HEAD: ${trimmed}` : "(無法取得 commit 資訊)",
	].join("\n");
}

export function formatPushEvidence(
	localSha: string,
	remoteSha: string | null,
	remote?: string,
): string {
	const header = `--- [agents-guard] push 驗證${remote !== undefined ? `（remote=${remote}）` : ""} ---`;
	if (remoteSha === null) {
		return [
			header,
			`local=${localSha}`,
			"無法取得上游追蹤分支（upstream 可能尚未設定），已略過比對。",
		].join("\n");
	}
	if (localSha === remoteSha) {
		return [header, `本地與遠端 SHA 一致：${localSha}`].join("\n");
	}
	return [
		header,
		`⚠️ 本地與遠端 SHA 不一致！local=${localSha} remote=${remoteSha}`,
	].join("\n");
}

export function formatCiEvidence(ciOutput: string | null): string {
	const header = "--- [agents-guard] CI 狀態 ---";
	if (ciOutput === null) return [header, "未檢查 CI（gh 不可用）"].join("\n");
	return [header, ciOutput.trim()].join("\n");
}

export function combineEvidence(
	parts: string[],
	maxAppendBytes: number,
): string {
	const combined = parts.join("\n\n");
	if (combined.length <= maxAppendBytes) return combined;
	return `${combined.slice(0, maxAppendBytes)}\n...[截斷，原長度 ${combined.length} bytes，上限 ${maxAppendBytes}]`;
}
