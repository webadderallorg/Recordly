import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepError, keepLog } from "./keepConsole";

describe("keepConsole", () => {
	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("keepLog forwards every argument to console.log untouched", () => {
		keepLog("[smoke-export] Export run started", {
			format: "mp4",
			quality: "good",
		});
		expect(vi.mocked(console.log).mock.calls).toEqual([
			["[smoke-export] Export run started", { format: "mp4", quality: "good" }],
		]);
	});

	it("keepError forwards every argument to console.error untouched", () => {
		keepError("[smoke-export] Export failed", new Error("boom"));
		expect(vi.mocked(console.error).mock.calls).toEqual([
			["[smoke-export] Export failed", new Error("boom")],
		]);
	});

	it("calls are not syntactic console.* invocations so terser drop_console keeps them", () => {
		// Regression intent: the wrapper must dispatch through an aliased sink.
		// If someone "simplifies" it back to `console.log(...)`, the production
		// bundle goes silent again (vite terser drop_console) and only the
		// post-build marker check catches it. Keep the alias.
		const source = keepLog.toString();
		expect(source).not.toMatch(/console\.(log|error)\s*\(/);
	});
});
