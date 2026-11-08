import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
	reportRecording,
	fetchModeration,
	updateModeration,
	fetchModerationComments,
	deleteModerationComment,
} from "./api.ts";
const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

test("guest reporting sends a report without owner credentials", async () => {
	globalThis.fetch = async (url, init) => {
		assert.equal(url, "/s/example/report");
		assert.equal(init?.method, "POST");
		assert.equal(init?.credentials, "include");
		assert.deepEqual(init?.headers, { "Content-Type": "application/json" });
		assert.deepEqual(JSON.parse(String(init?.body)), {
			reason: "privacy",
			details: "Please review this",
		});
		return Response.json({ ok: true });
	};
	await reportRecording("example", "privacy", " Please review this ");
});

test("throttled reporting preserves a useful retry error", async () => {
	globalThis.fetch = async () => new Response("{}", { status: 429 });
	await assert.rejects(reportRecording("example", "spam", "draft"), /wait.*draft is saved/);
});

test("owner controls and comment moderation carry bearer auth only to the owner endpoints", async () => {
	const requests: Array<{ url: unknown; init: RequestInit | undefined }> = [];
	globalThis.fetch = async (url, init) => {
		requests.push({ url, init });
		assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token");
		return init?.method === "DELETE"
			? new Response(null, { status: 204 })
			: Response.json({ feedbackEnabled: false, sharingEnabled: true });
	};
	await fetchModeration("example", "test-token");
	await updateModeration("example", "test-token", { feedbackEnabled: false });
	await fetchModerationComments("example", "test-token", 2);
	await deleteModerationComment("example", "test-token", 42);
	assert.deepEqual(
		requests.map(({ url }) => url),
		[
			"/api/moderation/example",
			"/api/moderation/example",
			"/api/moderation/example/comments?page=2&limit=50",
			"/api/moderation/example/comments/42",
		],
	);
	assert.deepEqual(JSON.parse(String(requests[1].init?.body)), { feedbackEnabled: false });
	assert.equal(requests[3].init?.method, "DELETE");
});

test("expired sessions surface a sign-in message for owner controls", async () => {
	globalThis.fetch = async () => new Response("{}", { status: 401 });
	await assert.rejects(fetchModeration("example", "expired"), /Sign in again/);
});

test("owner controls retain the operator block separately from a paused link", async () => {
	globalThis.fetch = async () =>
		Response.json({ feedbackEnabled: true, sharingEnabled: false, sharingBlocked: true });
	assert.deepEqual(await fetchModeration("blocked", "test-token"), {
		feedbackEnabled: true,
		sharingEnabled: false,
		sharingBlocked: true,
	});
});
