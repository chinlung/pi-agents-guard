import type { ExecFn } from "../lib/git.js";
import {
	decideRecheck,
	extractText,
	isPorcelainStatusCommand,
	isWriteTool,
} from "../modules/completion-diff-recheck.js";
import type { CompletionDiffRecheckOptions } from "../types.js";
import type { CompletionCheck, CompletionNotice } from "./contracts.js";

export interface CompletionControllerDeps {
	exec: ExecFn;
	isSubagentChild: boolean;
	getSettings(): {
		active: boolean;
		options: CompletionDiffRecheckOptions;
	};
	recordFailure(): void;
}

export interface CompletionController {
	observeToolResult(
		toolName: string,
		input: Record<string, unknown>,
		isError: boolean,
		content?: readonly { type: string; text?: unknown }[],
	): void;
	check(
		actualPorcelain: string,
		diffStat: string,
	): CompletionNotice | undefined;
	collect(
		cwd: string,
		signal?: AbortSignal,
	): Promise<CompletionCheck | undefined>;
	invalidate(): void;
	shutdown(): void;
}

export function createCompletionController(
	deps: CompletionControllerDeps,
): CompletionController {
	let hadWrites = false;
	let observedPorcelain: string | null = null;
	let followUpCount = 0;
	let completionGeneration = 0;
	let completionClosed = false;
	const completionCurrent = (generation: number, signal?: AbortSignal) =>
		generation === completionGeneration &&
		!completionClosed &&
		!deps.isSubagentChild &&
		hadWrites &&
		deps.getSettings().active &&
		!signal?.aborted;

	function checkCompletion(
		actualPorcelain: string,
		diffStat: string,
	): CompletionNotice | undefined {
		if (!completionCurrent(completionGeneration)) return undefined;
		try {
			const result = decideRecheck(
				observedPorcelain,
				actualPorcelain,
				{ hadWrites, followUpCount },
				deps.getSettings().options,
			);
			if (!result.changed) return undefined;
			const trimmedDiffStat = diffStat.trim();
			const card =
				trimmedDiffStat === ""
					? result.summary
					: `${result.summary}\n\n--- git diff --stat ---\n${trimmedDiffStat}`;
			if (result.shouldFollowUp) followUpCount += 1;
			return { card, shouldFollowUp: result.shouldFollowUp };
		} catch {
			deps.recordFailure();
			return undefined;
		}
	}

	async function collectCompletionDiff(
		cwd: string,
		signal?: AbortSignal,
	): Promise<CompletionCheck | undefined> {
		const generation = completionGeneration;
		const current = () => completionCurrent(generation, signal);
		if (!current()) return undefined;
		try {
			const status = await deps.exec("git", ["status", "--porcelain"], {
				cwd,
				signal,
			});
			if (!current() || status.code !== 0 || status.killed) return undefined;
			const stat = await deps.exec("git", ["diff", "--stat"], { cwd, signal });
			if (!current() || stat.killed) return undefined;
			const actualPorcelain = status.stdout;
			const diffStat = stat.code === 0 ? stat.stdout : "";
			let consumed = false;
			return {
				finish() {
					if (consumed) return undefined;
					consumed = true;
					if (!current()) return undefined;
					return checkCompletion(actualPorcelain, diffStat);
				},
			};
		} catch {
			if (current()) deps.recordFailure();
			return undefined;
		}
	}

	return {
		observeToolResult(toolName, input, isError, content) {
			if (isWriteTool(toolName) && !isError) {
				hadWrites = true;
			}
			if (toolName === "bash" && !isError && content !== undefined) {
				const command = input.command;
				if (typeof command === "string" && isPorcelainStatusCommand(command)) {
					const text = extractText(content);
					if (text !== undefined) observedPorcelain = text;
				}
			}
		},
		check: checkCompletion,
		collect: collectCompletionDiff,
		invalidate() {
			++completionGeneration;
		},
		shutdown() {
			completionClosed = true;
			++completionGeneration;
		},
	};
}
