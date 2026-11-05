import { translate } from "@/i18n/runtime";
import { createClient, type Provider, type User } from "@supabase/supabase-js";
import { marketingEmailMetadata, type SignupConsent, signupConsentMetadata } from "./signupConsent";
import { traceAuthOperation } from "./authDiagnostics";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const callbackUrl = import.meta.env.DEV
	? "http://127.0.0.1:43821/auth/callback"
	: "recordly://auth/callback";

export const recordlyAuthConfigured = Boolean(supabaseUrl && supabasePublishableKey);

function createAuthStorage() {
	// Packaged renderer ports change between launches. Keep desktop credentials
	// in the main process's encrypted store rather than an origin-bound session.
	const memory = new Map<string, string>();
	const storageKey = supabaseUrl
		? `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`
		: "";
	const keys = [storageKey, `${storageKey}-code-verifier`, `${storageKey}-user`];
	let nativeReady: Promise<Window["electronAPI"] | null> | undefined;
	let memoryOnly = false;
	const browserStorage = (): Storage | undefined => {
		try {
			return globalThis.localStorage;
		} catch {
			return undefined;
		}
	};
	const legacyKeys = (local: Storage | undefined) => {
		const owned = new Set(keys);
		try {
			// Include only this project's recognized session and pending PKCE keys.
			// Consent choices and other projects' sessions are not credentials to migrate.
			for (let index = 0; local && index < local.length; index++) {
				const key = local.key(index);
				if (
					key === `${storageKey}-flows-code-verifier` ||
					(key?.startsWith(`${storageKey}-flow-`) &&
						/^[A-Za-z0-9_-]{8,64}-code-verifier$/.test(
							key.slice(`${storageKey}-flow-`.length),
						))
				)
					owned.add(key);
			}
		} catch {
			/* Blocked browser storage must not prevent memory-only/native auth. */
		}
		return owned;
	};
	const removeLegacyCopies = (local: Storage | undefined, owned: Set<string>) => {
		for (const key of owned) {
			try {
				local?.removeItem(key);
			} catch {
				/* An inaccessible browser store is never used as desktop fallback. */
			}
		}
	};
	const nativeStorage = () => {
		nativeReady ??= (async () => {
			const bridge = typeof window === "undefined" ? undefined : window.electronAPI;
			// A desktop bridge must never fall back to plaintext localStorage when
			// its OS-encrypted store is unavailable, incomplete or fails to unlock.
			memoryOnly = Boolean(bridge);
			const local = browserStorage();
			const owned = legacyKeys(local);
			if (
				!bridge?.authStorageAvailable ||
				!bridge.authStorageMigrate ||
				!bridge.authStorageGetItem ||
				!bridge.authStorageSetItem ||
				!bridge.authStorageRemoveItem
			) {
				if (memoryOnly) removeLegacyCopies(local, owned);
				return null;
			}
			let available = false;
			try {
				available = await bridge.authStorageAvailable();
			} catch {
				// Browser previews and older development preloads have no native store.
			}
			if (!available) {
				removeLegacyCopies(local, owned);
				return null;
			}
			const snapshot: Record<string, string> = {};
			for (const key of owned) {
				try {
					const value = local?.getItem(key);
					if (value != null) snapshot[key] = value;
				} catch {
					// A blocked browser store must not prevent native session recovery.
				}
			}
			try {
				await bridge.authStorageMigrate(snapshot);
			} catch {
				removeLegacyCopies(local, owned);
				return null;
			}
			// Main migrates once, including an empty marker. Remove old copies so
			// logging out cannot restore a stale browser session.
			removeLegacyCopies(local, owned);
			return bridge;
		})();
		return nativeReady;
	};
	return {
		async getItem(key: string): Promise<string | null> {
			const native = await nativeStorage();
			if (native) return native.authStorageGetItem(key);
			return memoryOnly
				? (memory.get(key) ?? null)
				: (browserStorage()?.getItem(key) ?? memory.get(key) ?? null);
		},
		async setItem(key: string, value: string): Promise<void> {
			const native = await nativeStorage();
			if (native) await native.authStorageSetItem(key, value);
			else {
				const local = memoryOnly ? undefined : browserStorage();
				if (local) local.setItem(key, value);
				else memory.set(key, value);
			}
		},
		async removeItem(key: string): Promise<void> {
			const native = await nativeStorage();
			if (native) await native.authStorageRemoveItem(key);
			else {
				if (!memoryOnly) browserStorage()?.removeItem(key);
				memory.delete(key);
			}
		},
	};
}

export type RecordlyOAuthProvider = "google" | "azure" | "apple";

export async function getEnabledSignInProviders(
	signal?: AbortSignal,
): Promise<RecordlyOAuthProvider[]> {
	if (!recordlyAuthConfigured) return [];
	const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
		headers: { apikey: supabasePublishableKey! },
		signal,
	});
	if (!response.ok)
		throw Object.assign(new Error(translate("support.authUnavailable")), {
			status: response.status,
		});
	const settings = await response.json();
	return (["google", "azure", "apple"] as const).filter(
		(provider) => settings.external?.[provider] === true,
	);
}

const authStorage = createAuthStorage();
const authStorageKey = supabaseUrl
	? `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`
	: "";
const pendingConsentKey = (challenge: string) => `${authStorageKey}-signup-consent-${challenge}`;

export const recordlyAuth = recordlyAuthConfigured
	? createClient(supabaseUrl!, supabasePublishableKey!, {
			auth: {
				storage: authStorage,
				flowType: "pkce",
				persistSession: true,
				// Dev previews must not poll the account in the background.
				autoRefreshToken: !import.meta.env.DEV,
				detectSessionInUrl: false,
			},
		})
	: null;

function requireAuth() {
	if (!recordlyAuth) {
		throw new Error(translate("support.authUnconfigured"));
	}
	return recordlyAuth;
}

export async function signInWithEmail(
	email: string,
	password: string,
	captchaToken?: string,
): Promise<User> {
	const client = requireAuth();
	const { data, error } = await client.auth.signInWithPassword({
		email,
		password,
		...(captchaToken ? { options: { captchaToken } } : {}),
	});
	if (error) throw error;
	if (!data.user) throw new Error(translate("support.authNoUser"));
	return data.user;
}

export async function sendSignInCode(
	email: string,
	consent: SignupConsent,
	captchaToken?: string,
): Promise<void> {
	const metadata = signupConsentMetadata(consent);
	const client = requireAuth();
	const { error } = await client.auth.signInWithOtp({
		email,
		// Supabase applies this metadata only when creating a user. Signing in
		// must not resubscribe an existing account or overwrite its preferences.
		options: {
			emailRedirectTo: callbackUrl,
			shouldCreateUser: true,
			data: metadata,
			...(captchaToken ? { captchaToken } : {}),
		},
	});
	if (error) throw error;
}

/** Email OTPs work even when the inbox is opened on a different device. */
export async function verifySignInCode(email: string, token: string): Promise<User> {
	if (!/^[0-9]{6}$/.test(token)) throw new Error(translate("onboarding.invalidCode"));
	const { data, error } = await requireAuth().auth.verifyOtp({
		email: email.trim(),
		token,
		type: "email",
	});
	if (error) throw error;
	if (!data.user || !data.session || data.user.is_anonymous)
		throw new Error(translate("support.authNoUser"));
	return data.user;
}

export async function updateRecordlyPassword(password: string): Promise<void> {
	if (password.length < 12) throw new Error(translate("settings.account.passwordMinimum"));
	const client = requireAuth();
	const { data, error: identityError } = await client.auth.getUser();
	if (identityError) throw identityError;
	if (!data.user?.email_confirmed_at || data.user.is_anonymous)
		throw new Error(translate("support.authNoUser"));
	const { error } = await client.auth.updateUser({ password });
	if (error) throw error;
}

// Keep existing callers and in-flight release branches source-compatible.
export const sendSignInLink = sendSignInCode;

export async function sendPasswordReset(email: string, captchaToken?: string): Promise<void> {
	const client = requireAuth();
	const { error } = await client.auth.resetPasswordForEmail(email, {
		redirectTo: callbackUrl,
		...(captchaToken ? { captchaToken } : {}),
	});
	if (error) throw error;
}

async function openAuthUrl(url: string | null) {
	if (!url) throw new Error(translate("support.authNoUrl"));
	const result = await window.electronAPI.openExternalUrl(url);
	if (!result.success) throw new Error(translate("support.authOpenError"));
}

export async function signInWithSocial(
	provider: RecordlyOAuthProvider,
	consent: SignupConsent,
): Promise<void> {
	const metadata = signupConsentMetadata(consent);
	const client = requireAuth();
	const { data, error } = await client.auth.signInWithOAuth({
		provider: provider as Provider,
		options: {
			redirectTo: callbackUrl,
			skipBrowserRedirect: true,
			scopes: provider === "azure" ? "email" : undefined,
		},
	});
	if (error) throw error;
	if (!data.url) throw new Error(translate("support.authNoUrl"));
	const challenge = new URL(data.url).searchParams.get("code_challenge");
	if (!challenge) throw new Error(translate("support.authInsecure"));
	// Bind the choice to this exact PKCE flow, never to the next arbitrary user
	// who happens to sign in. No tokens or verifiers are stored here.
	const key = pendingConsentKey(challenge);
	localStorage.setItem(key, JSON.stringify(metadata));
	try {
		await openAuthUrl(data.url);
	} catch (error) {
		localStorage.removeItem(key);
		throw error;
	}
}

export async function signInWithSaml(email: string): Promise<void> {
	const client = requireAuth();
	const domain = email.trim().split("@")[1];
	if (!domain) throw new Error(translate("support.workEmailInvalid"));
	const { data, error } = await client.auth.signInWithSSO({
		domain,
		options: { redirectTo: callbackUrl, skipBrowserRedirect: true },
	});
	if (error) throw error;
	await openAuthUrl(data.url);
}

async function exchangeAuthCallback(url: string): Promise<void> {
	const params = new URL(url).searchParams;
	const providerError = params.get("error_description") || params.get("error");
	if (providerError) throw new Error(providerError);
	const code = params.get("code");
	if (!code) {
		throw new Error(translate("support.authNewLink"));
	}
	const client = requireAuth();
	const flowId = params.get("sb_flow_id");
	let pendingKey: string | undefined;
	let pendingConsent: ReturnType<typeof signupConsentMetadata> | undefined;
	// Read the verifier before Supabase consumes it during the exchange.
	const verifier = await traceAuthOperation("callback-verifier", () =>
		authStorage.getItem(
			flowId
				? `${authStorageKey}-flow-${flowId}-code-verifier`
				: `${authStorageKey}-code-verifier`,
		),
	);
	if (verifier) {
		// Supabase serializes storage values as JSON, including verifier strings.
		const decodedVerifier: unknown = JSON.parse(verifier);
		if (typeof decodedVerifier !== "string")
			throw new Error(translate("support.authInvalidVerifier"));
		const digest = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(decodedVerifier.split("/")[0]),
		);
		const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
		pendingKey = pendingConsentKey(challenge);
		const stored = globalThis.localStorage?.getItem(pendingKey);
		if (stored) {
			try {
				const metadata = JSON.parse(stored) as ReturnType<typeof signupConsentMetadata>;
				const age = Date.now() - Date.parse(metadata.signup_consent.recorded_at);
				if (
					age >= 0 &&
					age < 60 * 60 * 1000 &&
					metadata.signup_consent.legal_accepted === true
				)
					pendingConsent = metadata;
			} catch {
				/* Invalid pending data never grants marketing permission. */
			}
		}
	}
	const { data } = await traceAuthOperation("callback-token-exchange", async () => {
		const result = flowId
			? await client.auth.exchangeCodeForSession(code, { flowId })
			: await client.auth.exchangeCodeForSession(code);
		if (result.error) throw result.error;
		return result;
	});
	// Existing accounts keep their saved preferences, including an unsubscribe.
	// A login choice is only saved for an account created during this flow.
	const createdAt = Date.parse(data?.user?.created_at ?? "");
	if (
		pendingConsent &&
		data?.user &&
		!data.user.user_metadata?.signup_consent &&
		createdAt >= Date.parse(pendingConsent.signup_consent.recorded_at)
	) {
		await traceAuthOperation("callback-consent-save", async () => {
			const { error: saveError } = await client.auth.updateUser({ data: pendingConsent });
			if (saveError) throw saveError;
		});
	}
	if (pendingKey) globalThis.localStorage?.removeItem(pendingKey);
}

export async function signOutRecordly(): Promise<void> {
	const client = requireAuth();
	const { error } = await client.auth.signOut();
	if (error) throw error;
}

export async function updateMarketingEmailPreference(enabled: boolean): Promise<void> {
	const { error } = await requireAuth().auth.updateUser({
		data: marketingEmailMetadata(enabled),
	});
	if (error) throw error;
}

export async function updateAccountName(name: string): Promise<User> {
	const fullName = name.trim();
	if (!fullName || fullName.length > 80) throw new Error(translate("support.nameInvalid"));
	const { data, error } = await requireAuth().auth.updateUser({ data: { full_name: fullName } });
	if (error) throw error;
	if (!data.user) throw new Error(translate("support.profileFailure"));
	return data.user;
}

export async function requestAccountEmailChange(email: string): Promise<User> {
	const address = email.trim();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
		throw new Error(translate("support.emailInvalid"));
	const { data, error } = await requireAuth().auth.updateUser(
		{ email: address },
		{ emailRedirectTo: callbackUrl },
	);
	if (error) throw error;
	if (!data.user) throw new Error(translate("support.emailChangeFailure"));
	return data.user;
}

export async function hasRecordlySession(): Promise<boolean> {
	if (!recordlyAuth) return false;
	const { data, error } = await recordlyAuth.auth.getSession();
	return !error && Boolean(data.session?.user && !data.session.user.is_anonymous);
}

let lastCallback: { url: string; completion: Promise<void> } | undefined;

async function exchangeCallbackAcrossWindows(url: string): Promise<void> {
	let storage: Storage | undefined;
	try {
		storage = globalThis.localStorage;
	} catch {
		/* Storage can be unavailable outside the desktop renderer. */
	}
	if (!storage || !globalThis.navigator?.locks || !globalThis.crypto?.subtle) {
		await exchangeAuthCallback(url);
		return;
	}
	// Electron broadcasts callbacks to the editor, HUD and onboarding. An OAuth
	// code is single-use, so serialize the exchange across their shared origin.
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
	const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	await navigator.locks.request("recordly-auth-callback", async () => {
		const key = "recordly.auth.completed-callback";
		if (storage.getItem(key) === fingerprint) {
			const { data, error } = await requireAuth().auth.getSession();
			if (!error && data.session) return;
		}
		await exchangeAuthCallback(url);
		// Store only a fingerprint, never the callback URL or authorization code.
		try {
			storage.setItem(key, fingerprint);
		} catch {
			// A failed bookkeeping write must not turn a successful sign-in into an error.
		}
	});
}

export function completeAuthCallback(url: string): Promise<void> {
	if (lastCallback?.url === url) return lastCallback.completion;
	const completion = traceAuthOperation("callback-completion", () =>
		exchangeCallbackAcrossWindows(url),
	);
	lastCallback = { url, completion };
	return completion;
}
