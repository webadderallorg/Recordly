import { afterEach, expect, it, vi } from "vitest";
import { buildErrorReport, reportError } from "./errorReporting";
import { isSupportErrorReport } from "../../../services/supabase/functions/_shared/appErrorReport";
vi.mock("./diagnostics", async (original) => ({
	...(await original<typeof import("./diagnostics")>()),
	collectFeedbackDiagnostics: async () =>
		JSON.stringify({ appVersion: "1.4.0", logs: ["error: decoder unavailable"] }),
}));
afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});
it("includes actual logs and the redacted failure without requiring sign-in", async () => {
	const report = await buildErrorReport(
		"Failed /Volumes/Private Drive/video.mp4 secret=x",
		"project-load",
	);
	expect(isSupportErrorReport(report)).toBe(true);
	expect(report.error).not.toContain("Private");
	expect(JSON.parse(report.logs).logs).toContain("error: decoder unavailable");
});
it("sends the log snapshot and only confirms explicit server success", async () => {
	vi.stubEnv("VITE_SUPABASE_URL", "https://support.example.test");
	vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "public-key");
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(new Response("{}", { status: 200 }))
		.mockResolvedValueOnce(new Response('{"success":true}'));
	vi.stubGlobal("fetch", fetch);
	await expect(reportError("Failed", "notification")).rejects.toThrow("Could not send");
	await reportError("Failed", "notification");
	const options = fetch.mock.calls[1][1];
	expect(options.credentials).toBe("omit");
	expect(options.headers.Authorization).toBeUndefined();
	expect(JSON.parse(options.body)).toMatchObject({
		schemaVersion: 2,
		error: "Failed",
		context: "notification",
	});
	expect(JSON.parse(JSON.parse(options.body).logs).logs).toHaveLength(1);
});
