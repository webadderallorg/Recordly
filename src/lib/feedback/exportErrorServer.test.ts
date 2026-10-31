import { beforeEach, expect, it, vi } from "vitest";
import { exportErrorHandler } from "../../../services/supabase/functions/submit-export-error/handler";
import { buildExportErrorReport } from "./exportErrorReporting";
const backend = { reserve: vi.fn(), insert: vi.fn() };
const handle = exportErrorHandler(backend);
const valid = () =>
	JSON.parse(
		JSON.stringify(
			buildExportErrorReport(
				"[VIDEO_DECODE_ENCODING_ERROR] failure (sourceTimeSec=0.500, chunkIndex=25)",
				"unknown",
				"mp4",
			),
		),
	);
const request = (body: unknown, headers?: Record<string, string>) =>
	new Request("https://example.test", {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
beforeEach(() => {
	vi.resetAllMocks();
	backend.reserve.mockResolvedValue(true);
	backend.insert.mockResolvedValue(undefined);
});
it("accepts a no-account report and reserves bounded quota before storage", async () => {
	const report = valid();
	expect((await handle(request(report))).status).toBe(200);
	expect(backend.insert).toHaveBeenCalledWith(report);
	expect(backend.reserve.mock.invocationCallOrder[0]).toBeLessThan(
		backend.insert.mock.invocationCallOrder[0],
	);
	expect(backend.insert.mock.calls[0][0]).not.toHaveProperty("user_id");
});
it("rejects identity-bearing headers or unexpected fields instead of storing them", async () => {
	for (const req of [
		request(valid(), { Authorization: "Bearer user-session" }),
		request({ ...valid(), user_id: "account" }),
		request({ ...valid(), logs: "private" }),
		request({ ...valid(), failure: { code: "UNKNOWN", message: "private path" } }),
	])
		expect((await handle(req)).status).toBe(400);
	expect(backend.reserve).not.toHaveBeenCalled();
	expect(backend.insert).not.toHaveBeenCalled();
});
it.each([
	{ cloudPlan: "user@example.com" },
	{ cloudPlan: { toString: "private" } },
	{ appVersion: "private" },
	{ platform: "private" },
	{ failure: { code: "PRIVATE_ERROR" } },
	{ failure: { code: "UNKNOWN", sourceTimeSec: -1 } },
	{ output: { width: 999999, height: 1080, fps: 30 } },
	{ schemaVersion: 2 },
])("rejects malformed fields %j", async (fields) => {
	expect((await handle(request({ ...valid(), ...fields }))).status).toBe(400);
	expect(backend.insert).not.toHaveBeenCalled();
});
it("rejects streamed oversized bodies without trusting Content-Length", async () => {
	let cancelled = false;
	const body = new ReadableStream({
		start(controller) {
			controller.enqueue(new Uint8Array(5000));
		},
		cancel() {
			cancelled = true;
		},
	});
	const req = new Request("https://example.test", {
		method: "POST",
		headers: { "Content-Type": "application/json", "Content-Length": "1" },
		body,
		duplex: "half",
	} as RequestInit);
	expect((await handle(req)).status).toBe(413);
	expect(cancelled).toBe(true);
	expect(backend.reserve).not.toHaveBeenCalled();
});
it("returns a quota error and hides backend failures", async () => {
	backend.reserve.mockResolvedValueOnce(false);
	expect((await handle(request(valid()))).status).toBe(429);
	expect(backend.insert).not.toHaveBeenCalled();
	backend.insert.mockRejectedValue(new Error("private database detail"));
	const response = await handle(request(valid()));
	expect(response.status).toBe(500);
	expect(await response.json()).toEqual({ code: "SUBMISSION_FAILED" });
});
