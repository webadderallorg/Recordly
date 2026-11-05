import { saveCommentReturn } from "./commentAuth.ts";
import type { Provider, SupabaseClient } from "@supabase/supabase-js";
import {
	LEGAL_CONSENT_LABEL,
	SIGNUP_CONSENT_VERSION,
} from "../../../../../../src/lib/auth/signupConsentCopy.ts";

const consentKey = (challenge: string) => `recordly-cloud-consent:${challenge}`;
export function cloudSignupMetadata() {
	return {
		signup_consent: {
			version: SIGNUP_CONSENT_VERSION,
			recorded_at: new Date().toISOString(),
			source: "web-signup",
			legal_accepted: true,
			acceptance_method: "continue-with-notice",
			legal_wording: LEGAL_CONSENT_LABEL,
		},
	};
}

export async function beginCloudOAuth(client: SupabaseClient, provider: Provider, origin: string, returnTo?: string) {
	const { data, error } = await client.auth.signInWithOAuth({
		provider,
		options: {
			redirectTo: `${origin}/library`,
			skipBrowserRedirect: true,
			scopes: provider === "azure" ? "email" : undefined,
		},
	});
	if (error) throw error;
	if (!data.url) throw new Error("Could not start sign-in. Please try again.");
	const challenge = new URL(data.url).searchParams.get("code_challenge");
	if (!challenge) throw new Error("Could not start secure sign-in. Please try again.");
	// The notice belongs to this exact PKCE flow, never the next arbitrary login.
	sessionStorage.setItem(consentKey(challenge), JSON.stringify(cloudSignupMetadata()));
	if (returnTo) saveCommentReturn(returnTo, challenge);
	location.assign(data.url);
}

/** Complete only the PKCE flow started in this browser, then remove callback data. */
export async function completeCloudCallback(client: SupabaseClient, href: string, onComplete?: (challenge?: string) => void) {
	const url = new URL(href);
	if (url.searchParams.has("error") || url.hash.includes("error="))
		throw new Error(
			"This sign-in link could not be used. Request a new link and open it in this browser.",
		);
	const code = url.searchParams.get("code");
	if (!code) return false;
	const flowId = url.searchParams.get("sb_flow_id");
	const verifier = localStorage.getItem(
		flowId
			? `recordly-cloud-auth-flow-${flowId}-code-verifier`
			: "recordly-cloud-auth-code-verifier",
	);
	let pendingKey: string | undefined;
	let flowChallenge: string | undefined;
	let pending: ReturnType<typeof cloudSignupMetadata> | undefined;
	if (verifier) {
		try {
			const decoded: unknown = JSON.parse(verifier);
			if (typeof decoded === "string") {
				const digest = await crypto.subtle.digest(
					"SHA-256",
					new TextEncoder().encode(decoded.split("/")[0]),
				);
				const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
					.replace(/\+/g, "-")
					.replace(/\//g, "_")
					.replace(/=+$/, "");
				flowChallenge = challenge;
				pendingKey = consentKey(challenge);
				const saved = sessionStorage.getItem(pendingKey);
				if (saved) {
					const value = JSON.parse(saved) as ReturnType<typeof cloudSignupMetadata>;
					const age = Date.now() - Date.parse(value.signup_consent.recorded_at);
					if (
						age >= 0 &&
						age < 60 * 60 * 1000 &&
						value.signup_consent.legal_accepted === true
					)
						pending = value;
				}
			}
		} catch {
			/* Malformed pending data never grants consent. */
		}
	}
	const { data, error } = flowId
		? await client.auth.exchangeCodeForSession(code, { flowId })
		: await client.auth.exchangeCodeForSession(code);
	if (error)
		throw new Error(
			"This sign-in link has expired or was opened in another browser. Request a new link here.",
		);
	if (
		pending &&
		data.user &&
		!data.user.user_metadata?.signup_consent &&
		Date.parse(data.user.created_at) >= Date.parse(pending.signup_consent.recorded_at)
	) {
		const { error: saveError } = await client.auth.updateUser({ data: pending });
		if (saveError)
			throw new Error(
				"Signed in, but could not save your signup preferences. Please try again.",
			);
	}
	if (pendingKey) sessionStorage.removeItem(pendingKey);
	onComplete?.(flowChallenge);
	return true;
}
