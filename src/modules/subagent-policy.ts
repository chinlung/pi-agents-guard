import type {
	Decision,
	SubagentPolicyFacts,
	SubagentPolicyOptions,
} from "../types.js";

/** Keys whose presence marks a call as execution (as opposed to management). */
const EXECUTION_KEYS: readonly string[] = [
	"agent",
	"workflowScript",
	"workflowScriptPath",
	"workflow",
];

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function isExecutionCall(input: Record<string, unknown>): boolean {
	if (asString(input.action) !== undefined) return false;
	return EXECUTION_KEYS.some((key) => input[key] !== undefined);
}

function matchesAny(value: string, patterns: string[]): boolean {
	const lower = value.toLowerCase();
	return patterns.some(
		(pattern) => pattern !== "" && lower.includes(pattern.toLowerCase()),
	);
}

function blockReason(what: string, detail: string): string {
	return [
		`[agents-guard/subagent-policy] 已阻擋：${what}`,
		`  ${detail}`,
		"  這是 AGENTS.md 的 MUST 級防線，不提供單次放行選項。",
	].join("\n");
}

/**
 * Pure decision core for the three subagent-dispatch rules in design.md §5.2.
 * No I/O, no pi API — every fact the rules need arrives via `facts`/`opts`.
 */
export function decideSubagentCall(
	input: Record<string, unknown>,
	facts: SubagentPolicyFacts,
	opts: SubagentPolicyOptions,
): Decision {
	// Rule 1 (AGENTS.md:88): a dispatching call must first have listed
	// available agents. Management/control calls (those carrying `action`)
	// are exempt, and this rule has no downstream consumer inside a child
	// session (the parent's brief already picked the agent), so it is
	// disabled there — see design.md §5.5.
	if (
		!facts.isSubagentChild &&
		!facts.capabilitiesListed &&
		isExecutionCall(input)
	) {
		return {
			kind: "block",
			reason: blockReason(
				"派發前未列出可用 agent",
				'請先呼叫 { action: "list", capabilities: true }，確認要派發的 agent 可執行、未停用後再派發。（AGENTS.md:88）',
			),
		};
	}

	// Rule 2 (AGENTS.md:91): review/audit/security/threat work must not be
	// silently downgraded to a weak model. Only fires when `model` is given
	// explicitly — omitting it means "use the agent's own default", which is
	// not a downgrade.
	const model = asString(input.model);
	if (model !== undefined && matchesAny(model, opts.weakModelPatterns)) {
		const agent = asString(input.agent) ?? "";
		const task = asString(input.task) ?? "";
		if (
			matchesAny(agent, opts.reviewIntentPatterns) ||
			matchesAny(task, opts.reviewIntentPatterns)
		) {
			return {
				kind: "block",
				reason: blockReason(
					"高風險任務被指定使用弱模型",
					`agent=${agent || "(未命名)"}  model=${model}  高風險 review/audit 類任務不得降級。（AGENTS.md:91）`,
				),
			};
		}
	}

	// Rule 3 (AGENTS.md:92): native-only Pi child options do not apply to
	// external CLI runners unless their contract explicitly supports them.
	const agent = asString(input.agent);
	if (agent !== undefined && opts.externalCliAgents.includes(agent)) {
		const violating = opts.nativeOnlyOptions.filter(
			(key) => input[key] !== undefined,
		);
		if (violating.length > 0) {
			return {
				kind: "block",
				reason: blockReason(
					"external CLI agent 收到 native-only 選項",
					`agent=${agent}  違規欄位=${violating.join(", ")}  外部 runner 不套用這些選項，除非其 contract 明示支援。（AGENTS.md:92）`,
				),
			};
		}
	}

	return { kind: "pass" };
}
