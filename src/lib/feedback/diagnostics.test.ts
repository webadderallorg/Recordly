import { describe, expect, it, vi } from "vitest";
import packageInfo from "../../../package.json";
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
	it("redacts absolute project paths while retaining relative app frames", () => {
		expect(
			redactDiagnostic(
				'Could not open "/srv/client project/private.recordly"\nat (src/Dashboard.tsx:83:5)',
			),
		).toBe('Could not open "[local path]"\nat (src/Dashboard.tsx:83:5)');
	});
	it("enforces attachment count, total size, and nonempty files", () => {
		const file = (size: number) => ({ size }) as File;
		expect(validateAttachments(Array.from({ length: 6 }, () => file(1)))).toBeTruthy();
		expect(validateAttachments([file(50 * 1024 * 1024)])).toBeNull();
		expect(
			validateAttachments([file(25 * 1024 * 1024), file(25 * 1024 * 1024 + 1)]),
		).toBeTruthy();
		expect(validateAttachments([file(0)])).toBeTruthy();
		expect(validateAttachments([file(100)])).toBeNull();
	});
});

it("keeps a pending operation after completed operations fill recent history", async () => {
	vi.resetModules();
	vi.stubGlobal("window", { location: { href: "http://localhost/?windowType=editor" } });
	vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "Electron" });
	try {
		const { beginAppOperation, collectFeedbackDiagnostics, recordReactCrash } = await import(
			"./diagnostics"
		);
		const opening = beginAppOperation("home.open");
		opening.step("read-library");
		for (let index = 0; index < 100; index++)
			beginAppOperation("project.refresh").finish("succeeded");
		recordReactCrash(new Error("Home failed"));
		const report = JSON.parse(await collectFeedbackDiagnostics());
		expect(report.operationHistory).toHaveLength(180);
		expect(report.crash.activeOperations).toEqual([
			expect.objectContaining({ name: "home.open", stage: "read-library" }),
		]);
	} finally {
		vi.unstubAllGlobals();
	}
});

it("retries a repeated diagnostic after the in-flight write fails", async () => {
	vi.resetModules();
	vi.useFakeTimers();
	let finish!: (result: { success: boolean }) => void;
	const appendAppDiagnostics = vi
		.fn()
		.mockResolvedValue({ success: true })
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
	vi.stubGlobal("window", { electronAPI: { appendAppDiagnostics } });
	try {
		const { recordAppDiagnostic } = await import("./diagnostics");
		recordAppDiagnostic("Disk temporarily unavailable");
		recordAppDiagnostic("Disk temporarily unavailable");
		expect(appendAppDiagnostics).toHaveBeenCalledOnce();
		finish({ success: false });
		await vi.advanceTimersByTimeAsync(200);
		expect(appendAppDiagnostics).toHaveBeenCalledTimes(2);
		recordAppDiagnostic("Disk temporarily unavailable");
		expect(appendAppDiagnostics).toHaveBeenCalledTimes(2);
	} finally {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	}
});

it("bounds final JSON bytes for Unicode, escapes, and oversized metadata", async () => {
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
		expect(data.appVersion).toBe(packageInfo.version);
	} finally {
		warn.mockRestore();
		vi.unstubAllGlobals();
	}
});

it("keeps the crash stacks, runtime and native exit evidence alongside redacted logs", async () => {
	vi.resetModules();
	const appendAppDiagnostics = vi.fn().mockResolvedValue({ success: true });
	const exportEvent = "2026-11-24T09:59:00.000Z info: [export] rendered";
	const getExportDiagnostics = vi.fn().mockResolvedValue({ success: true, logs: [exportEvent] });
	const nativeExit =
		"2026-11-24T10:00:00.000Z error: [electron] editor renderer exited reason=oom exitCode=9";
	vi.stubGlobal("window", {
		location: { href: "http://127.0.0.1:4910/?windowType=editor" },
		electronAPI: {
			appendAppDiagnostics,
			getAppDiagnostics: async () => ({ success: true, logs: [nativeExit] }),
			getExportDiagnostics,
			getExportRuntimeInfo: async () => ({
				success: true,
				runtime: { platform: "darwin", arch: "arm64", versions: { electron: "43.8.3" } },
			}),
		},
	});
	vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "Electron" });
	try {
		const {
			beginAppOperation,
			collectFeedbackDiagnostics,
			recordReactCrash,
			setDiagnosticView,
		} = await import("./diagnostics");
		setDiagnosticView("home");
		const opening = beginAppOperation("home.open");
		opening.step("refresh-library");
		const crash = new TypeError(
			'Could not read "/Users/tester/private.recordly" token=secret-value',
		);
		crash.stack = `${crash.name}: ${crash.message}\n    at render (http://127.0.0.1:4910/assets/home-abc.js:43:20)\n    at callback (https://private.test/tmp/file.js?token=secret-value:8:2)`;
		const componentStack =
			"\n    at Dashboard (http://127.0.0.1:4910/src/Dashboard.tsx?t=12:83:5)";
		recordReactCrash(crash, componentStack);
		recordReactCrash(crash, componentStack);
		opening.finish("failed");
		recordReactCrash(new Error("Cleanup failed after the first crash"));
		const snapshot = await collectFeedbackDiagnostics();
		for (const privateValue of [
			"/Users",
			"private.recordly",
			"secret-value",
			"private.test",
			"127.0.0.1",
		])
			expect(snapshot).not.toContain(privateValue);
		expect(JSON.parse(snapshot)).toMatchObject({
			view: "home",
			runtime: { platform: "darwin", arch: "arm64", versions: { electron: "43.8.3" } },
			crash: {
				view: "home",
				errorName: "TypeError",
				stack: ["at render (home-abc.js:43:20)", "at callback ([source]:8:2)"],
				componentStack: ["at Dashboard (src/Dashboard.tsx:83:5)"],
				activeOperations: [{ name: "home.open", stage: "refresh-library" }],
			},
			relatedCrashes: [{ view: "home", message: "Cleanup failed after the first crash" }],
			logs: expect.arrayContaining([
				nativeExit,
				exportEvent,
				expect.stringContaining("[home] view changed"),
			]),
		});
		const steps = JSON.parse(snapshot).operationHistory.filter(
			(event: { name: string }) => event.name === "home.open",
		);
		expect(steps.map((event: { phase: string }) => event.phase)).toEqual([
			"start",
			"step",
			"finish",
		]);
		expect(new Set(steps.map((event: { operationId: string }) => event.operationId)).size).toBe(
			1,
		);
		expect(appendAppDiagnostics).toHaveBeenCalledTimes(3);
		expect(getExportDiagnostics).toHaveBeenCalledOnce();
	} finally {
		vi.unstubAllGlobals();
	}
});
