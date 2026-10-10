import type { Page } from "@playwright/test";
import type { User } from "@supabase/supabase-js";

const user = {
	id: "00000000-0000-4000-8000-000000000001",
	email: "test@email.com",
	aud: "authenticated",
	role: "authenticated",
	app_metadata: { provider: "email", providers: ["email"] },
	user_metadata: { full_name: "Test User" },
	created_at: "2026-09-23T00:00:00.000Z",
	is_anonymous: false,
};

export async function installSupabaseAuth(page: Page, { signedIn = true } = {}) {
	const account: User = structuredClone(user);
	const expiresAt = Math.floor(Date.now() / 1000) + 3600;
	const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
	const session = {
		access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: expiresAt, role: "authenticated" })}.ui-test-signature`,
		refresh_token: "ui-test-refresh-token",
		token_type: "bearer",
		expires_in: 3600,
		expires_at: expiresAt,
		user: account,
	};
	await page.route("https://auth.recordly.test/**", async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path === "/auth/v1/settings")
			return route.fulfill({
				json: { external: { google: true, azure: true, github: true, email: true } },
			});
		if (path === "/auth/v1/token") return route.fulfill({ json: session });
		if (path === "/auth/v1/user") {
			if (route.request().method() === "PUT") {
				const update = route.request().postDataJSON();
				if (update.data)
					account.user_metadata = { ...account.user_metadata, ...update.data };
				if (update.email) account.new_email = update.email;
			}
			return route.fulfill({ json: account });
		}
		if (path === "/auth/v1/otp") return route.fulfill({ json: {} });
		if (path === "/auth/v1/logout") return route.fulfill({ status: 204 });
		return route.fulfill({ status: 503, json: { message: "Service unavailable in UI tests" } });
	});
	await page.addInitScript(
		({ signedIn, session }) => {
			if (sessionStorage.getItem("recordly.ui.auth.initialized")) return;
			sessionStorage.setItem("recordly.ui.auth.initialized", "1");
			if (signedIn) localStorage.setItem("sb-auth-auth-token", JSON.stringify(session));
			else localStorage.removeItem("sb-auth-auth-token");
		},
		{ signedIn, session },
	);
}

export async function completeSupabaseSignIn(page: Page) {
	await page.evaluate(() => {
		window.dispatchEvent(
			new CustomEvent("recordly-test-auth-callback", {
				detail: "recordly-dev://auth/callback?code=ui-auth-code",
			}),
		);
	});
}
