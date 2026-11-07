import { expect, it, vi } from "vitest";
import {
	saveSignupConsentForAccount,
	SignupConsentScopeChangedError,
	validateSignupConsentAuthConfig,
} from "./signupConsentTransport";

const config = { url: "https://project.supabase.test", publishableKey: "sb_publishable_fixture" };
const account = { userId: "account-a", accessToken: "captured-token-a" };
const consent = {
	version: "fixture-v1",
	legal_accepted: true,
	recorded_at: "2026-11-07T00:00:00Z",
};
const user = (metadata: Record<string, unknown> = {}, id = account.userId) => ({
	id,
	user_metadata: metadata,
});

it("verifies the captured account and sends only its exact accepted notice with the same token", async () => {
	const request = vi.fn<typeof fetch>(async (url, init) => {
		expect(String(url)).toBe("https://project.supabase.test/auth/v1/user");
		expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer captured-token-a");
		expect(new Headers(init?.headers).get("apikey")).toBe(config.publishableKey);
		expect(init?.credentials).toBe("omit");
		expect(init?.redirect).toBe("error");
		if (init?.method === "GET") return Response.json(user({ unrelated_preference: "keep" }));
		expect(init?.method).toBe("PUT");
		expect(JSON.parse(String(init?.body))).toEqual({ data: { signup_consent: consent } });
		return Response.json({
			user: user({ unrelated_preference: "keep", signup_consent: { ...consent } }),
		});
	});
	await expect(
		saveSignupConsentForAccount(config, account, consent, { fetch: request }),
	).resolves.toEqual({ status: "saved" });
	expect(request).toHaveBeenCalledTimes(2);
});

it.each([
	false,
	null,
	{ marketing_emails: false },
])("preserves an existing consent preference: %j", async (existing) => {
	const request = vi.fn<typeof fetch>(async () =>
		Response.json(user({ signup_consent: existing })),
	);
	await expect(
		saveSignupConsentForAccount(config, account, consent, { fetch: request }),
	).resolves.toEqual({ status: "already-present" });
	expect(request).toHaveBeenCalledTimes(1);
});

it("rejects a fresh account response belonging to another user before writing", async () => {
	const request = vi.fn<typeof fetch>(async () => Response.json(user({}, "account-b")));
	await expect(
		saveSignupConsentForAccount(config, account, consent, { fetch: request }),
	).rejects.toBeInstanceOf(SignupConsentScopeChangedError);
	expect(request).toHaveBeenCalledTimes(1);
});

it("does not write after the active account changes during the fresh read", async () => {
	let current = true;
	const request = vi.fn<typeof fetch>(async () => {
		current = false;
		return Response.json(user());
	});
	await expect(
		saveSignupConsentForAccount(config, account, consent, {
			fetch: request,
			isCurrent: async () => current,
		}),
	).rejects.toBeInstanceOf(SignupConsentScopeChangedError);
	expect(request).toHaveBeenCalledTimes(1);
});

it("keeps the PUT bound to the original token and rejects completion after a later account switch", async () => {
	let current = true;
	const captured = { ...account };
	const accepted = { ...consent };
	const request = vi.fn<typeof fetch>(async (_url, init) => {
		expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer captured-token-a");
		if (init?.method === "GET") {
			captured.accessToken = "new-account-token-b";
			accepted.legal_accepted = false;
			return Response.json(user());
		}
		expect(JSON.parse(String(init?.body))).toEqual({ data: { signup_consent: consent } });
		current = false;
		return Response.json(user({ signup_consent: consent }));
	});
	await expect(
		saveSignupConsentForAccount(config, captured, accepted, {
			fetch: request,
			isCurrent: async () => current,
		}),
	).rejects.toBeInstanceOf(SignupConsentScopeChangedError);
	expect(request).toHaveBeenCalledTimes(2);
});

it.each([
	"read",
	"write",
	"confirmation",
])("retains failure when the %s is not confirmed", async (phase) => {
	const request = vi.fn<typeof fetch>(async (_url, init) => {
		if (init?.method === "GET")
			return phase === "read" ? new Response("{}", { status: 503 }) : Response.json(user());
		if (phase === "write") return new Response("{}", { status: 503 });
		return Response.json(user({ signup_consent: { ...consent, legal_accepted: false } }));
	});
	await expect(
		saveSignupConsentForAccount(config, account, consent, { fetch: request }),
	).rejects.toThrow(/signup preferences/);
});

it.each([
	{ url: "http://external.example.test", publishableKey: config.publishableKey },
	{ url: "https://name:password@example.test", publishableKey: config.publishableKey },
	{ url: "https://example.test?redirect=elsewhere", publishableKey: config.publishableKey },
	{ url: config.url, publishableKey: "sb_secret_fixture" },
	{ url: config.url, publishableKey: "" },
])("rejects unsafe or non-public configuration before sending a token: %j", async (value) => {
	const request = vi.fn<typeof fetch>();
	await expect(
		saveSignupConsentForAccount(value, account, consent, { fetch: request }),
	).rejects.toThrow(/configuration/);
	expect(request).not.toHaveBeenCalled();
});

it("supports explicit local development and legacy anonymous public keys without accepting service-role keys", () => {
	const key = (role: string) =>
		`${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.fixture`;
	expect(
		validateSignupConsentAuthConfig({
			url: "http://127.0.0.1:54321",
			publishableKey: key("anon"),
		}).userUrl,
	).toBe("http://127.0.0.1:54321/auth/v1/user");
	expect(() =>
		validateSignupConsentAuthConfig({ ...config, publishableKey: key("service_role") }),
	).toThrow(/configuration/);
});

it("does not infer acceptance or send a write for an unaccepted notice", async () => {
	const request = vi.fn<typeof fetch>();
	await expect(
		saveSignupConsentForAccount(
			config,
			account,
			{ ...consent, legal_accepted: false },
			{ fetch: request },
		),
	).rejects.toThrow(/Accepted signup preferences/);
	expect(request).not.toHaveBeenCalled();
});
