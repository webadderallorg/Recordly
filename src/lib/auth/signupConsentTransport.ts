export type SignupConsentAuthConfig = { url: string; publishableKey: string };
export type SignupConsentAccount = { userId: string; accessToken: string };

export class SignupConsentScopeChangedError extends Error {
	constructor() {
		super("The signed-in account changed before signup preferences could be saved.");
	}
}

function publicKey(value: string): boolean {
	if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
	try {
		const parts = value.split(".");
		if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part)))
			return false;
		const encoded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
		return (
			JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="))).role === "anon"
		);
	} catch {
		return false;
	}
}

export function validateSignupConsentAuthConfig(config: SignupConsentAuthConfig): {
	userUrl: string;
	publishableKey: string;
} {
	try {
		if (
			!config ||
			typeof config.url !== "string" ||
			typeof config.publishableKey !== "string" ||
			config.publishableKey.length > 8192 ||
			!publicKey(config.publishableKey)
		)
			throw new Error();
		const base = new URL(config.url);
		const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
		if (
			(base.protocol !== "https:" && !(local && base.protocol === "http:")) ||
			base.username ||
			base.password ||
			base.search ||
			base.hash
		)
			throw new Error();
		if (!base.pathname.endsWith("/")) base.pathname += "/";
		return {
			userUrl: new URL("auth/v1/user", base).href,
			publishableKey: config.publishableKey,
		};
	} catch {
		throw new Error("Secure signup preferences configuration is unavailable.");
	}
}

function canonicalJson(value: unknown): string {
	const text = JSON.stringify(value, (_key, item) =>
		item && typeof item === "object" && !Array.isArray(item)
			? Object.fromEntries(
					Object.keys(item)
						.sort()
						.map((key) => [key, item[key]]),
				)
			: item,
	);
	if (typeof text !== "string") throw new Error("Signup preferences could not be verified.");
	return text;
}

function verifiedUser(payload: unknown, userId: string): Record<string, unknown> {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error();
	const object = payload as Record<string, unknown>;
	const user = object.user && typeof object.user === "object" ? object.user : object;
	if (Array.isArray(user) || (user as Record<string, unknown>).id !== userId)
		throw new SignupConsentScopeChangedError();
	return user as Record<string, unknown>;
}

function metadata(user: Record<string, unknown>): Record<string, unknown> {
	const value = user.user_metadata;
	if (value === null || value === undefined) return {};
	if (typeof value !== "object" || Array.isArray(value)) throw new Error();
	return value as Record<string, unknown>;
}

/** Save only this account's accepted notice, without rereading another SDK session. */
export async function saveSignupConsentForAccount(
	config: SignupConsentAuthConfig,
	account: SignupConsentAccount,
	signupConsent: Record<string, unknown>,
	options: {
		isCurrent?: () => boolean | Promise<boolean>;
		fetch?: typeof fetch;
	} = {},
): Promise<{ status: "saved" | "already-present" }> {
	const destination = validateSignupConsentAuthConfig(config);
	const { userId, accessToken } = account;
	if (
		typeof userId !== "string" ||
		!userId ||
		typeof accessToken !== "string" ||
		!accessToken ||
		/[\r\n]/.test(accessToken) ||
		!signupConsent ||
		Array.isArray(signupConsent) ||
		signupConsent.legal_accepted !== true
	)
		throw new Error("Accepted signup preferences could not be verified.");
	// Snapshot before awaiting: caller mutations cannot change what was accepted.
	const expected = canonicalJson(signupConsent);
	const body = JSON.stringify({ data: { signup_consent: JSON.parse(expected) } });
	const request = options.fetch ?? fetch;
	const assertCurrent = async () => {
		if (options.isCurrent && !(await options.isCurrent()))
			throw new SignupConsentScopeChangedError();
	};
	const init = {
		headers: {
			apikey: destination.publishableKey,
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		credentials: "omit" as const,
		redirect: "error" as const,
		cache: "no-store" as const,
	};
	await assertCurrent();
	const read = await request(destination.userUrl, {
		...init,
		method: "GET",
		signal: AbortSignal.timeout(10000),
	});
	if (!read.ok) throw new Error("Could not verify signup preferences. Please try again.");
	const current = verifiedUser(await read.json(), userId);
	await assertCurrent();
	if (Reflect.getOwnPropertyDescriptor(metadata(current), "signup_consent") !== undefined)
		return { status: "already-present" };
	const save = await request(destination.userUrl, {
		...init,
		method: "PUT",
		body,
		signal: AbortSignal.timeout(10000),
	});
	if (!save.ok)
		throw new Error("Signed in, but could not save your signup preferences. Please try again.");
	const saved = verifiedUser(await save.json(), userId);
	await assertCurrent();
	if (canonicalJson(metadata(saved).signup_consent) !== expected)
		throw new Error(
			"Signed in, but could not confirm your signup preferences. Please try again.",
		);
	return { status: "saved" };
}
