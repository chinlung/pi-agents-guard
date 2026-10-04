import type { ExecFn } from "../lib/git.js";
import {
	combineEvidence,
	detectGitEvents,
	formatCiEvidence,
	formatCommitEvidence,
	formatPushEvidence,
} from "../modules/git-evidence.js";
import type { GitEvidenceOptions } from "../types.js";

export interface GitEvidenceCoordinatorDeps {
	exec: ExecFn;
	cwd: string;
	getOptions(): GitEvidenceOptions;
}

export interface GitEvidenceCoordinator {
	augment(
		command: string,
		isError: boolean,
		signal: AbortSignal | undefined,
	): Promise<string | undefined>;
}

export function createGitEvidenceCoordinator(
	deps: GitEvidenceCoordinatorDeps,
): GitEvidenceCoordinator {
	return {
		async augment(command, isError, signal) {
			const events = detectGitEvents(command, isError);
			if (events.length === 0) return undefined;

			const opts = deps.getOptions();
			const cwd = deps.cwd;
			const parts: string[] = [];

			for (const event of events) {
				if (event.kind === "commit") {
					const log = await deps.exec(
						"git",
						["log", "-1", "--format=%H %d %s"],
						{ cwd, signal },
					);
					parts.push(formatCommitEvidence(log.stdout));
					continue;
				}

				const head = await deps.exec("git", ["rev-parse", "HEAD"], {
					cwd,
					signal,
				});
				const upstream = await deps.exec("git", ["rev-parse", "@{u}"], {
					cwd,
					signal,
				});
				parts.push(
					formatPushEvidence(
						head.stdout.trim(),
						upstream.code === 0 ? upstream.stdout.trim() : null,
						event.remote,
					),
				);

				if (opts.checkCi) {
					let ciOutput: string | null = null;
					try {
						const ci = await deps.exec("gh", ["run", "list", "-L", "3"], {
							cwd,
							signal,
						});
						ciOutput = ci.code === 0 ? ci.stdout : null;
					} catch {
						ciOutput = null;
					}
					parts.push(formatCiEvidence(ciOutput));
				}
			}

			return combineEvidence(parts, opts.maxAppendBytes);
		},
	};
}
