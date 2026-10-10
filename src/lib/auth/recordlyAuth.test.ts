import { afterEach, beforeEach, expect, it, vi } from "vitest";

const emailOtp = vi.hoisted(() => vi.fn(async (_options: unknown) => ({ error: null })));
const exchange = vi.hoisted(() => vi.fn(async (_code: string) => ({ error: null })));
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
			signInWithPassword: password,
			getSession,
			signOut,
		},
	}),
}));
beforeEach(() => {
	vi.resetModules();
	exchange.mockClear();
	oauth.mockClear();
	emailOtp.mockClear();
	password.mockReset();
	getSession.mockReset();
	signOut.mockClear();
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

it("offers only OAuth providers enabled in the configured Supabase project", async () => {
	const fetchSettings = vi.fn(
		async () =>
			new Response(
				JSON.stringify({ external: { google: true, azure: false, github: false } }),
				{ status: 200 },
			),
	);
	vi.stubGlobal("fetch", fetchSettings);
	const { getEnabledSignInProviders } = await import("./recordlyAuth");
	await expect(getEnabledSignInProviders()).resolves.toEqual(["google"]);
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

it("requests Microsoft's email scope and opens its OAuth URL externally", async () => {
	const openExternalUrl = vi.fn(async () => ({ success: true }));
	vi.stubGlobal("window", { electronAPI: { openExternalUrl } });
	const { signInWithSocial } = await import("./recordlyAuth");
	await signInWithSocial("azure");
	expect(oauth).toHaveBeenCalledWith(
		expect.objectContaining({
			provider: "azure",
			options: expect.objectContaining({ scopes: "email", skipBrowserRedirect: true }),
		}),
	);
	expect(openExternalUrl).toHaveBeenCalledExactlyOnceWith("https://auth.example.test/oauth");
});

for (const dev of [true, false]) {
	it(`requests an app-initiated email link with the ${dev ? "development" : "installed"} callback`, async () => {
		vi.stubEnv("DEV", dev);
		const { sendSignInLink } = await import("./recordlyAuth");
		await sendSignInLink("owner@example.test");
		expect(emailOtp).toHaveBeenCalledExactlyOnceWith({
			email: "owner@example.test",
			options: {
				emailRedirectTo: dev
					? "http://127.0.0.1:43821/auth/callback"
					: "recordly://auth/callback",
				shouldCreateUser: true,
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
