import { afterEach, beforeEach, expect, it, vi } from "vitest";

const verifyOtp = vi.hoisted(() => vi.fn());
const getUser = vi.hoisted(() => vi.fn());
const emailOtp = vi.hoisted(() => vi.fn(async (_options: unknown) => ({ error: null })));
const exchange = vi.hoisted(() =>
	vi.fn(async (_code: string, _options?: { flowId: string }) => ({ error: null })),
);
const updateUser = vi.hoisted(() => vi.fn(async (_update: unknown) => ({ error: null })));
const password = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn(async () => ({ error: null })));
const oauth = vi.hoisted(() =>
	vi.fn(async (_options: unknown) => ({
		data: { url: "https://auth.example.test/oauth" },
		error: null,
	})),
);
vi.mock("@supabase/supabase-js", () => ({
	createClient: () => ({
		auth: {
			exchangeCodeForSession: exchange,
			signInWithOAuth: oauth,
			signInWithOtp: emailOtp,
			verifyOtp,
			getUser,
			signInWithPassword: password,
			getSession,
			signOut,
			updateUser,
		},
	}),
}));
beforeEach(() => {
	vi.resetModules();
	exchange.mockClear();
	oauth.mockClear();
	emailOtp.mockClear();
	verifyOtp.mockReset();
	getUser.mockReset();
	password.mockReset();
	getSession.mockReset();
	signOut.mockClear();
	updateUser.mockClear();
	vi.stubEnv("VITE_SUPABASE_URL", "https://auth.example.test");
	vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-key");
});

it("sends former demo credentials to Supabase even during development", async () => {
	vi.stubEnv("DEV", true);
	password.mockResolvedValue({
		data: { user: null },
		error: new Error("Invalid login credentials"),
	});
	const { signInWithEmail } = await import("./recordlyAuth");
	await expect(signInWithEmail("test@email.com", "1234")).rejects.toThrow(
		"Invalid login credentials",
	);
	expect(password).toHaveBeenCalledExactlyOnceWith({ email: "test@email.com", password: "1234" });
});

for (const [description, session, error, expected] of [
	["signed-in user", { user: { id: "user", is_anonymous: false } }, null, true],
	["missing session", null, null, false],
	["anonymous user", { user: { id: "guest", is_anonymous: true } }, null, false],
	["session error", null, new Error("Session expired"), false],
] as const) {
	it(`requires a Supabase session: ${description}`, async () => {
		getSession.mockResolvedValue({ data: { session }, error });
		const { hasRecordlySession } = await import("./recordlyAuth");
		await expect(hasRecordlySession()).resolves.toBe(expected);
	});
}

it("does not permit recording when Supabase is unconfigured", async () => {
	vi.stubEnv("VITE_SUPABASE_URL", "");
	const { hasRecordlySession } = await import("./recordlyAuth");
	await expect(hasRecordlySession()).resolves.toBe(false);
	expect(getSession).not.toHaveBeenCalled();
});

it("signs out through Supabase", async () => {
	const { signOutRecordly } = await import("./recordlyAuth");
	await signOutRecordly();
	expect(signOut).toHaveBeenCalledOnce();
});

it.each([false, true])("offers Apple only when enabled (%s) and excludes GitHub", async (apple) => {
	const fetchSettings = vi.fn(
		async () =>
			new Response(
				JSON.stringify({ external: { google: true, azure: false, apple, github: true } }),
				{ status: 200 },
			),
	);
	vi.stubGlobal("fetch", fetchSettings);
	const { getEnabledSignInProviders } = await import("./recordlyAuth");
	await expect(getEnabledSignInProviders()).resolves.toEqual(
		apple ? ["google", "apple"] : ["google"],
	);
	expect(fetchSettings).toHaveBeenCalledWith(
		"https://auth.example.test/auth/v1/settings",
		expect.objectContaining({ headers: { apikey: "test-key" } }),
	);
});

it("reports an unavailable Auth settings endpoint instead of assuming providers are enabled", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("Bad Gateway", { status: 502 })),
	);
	const { getEnabledSignInProviders } = await import("./recordlyAuth");
	await expect(getEnabledSignInProviders()).rejects.toThrow("Sign-in is temporarily unavailable");
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

it("exchanges a callback once when live and pending delivery overlap", async () => {
	const { completeAuthCallback } = await import("./recordlyAuth");
	const url = "recordly://auth/callback?code=one-time-code";
	await Promise.all([completeAuthCallback(url), completeAuthCallback(url)]);
	await completeAuthCallback(url);
	expect(exchange).toHaveBeenCalledExactlyOnceWith("one-time-code");
});

it("shows provider errors without attempting a code exchange", async () => {
	const { completeAuthCallback } = await import("./recordlyAuth");
	await expect(
		completeAuthCallback(
			"recordly://auth/callback?error=denied&error_description=Sign-in+cancelled",
		),
	).rejects.toThrow("Sign-in cancelled");
	expect(exchange).not.toHaveBeenCalled();
});

it("exchanges the verifier for the callback's PKCE flow rather than the latest login", async () => {
	const { completeAuthCallback } = await import("./recordlyAuth");
	await completeAuthCallback(
		"recordly://auth/callback?code=older-login-code&sb_flow_id=0123456789abcdef0123456789abcdef",
	);
	expect(exchange).toHaveBeenCalledExactlyOnceWith("older-login-code", {
		flowId: "0123456789abcdef0123456789abcdef",
	});
});

it("requests Microsoft's email scope and opens its OAuth URL externally", async () => {
	const openExternalUrl = vi.fn(async () => ({ success: true }));
	vi.stubGlobal("window", { electronAPI: { openExternalUrl } });
	const { signInWithSocial } = await import("./recordlyAuth");
	const store = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key),
	});
	oauth.mockResolvedValueOnce({
		data: { url: "https://auth.example.test/oauth?code_challenge=test-challenge" },
		error: null,
	});
	await signInWithSocial("azure", { legalAccepted: true });
	expect(oauth).toHaveBeenCalledWith(
		expect.objectContaining({
			provider: "azure",
			options: expect.objectContaining({ scopes: "email", skipBrowserRedirect: true }),
		}),
	);
	expect(openExternalUrl).toHaveBeenCalledExactlyOnceWith(
		"https://auth.example.test/oauth?code_challenge=test-challenge",
	);
});

it("forwards the one-use security token to Supabase for email code and password requests", async () => {
	const { sendSignInCode, signInWithEmail } = await import("./recordlyAuth");
	await sendSignInCode("owner@example.test", { legalAccepted: true }, "captcha-code-token");
	expect(emailOtp).toHaveBeenCalledWith(
		expect.objectContaining({
			options: expect.objectContaining({ captchaToken: "captcha-code-token" }),
		}),
	);
	password.mockResolvedValue({ data: { user: { id: "owner" } }, error: null });
	await signInWithEmail("owner@example.test", "private-password", "captcha-password-token");
	expect(password).toHaveBeenCalledWith({
		email: "owner@example.test",
		password: "private-password",
		options: { captchaToken: "captcha-password-token" },
	});
});

for (const dev of [true, false]) {
	it(`requests an app-initiated email link with the ${dev ? "development" : "installed"} callback`, async () => {
		vi.stubEnv("DEV", dev);
		const { sendSignInLink } = await import("./recordlyAuth");
		await sendSignInLink("owner@example.test", { legalAccepted: true });
		expect(emailOtp).toHaveBeenCalledExactlyOnceWith({
			email: "owner@example.test",
			options: {
				emailRedirectTo: dev
					? "http://127.0.0.1:43821/auth/callback"
					: "recordly://auth/callback",
				shouldCreateUser: true,
				data: expect.objectContaining({
					signup_consent: expect.objectContaining({
						legal_accepted: true,
						version: "2026-10-29.1",
					}),
				}),
			},
		});
	});
}

it("does not accept dashboard implicit session tokens as a PKCE callback", async () => {
	const { completeAuthCallback } = await import("./recordlyAuth");
	await expect(
		completeAuthCallback("recordly://auth/callback#access_token=test&refresh_token=test"),
	).rejects.toThrow("Request a new sign-in link from Recordly");
	expect(exchange).not.toHaveBeenCalled();
});

it("rejects signup without legal acknowledgement before contacting Auth", async () => {
	const { sendSignInLink, signInWithSocial } = await import("./recordlyAuth");
	const consent = { legalAccepted: false };
	await expect(sendSignInLink("owner@example.test", consent)).rejects.toThrow("Please agree");
	await expect(signInWithSocial("google", consent)).rejects.toThrow("Please agree");
	expect(emailOtp).not.toHaveBeenCalled();
	expect(oauth).not.toHaveBeenCalled();
});

for (const existing of [false, true]) {
	it(`OAuth saves the matching signup choice only for ${existing ? "existing (no overwrite)" : "new"} accounts`, async () => {
		const store = new Map<string, string>();
		vi.stubGlobal("localStorage", {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => store.set(key, value),
			removeItem: (key: string) => store.delete(key),
		});
		const native = new Map<string, string>();
		vi.stubGlobal("window", {
			electronAPI: {
				openExternalUrl: async () => ({ success: true }),
				authStorageAvailable: async () => true,
				authStorageMigrate: async (snapshot: Record<string, string>) => {
					for (const [key, value] of Object.entries(snapshot)) native.set(key, value);
				},
				authStorageGetItem: async (key: string) => native.get(key) ?? null,
				authStorageSetItem: async (key: string, value: string) => {
					native.set(key, value);
				},
				authStorageRemoveItem: async (key: string) => {
					native.delete(key);
				},
			},
		});
		const verifier = "a-test-pkce-verifier";
		const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
		const challenge = Buffer.from(hash).toString("base64url");
		store.set("sb-auth-auth-token-code-verifier", JSON.stringify(verifier));
		oauth.mockResolvedValueOnce({
			data: { url: `https://auth.example.test/oauth?code_challenge=${challenge}` },
			error: null,
		});
		const { signInWithSocial, completeAuthCallback } = await import("./recordlyAuth");
		await signInWithSocial("google", { legalAccepted: true });
		exchange.mockResolvedValueOnce({
			data: {
				user: {
					created_at: existing ? "2020-01-01T00:00:00Z" : new Date().toISOString(),
					user_metadata: {},
				},
			},
			error: null,
		} as never);
		await completeAuthCallback("recordly://auth/callback?code=consent-test");
		if (existing) expect(updateUser).not.toHaveBeenCalled();
		else
			expect(updateUser).toHaveBeenCalledWith({
				data: {
					signup_consent: expect.objectContaining({
						legal_accepted: true,
						version: "2026-10-29.1",
					}),
				},
			});
		expect(store.has(`sb-auth-auth-token-signup-consent-${challenge}`)).toBe(false);
	});
}

it("does not attribute an abandoned OAuth choice to another login flow", async () => {
	const store = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key),
	});
	vi.stubGlobal("window", { electronAPI: { openExternalUrl: async () => ({ success: true }) } });
	oauth.mockResolvedValueOnce({
		data: { url: "https://auth.example.test/oauth?code_challenge=abandoned" },
		error: null,
	});
	const { signInWithSocial, completeAuthCallback } = await import("./recordlyAuth");
	await signInWithSocial("google", { legalAccepted: true });
	store.set("sb-auth-auth-token-code-verifier", JSON.stringify("another-flow-verifier"));
	exchange.mockResolvedValueOnce({
		data: { user: { created_at: new Date().toISOString(), user_metadata: {} } },
		error: null,
	} as never);
	await completeAuthCallback("recordly://auth/callback?code=different-flow");
	expect(updateUser).not.toHaveBeenCalled();
});

for (const enabled of [true, false]) {
	it(`saves marketing ${enabled ? "opt-in" : "opt-out"} separately from signup consent`, async () => {
		const { updateMarketingEmailPreference } = await import("./recordlyAuth");
		await updateMarketingEmailPreference(enabled);
		expect(updateUser).toHaveBeenCalledExactlyOnceWith({
			data: {
				email_preferences: expect.objectContaining({
					marketing_emails: enabled,
					source: "account-settings",
					wording: "Email me the latest updates, deals and offers from Recordly.",
				}),
			},
		});
	});
}

it("reports a rejected email preference save", async () => {
	updateUser.mockResolvedValueOnce({ error: new Error("Save failed") } as never);
	const { updateMarketingEmailPreference } = await import("./recordlyAuth");
	await expect(updateMarketingEmailPreference(true)).rejects.toThrow("Save failed");
});

it("preserves earlier signup opt-ins but prioritizes a later unsubscribe", async () => {
	const { marketingEmailsEnabled } = await import("./signupConsent");
	expect(marketingEmailsEnabled(null)).toBe(false);
	expect(marketingEmailsEnabled({ user_metadata: {} })).toBe(false);
	expect(
		marketingEmailsEnabled({ user_metadata: { signup_consent: { marketing_emails: true } } }),
	).toBe(true);
	expect(
		marketingEmailsEnabled({
			user_metadata: {
				signup_consent: { marketing_emails: true },
				email_preferences: { marketing_emails: false },
			},
		}),
	).toBe(false);
});

it("verifies a six-digit email code and requires a real session", async () => {
	const { verifySignInCode } = await import("./recordlyAuth");
	const user = { id: "verified", is_anonymous: false };
	verifyOtp.mockResolvedValue({
		data: { user, session: { access_token: "test-session" } },
		error: null,
	});
	await expect(verifySignInCode(" user@example.com ", "123456")).resolves.toEqual(user);
	expect(verifyOtp).toHaveBeenCalledExactlyOnceWith({
		email: "user@example.com",
		token: "123456",
		type: "email",
	});
	verifyOtp.mockResolvedValue({ data: { user, session: null }, error: null });
	await expect(verifySignInCode("user@example.com", "123456")).rejects.toThrow();
});

it.each([
	"12345",
	"1234567",
	"12abcd",
	"",
	"１２３４５６",
])("rejects malformed code %s before calling auth", async (token) => {
	const { verifySignInCode } = await import("./recordlyAuth");
	await expect(verifySignInCode("user@example.com", token)).rejects.toThrow();
	expect(verifyOtp).not.toHaveBeenCalled();
});

it("does not turn an invalid or expired code into an authenticated session", async () => {
	const { verifySignInCode } = await import("./recordlyAuth");
	verifyOtp.mockResolvedValue({
		data: { user: null, session: null },
		error: new Error("Token has expired or is invalid"),
	});
	await expect(verifySignInCode("user@example.com", "000000")).rejects.toThrow(
		"Token has expired or is invalid",
	);
});

it("only saves optional passwords for a verified account", async () => {
	const { updateRecordlyPassword } = await import("./recordlyAuth");
	await expect(updateRecordlyPassword("short")).rejects.toThrow();
	expect(getUser).not.toHaveBeenCalled();
	getUser.mockResolvedValue({
		data: {
			user: {
				id: "verified",
				email_confirmed_at: "2026-10-24T00:00:00Z",
				is_anonymous: false,
			},
		},
		error: null,
	});
	await expect(updateRecordlyPassword("test-only-password")).resolves.toBeUndefined();
	expect(updateUser).toHaveBeenCalledWith({ password: "test-only-password" });
	updateUser.mockClear();
	getUser.mockResolvedValue({
		data: { user: { id: "unverified", is_anonymous: false } },
		error: null,
	});
	await expect(updateRecordlyPassword("test-only-password")).rejects.toThrow();
	expect(updateUser).not.toHaveBeenCalled();
});
