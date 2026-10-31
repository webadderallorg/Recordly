import { createClient, type Provider, type User } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const callbackUrl = import.meta.env.DEV
	? "http://127.0.0.1:43821/auth/callback"
	: "recordly://auth/callback";

export const recordlyAuthConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export type RecordlyOAuthProvider = "google" | "azure" | "github";

export async function getEnabledSignInProviders(
	signal?: AbortSignal,
): Promise<RecordlyOAuthProvider[]> {
	if (!recordlyAuthConfigured) return [];
	const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
		headers: { apikey: supabasePublishableKey! },
		signal,
	});
	if (!response.ok) throw new Error("Sign-in is temporarily unavailable. Please try again.");
	const settings = await response.json();
	return (["google", "azure", "github"] as const).filter(
		(provider) => settings.external?.[provider] === true,
	);
}

export const recordlyAuth = recordlyAuthConfigured
	? createClient(supabaseUrl!, supabasePublishableKey!, {
			auth: {
				flowType: "pkce",
				persistSession: true,
				autoRefreshToken: true,
				detectSessionInUrl: false,
			},
		})
	: null;

function requireAuth() {
	if (!recordlyAuth) {
		throw new Error(
			"Recordly Auth is not configured. Add the Supabase URL and publishable key.",
		);
	}
	return recordlyAuth;
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
	const client = requireAuth();
	const { data, error } = await client.auth.signInWithPassword({ email, password });
	if (error) throw error;
	if (!data.user) throw new Error("No user was returned after sign-in.");
	return data.user;
}

export async function sendSignInLink(email: string): Promise<void> {
	const client = requireAuth();
	const { error } = await client.auth.signInWithOtp({
		email,
		options: { emailRedirectTo: callbackUrl, shouldCreateUser: true },
	});
	if (error) throw error;
}

export async function sendPasswordReset(email: string): Promise<void> {
	const client = requireAuth();
	const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl });
	if (error) throw error;
}

async function openAuthUrl(url: string | null) {
	if (!url) throw new Error("The authentication provider did not return a sign-in URL.");
	const result = await window.electronAPI.openExternalUrl(url);
	if (!result.success) throw new Error(result.error || "Could not open the sign-in page.");
}

export async function signInWithSocial(provider: "google" | "azure" | "github"): Promise<void> {
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
	await openAuthUrl(data.url);
}

export async function signInWithSaml(email: string): Promise<void> {
	const client = requireAuth();
	const domain = email.trim().split("@")[1];
	if (!domain) throw new Error("Enter a valid work email address.");
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
		throw new Error("Request a new sign-in link from Recordly, then open it on this computer.");
	}
	const client = requireAuth();
	const { error } = await client.auth.exchangeCodeForSession(code);
	if (error) throw error;
}

export async function signOutRecordly(): Promise<void> {
	const client = requireAuth();
	const { error } = await client.auth.signOut();
	if (error) throw error;
}

export async function updateAccountName(name: string): Promise<User> {
	const fullName = name.trim();
	if (!fullName || fullName.length > 80)
		throw new Error("Enter a name between 1 and 80 characters.");
	const { data, error } = await requireAuth().auth.updateUser({ data: { full_name: fullName } });
	if (error) throw error;
	if (!data.user) throw new Error("Could not update your profile. Please try again.");
	return data.user;
}

export async function requestAccountEmailChange(email: string): Promise<User> {
	const address = email.trim();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
		throw new Error("Enter a valid email address.");
	const { data, error } = await requireAuth().auth.updateUser(
		{ email: address },
		{ emailRedirectTo: callbackUrl },
	);
	if (error) throw error;
	if (!data.user) throw new Error("Could not change your email. Please try again.");
	return data.user;
}

export async function hasRecordlySession(): Promise<boolean> {
	if (!recordlyAuth) return false;
	const { data, error } = await recordlyAuth.auth.getSession();
	return !error && Boolean(data.session?.user && !data.session.user.is_anonymous);
}

let lastCallback: { url: string; completion: Promise<void> } | undefined;
export function completeAuthCallback(url: string): Promise<void> {
	if (lastCallback?.url === url) return lastCallback.completion;
	const completion = exchangeAuthCallback(url);
	lastCallback = { url, completion };
	return completion;
}
