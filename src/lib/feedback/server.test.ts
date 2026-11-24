import { beforeEach, expect, it, vi } from "vitest";
import { feedbackHandler } from "../../../services/supabase/functions/submit-feedback/handler";
import { sendFeedbackNotification } from "../../../services/supabase/functions/submit-feedback/notification";
import {
	CHUNK_BYTES,
	feedbackUploads,
} from "../../../services/supabase/functions/submit-feedback/uploads";

it("enforces the large upload threshold, quota and exact chunk length before writing to Storage", async () => {
	const size = 50 * 1024 * 1024;
	const prepare = vi.fn().mockResolvedValueOnce("limit").mockResolvedValueOnce("ready");
	const append = vi.fn().mockResolvedValue(size);
	const handle = feedbackUploads({
		authenticate: async () => "user-id",
		prepare,
		find: async () => ({
			files: [{ name: "large.dat", type: "", size }],
			urls: { "0": "/upload" },
		}),
		append,
		saveUrl: vi.fn(),
		finish: vi.fn(),
		create: vi.fn(),
		offset: vi.fn(),
		notify: vi.fn(),
	});
	const call = (action: string, body: BodyInit, extra = "") => {
		const url = new URL(
			`https://example.test?upload=${action}&id=${crypto.randomUUID()}${extra}`,
		);
		return handle(
			new Request(url, {
				method: "POST",
				headers: { Authorization: "Bearer session" },
				body,
			}),
			url,
		);
	};
	const manifest = (size: number) =>
		JSON.stringify({ files: [{ name: "large.dat", type: "", size }] });
	expect((await call("prepare", manifest(size + 1))).status).toBe(400);
	expect(prepare).not.toHaveBeenCalled();
	expect((await call("prepare", manifest(size))).status).toBe(429);
	expect((await call("prepare", manifest(size))).status).toBe(200);
	const lastLength = size % CHUNK_BYTES;
	const lastOffset = `&file=0&offset=${size - lastLength}`;
	expect((await call("chunk", new Uint8Array(lastLength + 1), lastOffset)).status).toBe(400);
	expect(append).not.toHaveBeenCalled();
	expect(await (await call("chunk", new Uint8Array(lastLength), lastOffset)).json()).toEqual({
		offset: size,
	});
	expect(append).toHaveBeenCalledOnce();
});

const backend = {
	authenticate: vi.fn(),
	reserve: vi.fn(),
	upload: vi.fn(),
	insert: vi.fn(),
	remove: vi.fn(),
	notify: vi.fn(),
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
	backend.notify.mockResolvedValue(undefined);
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
	expect(backend.notify).toHaveBeenCalledWith(backend.insert.mock.calls[0][0].id);
	expect(backend.insert.mock.invocationCallOrder[0]).toBeLessThan(
		backend.notify.mock.invocationCallOrder[0],
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
	expect(backend.notify).not.toHaveBeenCalled();
});

it("notifies only after saving and keeps saved feedback when email delivery fails", async () => {
	const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
	try {
		backend.notify.mockRejectedValue(new Error("Resend returned HTTP 503"));
		const response = await handle(request());
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ success: true });
		const { id } = backend.insert.mock.calls[0][0];
		expect(backend.notify).toHaveBeenCalledExactlyOnceWith(id);
		expect(backend.insert.mock.invocationCallOrder[0]).toBeLessThan(
			backend.notify.mock.invocationCallOrder[0],
		);
		expect(backend.remove).not.toHaveBeenCalled();
		expect(log).toHaveBeenCalledWith(
			"Feedback notification failed",
			id,
			"Resend returned HTTP 503",
		);
	} finally {
		log.mockRestore();
	}
});

it("sends just a report reference to support and retries with the same idempotency key", async () => {
	const send = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(new Response(null, { status: 503 }))
		.mockResolvedValueOnce(new Response(null, { status: 200 }));
	await sendFeedbackNotification("test-report", "test-key", send);
	expect(send).toHaveBeenCalledTimes(2);
	const [url, request] = send.mock.calls[1];
	expect(url).toBe("https://api.resend.com/emails");
	expect(new Headers(request?.headers).get("Idempotency-Key")).toBe(
		"recordly-feedback/test-report",
	);
	expect(request?.headers).toEqual(send.mock.calls[0][1]?.headers);
	expect(request?.body).toBe(send.mock.calls[0][1]?.body);
	expect(JSON.parse(String(request?.body))).toEqual({
		from: "Recordly Feedback <feedback@auth.recordly.dev>",
		to: ["support@recordly.dev"],
		subject: "New Recordly feedback",
		text: "New feedback was saved. Open public.feedback_reports in Supabase and look up report test-report.",
	});
});

it("does not retry invalid provider credentials or call the provider without a key", async () => {
	const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
	await expect(sendFeedbackNotification("test-report", undefined, send)).rejects.toThrow(
		"FEEDBACK_RESEND_API_KEY is not configured",
	);
	expect(send).not.toHaveBeenCalled();
	await expect(sendFeedbackNotification("test-report", "test-key", send)).rejects.toThrow(
		"Resend returned HTTP 401",
	);
	expect(send).toHaveBeenCalledTimes(1);
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
