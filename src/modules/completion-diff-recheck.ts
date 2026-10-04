import { enumerateCommands } from "../lib/bash.js";
import type {
	CompletionDiffRecheckOptions,
	RecheckFacts,
	RecheckResult,
} from "../types.js";

const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
	"write",
	"edit",
	"ast_grep_replace",
]);

export function isWriteTool(toolName: string): boolean {
	return WRITE_TOOL_NAMES.has(toolName);
}

export function isPorcelainStatusCommand(command: string): boolean {
	const { commands, parseFailed } = enumerateCommands(command);
	if (parseFailed) return false;
	return commands.some(
		(parsed) =>
			parsed.name === "git" &&
			parsed.args[0] === "status" &&
			parsed.args.some(
				(arg) => arg === "--porcelain" || arg.startsWith("--porcelain="),
			),
	);
}

export function extractText(
	content: readonly { type: string; text?: unknown }[],
): string | undefined {
	for (const block of content) {
		if (block.type === "text" && typeof block.text === "string")
			return block.text;
	}
	return undefined;
}

/**
 * Normalizes a porcelain snapshot for comparison. Treats an empty string and
 * the bash tool's own `"(no output)"` placeholder (see design.md deviation
 * #1) as the same "clean tree" value, and drops pure whitespace differences
 * between otherwise-identical lines.
 */
export function normalizePorcelain(text: string): string {
	const wholeTrimmed = text.trim();
	if (wholeTrimmed === "" || wholeTrimmed === "(no output)") return "";
	return text
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line.trim() !== "")
		.join("\n");
}

function buildSummary(
	observed: string | null,
	normalizedActual: string,
): string {
	const actualLines =
		normalizedActual === "" ? [] : normalizedActual.split("\n");
	if (actualLines.length === 0) {
		return observed === null
			? "agent 收尾時工作樹仍有未完成的變動，但此前整個 session 從未確認過 git 狀態，未有可比對的基準。"
			: "agent 最後回報時工作樹仍有未完成的變動，但收尾時實際已恢復成乾淨（可能已 commit 或被外部工具還原），與最後回報的狀態不同。";
	}
	return [
		`agent 收尾時偵測到 ${actualLines.length} 個檔案的狀態與最後回報不同：`,
		...actualLines,
	].join("\n");
}

/**
 * Pure decision core. `git diff --stat` is deliberately not an input here —
 * design.md marks it display-only, so it never participates in the verdict
 * (design.md deviation #2); the caller appends it to the displayed card.
 */
export function decideRecheck(
	observed: string | null,
	actual: string,
	facts: RecheckFacts,
	opts: CompletionDiffRecheckOptions,
): RecheckResult {
	if (!facts.hadWrites) {
		return { changed: false, summary: "", shouldFollowUp: false };
	}

	const normalizedActual = normalizePorcelain(actual);

	if (observed === null) {
		if (normalizedActual === "") {
			return { changed: false, summary: "", shouldFollowUp: false };
		}
		// No baseline to compare against — show a card, never follow up
		// (design.md §5.4: avoids false triggers on pure-analysis sessions).
		return {
			changed: true,
			summary: buildSummary(null, normalizedActual),
			shouldFollowUp: false,
		};
	}

	const normalizedObserved = normalizePorcelain(observed);
	if (normalizedActual === normalizedObserved) {
		return { changed: false, summary: "", shouldFollowUp: false };
	}

	return {
		changed: true,
		summary: buildSummary(observed, normalizedActual),
		shouldFollowUp:
			opts.followUp && facts.followUpCount < opts.maxFollowUpsPerSession,
	};
}
