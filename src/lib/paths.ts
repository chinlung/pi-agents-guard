import { isAbsolute, resolve } from "node:path";
import { minimatch } from "minimatch";

export interface PathResolver {
	realpathSync: (path: string) => string;
	cwd: string;
	home: string;
}

/**
 * Every form of `candidate` a protected-path rule must be checked against: the
 * path as referenced (absolutized) and its symlink-resolved target.
 *
 * pi-guard compares only the literal token, so
 * `ln -s ~/.pi/agent/settings.json /tmp/s && echo x > /tmp/s` evades it.
 */
export function normalizeCandidate(
	candidate: string,
	resolver: PathResolver,
): string[] {
	const trimmed = candidate.replace(/^@/, "");
	const expanded = trimmed.startsWith("~/")
		? resolve(resolver.home, trimmed.slice(2))
		: trimmed;
	const absolute = isAbsolute(expanded)
		? expanded
		: resolve(resolver.cwd, expanded);

	const variants = [absolute];
	try {
		const real = resolver.realpathSync(absolute);
		if (real !== absolute) variants.push(real);
	} catch {
		// A path that does not exist yet cannot be realpath'd; the literal form is
		// still a valid thing to gate on, because a write would create it.
	}
	return variants;
}

/** The first protected pattern `candidate` matches, or null when none do. */
export function matchesProtected(
	candidate: string,
	patterns: string[],
	resolver: PathResolver,
): string | null {
	const variants = normalizeCandidate(candidate, resolver);
	for (const pattern of patterns) {
		for (const variant of variants) {
			if (minimatch(variant, pattern, { dot: true })) return pattern;
		}
	}
	return null;
}
