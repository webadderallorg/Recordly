import { takeCommentReturn } from "./commentAuth.ts";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beginCloudOAuth, cloudSignupMetadata, completeCloudCallback } from "./cloudAuth.ts";

function storage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key),
	};
}
function globals(t: TestContext) {
	for (const key of ["localStorage", "sessionStorage"]) {
		const before = Object.getOwnPropertyDescriptor(globalThis, key);
		Object.defineProperty(globalThis, key, { configurable: true, value: storage() });
		t.after(() => {
			if (before) Object.defineProperty(globalThis, key, before);
			else Reflect.deleteProperty(globalThis, key);
		});
	}
}

test("callback failures offer a new same-browser link without exchanging a session", async () => {
	const client = {
		auth: {
			exchangeCodeForSession: () => {
				throw new Error("must not exchange");
			},
		},
	} as unknown as SupabaseClient;
	assert.equal(await completeCloudCallback(client, "https://videos.recordly.dev/library"), false);
	await assert.rejects(
		completeCloudCallback(client, "https://videos.recordly.dev/library?error=access_denied"),
		/new link.*this browser/,
	);
});

test("expired PKCE callbacks keep actionable recovery copy", async (t) => {
	globals(t);
	const client = {
		auth: { exchangeCodeForSession: async () => ({ error: new Error("expired") }) },
	} as unknown as SupabaseClient;
	await assert.rejects(
		completeCloudCallback(client, "https://videos.recordly.dev/library?code=expired"),
		/expired or was opened in another browser/,
	);
});

test("OAuth notice is bound to its verifier and cannot overwrite an existing account", async (t) => {
	globals(t);
	const verifier = "test-pkce-verifier";
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	const challenge = Buffer.from(digest).toString("base64url");
	const key = `recordly-cloud-consent:${challenge}`;
	const pending = cloudSignupMetadata();
	localStorage.setItem(
		"recordly-cloud-auth-flow-testflow-code-verifier",
		JSON.stringify(verifier),
	);
	sessionStorage.setItem(key, JSON.stringify(pending));
	let updates = 0;
	let existing = false;
	const client = {
		auth: {
			exchangeCodeForSession: async (code: string, options: unknown) => {
				assert.equal(code, "code");
				assert.deepEqual(options, { flowId: "testflow" });
				return {
					error: null,
					data: {
						user: {
							created_at: existing
								? "2020-01-01T00:00:00Z"
								: new Date(Date.now() + 1000).toISOString(),
							user_metadata: {},
						},
					},
				};
			},
			updateUser: async ({ data }: { data: unknown }) => {
				updates++;
				assert.deepEqual(data, pending);
				return { error: null };
			},
		},
	} as unknown as SupabaseClient;
	assert.equal(
		await completeCloudCallback(
			client,
			"https://videos.recordly.dev/library?code=code&sb_flow_id=testflow",
		),
		true,
	);
	assert.equal(updates, 1);
	assert.equal(sessionStorage.getItem(key), null);
	existing = true;
	sessionStorage.setItem(key, JSON.stringify(pending));
	await completeCloudCallback(
		client,
		"https://videos.recordly.dev/library?code=code&sb_flow_id=testflow",
	);
	assert.equal(updates, 1);
	assert.equal("marketing_emails" in pending.signup_consent, false);
});

for (const provider of ["azure", "apple"] as const) {
	test(`${provider} OAuth redirects to this cloud library and fails closed without PKCE`, async (t) => {
		globals(t);
		let assigned = "";
		const before = Object.getOwnPropertyDescriptor(globalThis, "location");
		Object.defineProperty(globalThis, "location", {
			configurable: true,
			value: {
				assign: (url: string) => {
					assigned = url;
				},
			},
		});
		t.after(() => {
			if (before) Object.defineProperty(globalThis, "location", before);
			else Reflect.deleteProperty(globalThis, "location");
		});
		let url = "https://auth.example/authorize?code_challenge=challenge";
		const client = {
			auth: {
				signInWithOAuth: async (input: unknown) => {
					assert.deepEqual(input, {
						provider,
						options: {
							redirectTo: "https://videos.recordly.dev/library",
							skipBrowserRedirect: true,
							scopes: provider === "azure" ? "email" : undefined,
						},
					});
					return { data: { url }, error: null };
				},
			},
		} as unknown as SupabaseClient;
		await beginCloudOAuth(client, provider, "https://videos.recordly.dev");
		assert.equal(assigned, url);
		assert(sessionStorage.getItem("recordly-cloud-consent:challenge"));
		assigned = "";
		url = "https://auth.example/authorize";
		await assert.rejects(
			beginCloudOAuth(client, provider, "https://videos.recordly.dev"),
			/secure sign-in/,
		);
		assert.equal(assigned, "");
	});
}


test("comment OAuth returns to the recording only for its own completed PKCE flow", async (t) => {
  globals(t);
  const before = Object.getOwnPropertyDescriptor(globalThis, "location");
  let assigned = "";
  Object.defineProperty(globalThis, "location", { configurable: true, value: { assign: (url: string) => { assigned = url; } } });
  t.after(() => { if (before) Object.defineProperty(globalThis, "location", before); else Reflect.deleteProperty(globalThis, "location"); });
  const verifier = "comment-pkce-verifier";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = Buffer.from(digest).toString("base64url");
  const client = { auth: {
    signInWithOAuth: async () => ({ data: { url: `https://accounts.example.test/authorize?code_challenge=${challenge}` } }),
    exchangeCodeForSession: async () => ({ data: { user: { created_at: "2020-01-01", user_metadata: { signup_consent: true } } }, error: null }),
  } } as unknown as SupabaseClient;
  await beginCloudOAuth(client, "google", "https://videos.recordly.dev", "/s/abc123?t=12.5");
  assert.match(assigned, /code_challenge=/);
  localStorage.setItem("recordly-cloud-auth-code-verifier", JSON.stringify(verifier));
  let target: string | null = null;
  await completeCloudCallback(client, "https://videos.recordly.dev/library?code=callback", (flow) => { target = takeCommentReturn(flow); });
  assert.equal(target, "/s/abc123?t=12.5");
  assert.equal(takeCommentReturn(challenge), null);
});
