import { takeCommentReturn } from "./commentAuth.ts";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
	beginCloudOAuth,
	cloudSignupMetadata,
	completeCloudCallback,
	CloudSignupConsentRetryError,
} from "./cloudAuth.ts";

const authConfig = {
	url: "https://fixture.supabase.test",
	publishableKey: "sb_publishable_fixture",
};

function storage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key),
		entries: () => [...values.entries()],
	};
}
function globals(t: TestContext) {
	const beforeFetch = globalThis.fetch;
	t.after(() => {
		globalThis.fetch = beforeFetch;
	});
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

async function callbackFixture(t: TestContext, id: string) {
	globals(t);
	const verifierKey = `recordly-cloud-auth-flow-${id}-code-verifier`;
	const verifier = `private-verifier-${id}`;
	const challenge = Buffer.from(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
	).toString("base64url");
	const noticeKey = `recordly-cloud-consent:${challenge}`;
	const pending = cloudSignupMetadata();
	localStorage.setItem(verifierKey, JSON.stringify(verifier));
	sessionStorage.setItem(noticeKey, JSON.stringify(pending));
	let session = {
		user: {
			id: `account-${id}`,
			created_at: new Date(Date.now() + 1000).toISOString(),
			user_metadata: {} as Record<string, unknown>,
		},
		access_token: `private-token-${id}`,
	};
	const captured = session;
	const requests: Array<{ method: string; token: string | null; body?: unknown }> = [];
	let exchanges = 0;
	let failSave = true;
	let afterRead: () => void = () => undefined;
	let afterWrite: () => void = () => undefined;
	let saved: Record<string, unknown> = {};
	globalThis.fetch = async (url, init) => {
		assert.equal(String(url), "https://fixture.supabase.test/auth/v1/user");
		const method = init?.method ?? "GET";
		requests.push({
			method,
			token: new Headers(init?.headers).get("Authorization"),
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
		});
		assert.equal(requests[requests.length - 1]?.token, `Bearer ${captured.access_token}`);
		if (method === "GET") {
			afterRead();
			return Response.json({ ...captured.user, user_metadata: saved });
		}
		if (failSave) return Response.json({ error: "temporary failure" }, { status: 503 });
		saved = (JSON.parse(String(init?.body)) as { data: Record<string, unknown> }).data;
		afterWrite();
		return Response.json({ ...captured.user, user_metadata: saved });
	};
	const client = {
		auth: {
			exchangeCodeForSession: async () => {
				exchanges++;
				if (!localStorage.getItem(verifierKey))
					return { error: new Error("code was consumed"), data: {} };
				localStorage.removeItem(verifierKey);
				return { data: { user: captured.user, session: captured }, error: null };
			},
			getSession: async () => ({ data: { session }, error: null }),
			getUser: async (token: string) => {
				assert.equal(token, captured.access_token);
				return { data: { user: captured.user }, error: null };
			},
			updateUser: () => {
				throw new Error("SDK session must not select the consent account");
			},
		},
	} as unknown as SupabaseClient;
	return {
		client,
		pending,
		challenge,
		noticeKey,
		verifierKey,
		requests,
		href: `https://videos.recordly.dev/library?code=private-code-${id}&sb_flow_id=${id}`,
		exchanges: () => exchanges,
		succeed: () => {
			failSave = false;
		},
		switchAccount: () => {
			session = {
				user: {
					id: "another-account",
					created_at: captured.user.created_at,
					user_metadata: {},
				},
				access_token: "another-account-token",
			};
		},
		afterRead: (callback: () => void) => {
			afterRead = callback;
		},
		afterWrite: (callback: () => void) => {
			afterWrite = callback;
		},
		serverMetadata: (value: Record<string, unknown>) => {
			saved = value;
		},
	};
}

test("a failed legal save resumes after reload with one code exchange and the original comment return", async (t) => {
	const fixture = await callbackFixture(t, "resume");
	const { saveCommentReturn } = await import("./commentAuth.ts");
	saveCommentReturn("/s/original?t=12", fixture.challenge);
	await assert.rejects(
		completeCloudCallback(fixture.client, fixture.href, undefined, authConfig),
		CloudSignupConsentRetryError,
	);
	assert.equal(localStorage.getItem(fixture.verifierKey), null);
	assert(sessionStorage.getItem(fixture.noticeKey));
	const receipts = (sessionStorage as unknown as ReturnType<typeof storage>)
		.entries()
		.filter(([key]) => key.startsWith("recordly-cloud-completion:"));
	assert.equal(receipts.length, 1);
	assert(!JSON.stringify(receipts).includes("private-token-"));
	assert(!JSON.stringify(receipts).includes("private-code-"));
	// A fresh module has no in-memory completion map, as after a page reload.
	const reloaded = await import(new URL("./cloudAuth.ts?reload-resume", import.meta.url).href);
	fixture.succeed();
	let returnTo: string | null = null;
	assert.equal(
		await reloaded.completeCloudCallback(
			fixture.client,
			fixture.href,
			(challenge: string) => {
				returnTo = takeCommentReturn(challenge);
			},
			authConfig,
		),
		true,
	);
	assert.equal(returnTo, "/s/original?t=12");
	assert.equal(fixture.exchanges(), 1);
	assert.equal(sessionStorage.getItem(fixture.noticeKey), null);
	assert.deepEqual(
		fixture.requests.filter(({ method }) => method === "PUT").map(({ body }) => body),
		[{ data: fixture.pending }, { data: fixture.pending }],
	);
	await reloaded.completeCloudCallback(fixture.client, fixture.href, undefined, authConfig);
	assert.equal(fixture.exchanges(), 1);
	assert.equal(fixture.requests.length, 4);
});

test("a retry cannot save the previous account's notice or complete a new account's callback", async (t) => {
	const fixture = await callbackFixture(t, "switched-retry");
	await assert.rejects(
		completeCloudCallback(fixture.client, fixture.href, undefined, authConfig),
		CloudSignupConsentRetryError,
	);
	fixture.succeed();
	fixture.switchAccount();
	let completed = false;
	await assert.rejects(
		completeCloudCallback(
			fixture.client,
			fixture.href,
			() => {
				completed = true;
			},
			authConfig,
		),
		/account changed/,
	);
	assert.equal(completed, false);
	assert.equal(fixture.exchanges(), 1);
	assert.equal(fixture.requests.length, 2);
	assert(sessionStorage.getItem(fixture.noticeKey));
});

for (const phase of ["read", "write"] as const) {
	test(`an account change during the consent ${phase} rejects completion and never writes another account`, async (t) => {
		const fixture = await callbackFixture(t, `switch-${phase}`);
		fixture.succeed();
		if (phase === "read") fixture.afterRead(fixture.switchAccount);
		else fixture.afterWrite(fixture.switchAccount);
		let completed = false;
		await assert.rejects(
			completeCloudCallback(
				fixture.client,
				fixture.href,
				() => {
					completed = true;
				},
				authConfig,
			),
			/account changed/,
		);
		assert.equal(completed, false);
		assert.equal(
			fixture.requests.filter(({ method }) => method === "PUT").length,
			phase === "read" ? 0 : 1,
		);
		assert(
			fixture.requests.every(({ token }) => token === `Bearer private-token-switch-${phase}`),
		);
		assert(sessionStorage.getItem(fixture.noticeKey));
	});
}

test("changed pending consent cannot resume an exchanged callback", async (t) => {
	const fixture = await callbackFixture(t, "changed-notice");
	await assert.rejects(
		completeCloudCallback(fixture.client, fixture.href, undefined, authConfig),
		CloudSignupConsentRetryError,
	);
	sessionStorage.setItem(
		fixture.noticeKey,
		JSON.stringify({
			signup_consent: { ...fixture.pending.signup_consent, legal_accepted: false },
		}),
	);
	fixture.succeed();
	await assert.rejects(
		completeCloudCallback(fixture.client, fixture.href, undefined, authConfig),
		/notice no longer matches/,
	);
	assert.equal(fixture.exchanges(), 1);
	assert.equal(fixture.requests.length, 2);
});

test("only the accepted legal contract is written; browser marketing fields do not imply opt-in", async (t) => {
	const fixture = await callbackFixture(t, "legal-only");
	sessionStorage.setItem(
		fixture.noticeKey,
		JSON.stringify({
			signup_consent: { ...fixture.pending.signup_consent, marketing_emails: true },
			email_preferences: { product: true },
		}),
	);
	fixture.succeed();
	await completeCloudCallback(fixture.client, fixture.href, undefined, authConfig);
	assert.deepEqual(fixture.requests.find(({ method }) => method === "PUT")?.body, {
		data: fixture.pending,
	});
});

for (const existing of [false, null]) {
	test(`fresh server consent ${existing} is authoritative and cannot be replaced`, async (t) => {
		const fixture = await callbackFixture(t, `existing-${existing}`);
		fixture.serverMetadata({
			signup_consent: existing,
			email_preferences: { marketing: false },
		});
		await completeCloudCallback(fixture.client, fixture.href, undefined, authConfig);
		assert.equal(fixture.requests.length, 1);
		assert.equal(fixture.requests[0].method, "GET");
	});
}

test("missing or unsafe consent destinations fail before consuming the callback code", async (t) => {
	const fixture = await callbackFixture(t, "bad-config");
	for (const config of [
		undefined,
		{ ...authConfig, publishableKey: "sb_secret_fixture" },
		{ ...authConfig, url: "http://untrusted.example.test" },
	]) {
		await assert.rejects(
			completeCloudCallback(fixture.client, fixture.href, undefined, config),
			/configuration is unavailable/,
		);
	}
	assert.equal(fixture.exchanges(), 0);
	assert(localStorage.getItem(fixture.verifierKey));
	assert.equal(fixture.requests.length, 0);
});

test("expired PKCE callbacks keep actionable recovery copy", async (t) => {
	globals(t);
	const client = {
		auth: { exchangeCodeForSession: async () => ({ error: new Error("expired") }) },
	} as unknown as SupabaseClient;
	await assert.rejects(
		completeCloudCallback(
			client,
			"https://videos.recordly.dev/library?code=expired",
			undefined,
			authConfig,
		),
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
	let savedMetadata = {};
	const user = () => ({
		id: existing ? "existing-account" : "new-account",
		created_at: existing ? "2020-01-01T00:00:00Z" : new Date(Date.now() + 1000).toISOString(),
		user_metadata: existing ? {} : savedMetadata,
	});
	globalThis.fetch = async (url, init) => {
		assert.equal(String(url), "https://fixture.supabase.test/auth/v1/user");
		assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer captured-token");
		if (init?.method === "PUT") {
			updates++;
			assert.deepEqual(JSON.parse(String(init.body)), { data: pending });
			savedMetadata = pending;
		}
		return Response.json(user());
	};
	const client = {
		auth: {
			exchangeCodeForSession: async (code: string, options: unknown) => {
				assert.equal(code, existing ? "existing-code" : "code");
				assert.deepEqual(options, { flowId: "testflow" });
				return {
					error: null,
					data: {
						user: user(),
						session: { user: user(), access_token: "captured-token" },
					},
				};
			},
			getSession: async () => ({
				error: null,
				data: { session: { user: user(), access_token: "captured-token" } },
			}),
			getUser: async () => ({ error: null, data: { user: user() } }),
			updateUser: () => {
				throw new Error("must not reread an SDK session for consent writes");
			},
		},
	} as unknown as SupabaseClient;
	assert.equal(
		await completeCloudCallback(
			client,
			"https://videos.recordly.dev/library?code=code&sb_flow_id=testflow",
			undefined,
			authConfig,
		),
		true,
	);
	assert.equal(updates, 1);
	assert.equal(sessionStorage.getItem(key), null);
	existing = true;
	sessionStorage.setItem(key, JSON.stringify(pending));
	await completeCloudCallback(
		client,
		"https://videos.recordly.dev/library?code=existing-code&sb_flow_id=testflow",
		undefined,
		authConfig,
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
	const verifier = "comment-pkce-verifier";
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	const challenge = Buffer.from(digest).toString("base64url");
	const user = {
		id: "comment-account",
		created_at: "2020-01-01",
		user_metadata: { signup_consent: true },
	};
	const session = { user, access_token: "comment-token" };
	const client = {
		auth: {
			signInWithOAuth: async () => ({
				data: {
					url: `https://accounts.example.test/authorize?code_challenge=${challenge}`,
				},
			}),
			exchangeCodeForSession: async () => ({ data: { user, session }, error: null }),
			getSession: async () => ({ data: { session }, error: null }),
			getUser: async () => ({ data: { user }, error: null }),
		},
	} as unknown as SupabaseClient;
	await beginCloudOAuth(client, "google", "https://videos.recordly.dev", "/s/abc123?t=12.5");
	assert.match(assigned, /code_challenge=/);
	localStorage.setItem("recordly-cloud-auth-code-verifier", JSON.stringify(verifier));
	let target: string | null = null;
	await completeCloudCallback(
		client,
		"https://videos.recordly.dev/library?code=callback",
		(flow) => {
			target = takeCommentReturn(flow);
		},
		authConfig,
	);
	assert.equal(target, "/s/abc123?t=12.5");
	assert.equal(takeCommentReturn(challenge), null);
});
