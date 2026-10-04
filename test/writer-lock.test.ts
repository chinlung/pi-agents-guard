import { describe, expect, it } from "vitest";
import { lockFilePath } from "../src/modules/writer-lock.js";

// The strong-lock decision table was intentionally retired. Advisory behavior
// is covered in writer-presence, writer-lock-runtime and extension tests.
describe("legacy lockFilePath (read-only compatibility)", () => {
	it("is a deterministic 16-char hex filename for the same root", () => {
		const a = lockFilePath("/Users/me/project");
		const b = lockFilePath("/Users/me/project");
		expect(a).toBe(b);
		expect(a).toMatch(/^[0-9a-f]{16}\.json$/);
	});
	it("differs for different roots", () => {
		expect(lockFilePath("/Users/me/project-a")).not.toBe(
			lockFilePath("/Users/me/project-b"),
		);
	});
});
