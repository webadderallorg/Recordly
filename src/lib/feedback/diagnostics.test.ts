import { describe, expect, it } from "vitest";
import { redactDiagnostic } from "./diagnostics";
import { validateAttachments } from "./submitFeedback";

describe("feedback diagnostics", () => {
	it("removes common secrets and personal paths from log messages", () => {
		const result = redactDiagnostic(
			"Bearer abc123 password=hunter2 someone@example.com /Users/young/private.txt https://example.com?token=abc",
		);
		for (const secret of ["abc123", "hunter2", "someone@example.com", "young", "example.com"])
			expect(result).not.toContain(secret);
	});
	it("bounds individual log entries", () =>
		expect(redactDiagnostic("x".repeat(5000))).toHaveLength(2000));
	it("enforces attachment count, total size, and nonempty files", () => {
		const file = (size: number) => ({ size }) as File;
		expect(validateAttachments(Array.from({ length: 6 }, () => file(1)))).toBeTruthy();
		expect(validateAttachments([file(6 * 1024 * 1024), file(5 * 1024 * 1024)])).toBeTruthy();
		expect(validateAttachments([file(0)])).toBeTruthy();
		expect(validateAttachments([file(100)])).toBeNull();
	});
});

it("bounds final JSON bytes for Unicode, escapes, and oversized metadata", async () => {
	const { vi } = await import("vitest");
	vi.stubGlobal("window", new EventTarget());
	vi.stubGlobal("navigator", { platform: "平台".repeat(5000), userAgent: "代理".repeat(5000) });
	const { installFeedbackDiagnostics, feedbackDiagnostics } = await import("./diagnostics");
	const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
	try {
		installFeedbackDiagnostics();
		for (let i = 0; i < 100; i++) console.warn(`${i}: ${'中\\\"\u0001'.repeat(500)}`);
		const payload = feedbackDiagnostics();
		expect(new TextEncoder().encode(payload).length).toBeLessThanOrEqual(290000);
		const data = JSON.parse(payload);
		expect(data.logs.length).toBeGreaterThan(0);
		expect(data.logs.length).toBeLessThan(100);
		expect(data.logs.at(-1)).toContain("99:");
		expect(data.capturedAt).toBeTruthy();
	} finally {
		warn.mockRestore();
		vi.unstubAllGlobals();
	}
});
