import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildExportErrorReport, submitExportErrorReport } from "./exportErrorReporting";
import { buildVideoDecodeRecoveryFailure } from "../exporter/streamingDecoderSupport";
import { isExportErrorReport } from "../../../services/supabase/functions/_shared/exportErrorReport";

beforeEach(() => {
	vi.stubEnv("VITE_SUPABASE_URL", "https://support.example.test");
	vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "public-key");
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});
it("keeps both decoder failures and allowlists numerical positions without uploading private text", () => {
	const first = new Error(
		"[VIDEO_DECODE_ENCODING_ERROR] VideoDecoder failure: private /Users/name/video.mp4 user@example.com (sourceTimeSec=0.500, chunkIndex=25, chunkBytes=101256)",
	);
	const second = new Error(
		"[VIDEO_DECODE_ENCODING_ERROR] VideoDecoder failure: Bearer secret (sourceTimeSec=0.520, chunkIndex=26, chunkBytes=5)",
	);
	const combined = buildVideoDecodeRecoveryFailure(first, second);
	expect(combined.message).toContain("Source corruption is not confirmed");
	expect(combined.cause).toEqual({ initial: first, software: second });
	const report = buildExportErrorReport(
		`${combined.message}\nFailure stage: Input video decoding\nOutput: 1920x1080 @ 30 FPS\nPlatform: Windows\nRecordly version: 1.4.0`,
		"paid",
		"mp4",
	);
	expect(report.failure.code).toBe("VIDEO_DECODE_RECOVERY_FAILED");
	expect(report.initialDecoder).toEqual({
		code: "VIDEO_DECODE_ENCODING_ERROR",
		sourceTimeSec: 0.5,
		chunkIndex: 25,
		chunkBytes: 101256,
	});
	expect(report.softwareDecoder?.sourceTimeSec).toBe(0.52);
	expect(isExportErrorReport(report)).toBe(true);
	const payload = JSON.stringify(report);
	for (const privateValue of [
		"/Users/",
		"name",
		"user@example.com",
		"Bearer",
		"secret",
		"video.mp4",
	])
		expect(payload).not.toContain(privateValue);
});
it("handles GIF, legacy and save failures with no free-text fallback", () => {
	const report = buildExportErrorReport(
		"Failed to save GIF at C:\\Users\\Alice\\private.gif",
		"not_paid",
		"gif",
	);
	expect(report).toMatchObject({
		cloudPlan: "not_paid",
		format: "gif",
		failure: { code: "SAVE_FAILED" },
		stage: "saving",
		platform: "unknown",
	});
	expect(isExportErrorReport(report)).toBe(true);
	expect(JSON.stringify(report)).not.toContain("Alice");
});
it("sends only after explicit submission without session auth, cookies, or a referrer", async () => {
	const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true })));
	vi.stubGlobal("fetch", fetchMock);
	const report = buildExportErrorReport("Export failed");
	expect(fetchMock).not.toHaveBeenCalled();
	await submitExportErrorReport(report);
	const [url, options] = fetchMock.mock.calls[0];
	expect(url).toBe("https://support.example.test/functions/v1/submit-export-error");
	expect(options.headers).toEqual({ "Content-Type": "application/json", apikey: "public-key" });
	expect(options.credentials).toBe("omit");
	expect(options.referrerPolicy).toBe("no-referrer");
	expect(JSON.parse(options.body)).toEqual(JSON.parse(JSON.stringify(report)));
	expect(options.signal).toBeInstanceOf(AbortSignal);
});
it.each([
	429, 500, 200,
])("does not claim success after an unconfirmed/failed response (%s)", async (status) => {
	vi.stubGlobal(
		"fetch",
		vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ code: "private backend detail" }), { status }),
			),
	);
	await expect(submitExportErrorReport(buildExportErrorReport("error"))).rejects.toThrow(
		status === 429 ? "busy" : "Could not send",
	);
});
it("does not send when support is unconfigured", async () => {
	vi.stubEnv("VITE_SUPABASE_URL", "");
	const fetchMock = vi.fn();
	vi.stubGlobal("fetch", fetchMock);
	await expect(submitExportErrorReport(buildExportErrorReport("error"))).rejects.toThrow(
		"unavailable",
	);
	expect(fetchMock).not.toHaveBeenCalled();
});

it.each([
	"<html>Gateway</html>",
	"OK",
	"null",
])("shows a safe fallback for malformed successful replies (%s)", async (body) => {
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
	await expect(submitExportErrorReport(buildExportErrorReport("error"))).rejects.toThrow(
		"Could not send the report. Please try again.",
	);
});
