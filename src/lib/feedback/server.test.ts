import { beforeEach, expect, it, vi } from "vitest";
import { feedbackHandler } from "../../../services/supabase/functions/submit-feedback/handler";
const backend = {
	authenticate: vi.fn(),
	reserve: vi.fn(),
	upload: vi.fn(),
	insert: vi.fn(),
	remove: vi.fn(),
};
const handle = feedbackHandler(backend);
function request(files = [new File(["notes"], "notes.txt")], logs = "logs") {
	const body = new FormData();
	body.set("title", "Bug");
	body.set("subject", "bug");
	body.set("message", "Steps");
	body.set("logs", logs);
	for (const file of files) body.append("files", file);
	return new Request("https://example.test", {
		method: "POST",
		headers: { Authorization: "Bearer session" },
		body,
	});
}
beforeEach(() => {
	vi.resetAllMocks();
	backend.authenticate.mockResolvedValue("user-id");
	backend.reserve.mockResolvedValue(true);
	backend.upload.mockResolvedValue(undefined);
	backend.insert.mockResolvedValue(undefined);
	backend.remove.mockResolvedValue(undefined);
});
it("authenticates and reserves quota before uploading, then saves server-owned paths", async () => {
	expect((await handle(request())).status).toBe(200);
	expect(backend.reserve).toHaveBeenCalledWith("user-id", 1, 5);
	expect(backend.reserve.mock.invocationCallOrder[0]).toBeLessThan(
		backend.upload.mock.invocationCallOrder[0],
	);
	expect(backend.insert).toHaveBeenCalledWith(
		expect.objectContaining({
			user_id: "user-id",
			attachments: [expect.objectContaining({ path: expect.stringMatching(/^user-id\//) })],
		}),
	);
});
it("rejects unauthenticated requests and exhausted quotas before storage", async () => {
	backend.authenticate.mockResolvedValueOnce(null);
	expect((await handle(request())).status).toBe(401);
	expect(backend.reserve).not.toHaveBeenCalled();
	backend.reserve.mockResolvedValue(false);
	expect((await handle(request())).status).toBe(429);
	expect(backend.upload).not.toHaveBeenCalled();
});
it("enforces attachment and diagnostics limits against direct requests", async () => {
	for (const req of [
		request(Array.from({ length: 6 }, () => new File(["x"], "x"))),
		request([new File([], "empty")]),
		request([
			new File([new Uint8Array(6 * 1024 * 1024)], "a"),
			new File([new Uint8Array(5 * 1024 * 1024)], "b"),
		]),
		request([], "中".repeat(100001)),
	]) {
		expect((await handle(req)).status).toBe(400);
	}
	expect(backend.reserve).not.toHaveBeenCalled();
	expect(backend.upload).not.toHaveBeenCalled();
});
it("cleans partial uploads and does not expose backend errors", async () => {
	backend.insert.mockRejectedValue(new Error("private db details"));
	const response = await handle(request());
	expect(response.status).toBe(500);
	expect(await response.json()).toEqual({ code: "SUBMISSION_FAILED" });
	expect(backend.remove).toHaveBeenCalledWith([expect.stringMatching(/^user-id\//)]);
});
it("caps a valid multipart stream before consuming the entire oversized upload", async () => {
	const multipart = request([new File([new Uint8Array(16 * 1024 * 1024)], "large.bin")]);
	const bytes = new Uint8Array(await multipart.arrayBuffer());
	let produced = 0;
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (produced === bytes.length) {
				controller.close();
				return;
			}
			const end = Math.min(produced + 64 * 1024, bytes.length);
			controller.enqueue(bytes.slice(produced, end));
			produced = end;
		},
		cancel() {
			cancelled = true;
		},
	});
	const req = new Request("https://example.test", {
		method: "POST",
		headers: multipart.headers,
		body,
		duplex: "half",
	} as RequestInit);
	expect(req.headers.has("content-length")).toBe(false);
	expect((await handle(req)).status).toBe(400);
	expect(backend.reserve).not.toHaveBeenCalled();
	expect(cancelled).toBe(true);
	expect(produced).toBeLessThan(bytes.length);
});
