import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ getUser: vi.fn(), invoke: vi.fn() }));
vi.mock("@/lib/auth/recordlyAuth", () => ({
	recordlyAuth: { auth: { getUser: api.getUser }, functions: { invoke: api.invoke } },
}));
import { feedbackErrorMessage, submitFeedback } from "./submitFeedback";
const input = {
	title: " Bug ",
	subject: "bug",
	message: " Steps ",
	files: [new File(["notes"], "notes.txt")],
	logs: "logs",
};
beforeEach(() => {
	vi.resetAllMocks();
	api.getUser.mockResolvedValue({ data: { user: { id: "user-id" } }, error: null });
	api.invoke.mockResolvedValue({ data: { success: true }, error: null });
});
it("submits attachments and diagnostics through the server endpoint", async () => {
	await submitFeedback(input);
	const [name, { body }] = api.invoke.mock.calls[0];
	expect(name).toBe("submit-feedback");
	expect(body.get("title")).toBe("Bug");
	expect(body.get("message")).toBe("Steps");
	expect(body.get("logs")).toBe("logs");
	expect(body.getAll("files")[0].name).toBe("notes.txt");
});
it("does not submit when the session has expired and explains how to recover", async () => {
	api.getUser.mockResolvedValue({ data: { user: null }, error: null });
	const error = await submitFeedback(input).catch((error) => error);
	expect(feedbackErrorMessage(error)).toContain("sign in again");
	expect(api.invoke).not.toHaveBeenCalled();
});
it("shows the server quota error without exposing internal errors", async () => {
	api.invoke.mockResolvedValue({
		error: {
			context: new Response(JSON.stringify({ code: "FEEDBACK_LIMIT" }), { status: 429 }),
		},
	});
	const error = await submitFeedback(input).catch((error) => error);
	expect(feedbackErrorMessage(error)).toContain("tomorrow");
	expect(feedbackErrorMessage(new Error("database private details"))).toBe(
		"Could not send feedback. Please try again.",
	);
});
it("rejects unconfirmed submissions", async () => {
	api.invoke.mockResolvedValue({ data: {}, error: null });
	await expect(submitFeedback(input)).rejects.toThrow("not confirmed");
});

it("aborts a stalled request after one minute and permits a subsequent submission", async () => {
	const { FunctionsClient } = await import("@supabase/functions-js");
	vi.useFakeTimers();
	let signal: AbortSignal | null | undefined;
	try {
		const functions = new FunctionsClient("https://example.test/functions/v1", {
			customFetch: (_url, options) =>
				new Promise((_resolve, reject) => {
					signal = options?.signal;
					signal?.addEventListener(
						"abort",
						() => reject(new DOMException("Aborted", "AbortError")),
						{ once: true },
					);
				}),
		});
		api.invoke.mockImplementation(functions.invoke.bind(functions));
		const pending = submitFeedback(input).catch((error) => error);
		await vi.advanceTimersByTimeAsync(59_999);
		expect(signal?.aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(signal?.aborted).toBe(true);
		expect(feedbackErrorMessage(await pending)).toBe(
			"Could not send feedback. Please try again.",
		);
		api.invoke.mockResolvedValue({ data: { success: true }, error: null });
		await expect(submitFeedback(input)).resolves.toBeUndefined();
	} finally {
		vi.useRealTimers();
	}
});
