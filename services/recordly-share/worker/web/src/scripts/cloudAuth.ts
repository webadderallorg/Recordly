import { saveCommentReturn } from "./commentAuth.ts";
import type { Provider, SupabaseClient } from "@supabase/supabase-js";
import {
	LEGAL_CONSENT_LABEL,
	SIGNUP_CONSENT_VERSION,
} from "../../../../../../src/lib/auth/signupConsentCopy.ts";
import {
	saveSignupConsentForAccount,
	SignupConsentScopeChangedError,
	validateSignupConsentAuthConfig,
	type SignupConsentAuthConfig,
} from "../../../../../../src/lib/auth/signupConsentTransport.ts";

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

export async function beginCloudOAuth(
	client: SupabaseClient,
	provider: Provider,
	origin: string,
	returnTo?: string,
) {
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

type CompletedFlow = {
	version: 1;
	accountId: string;
	challenge?: string;
	noticeFingerprint?: string;
	destinationFingerprint: string;
	createdAt: number;
	state: "pending-consent" | "complete";
};
const completedFlows = new Map<string, CompletedFlow>();
export class CloudSignupConsentRetryError extends Error {}
const completionKey = (fingerprint: string) => `recordly-cloud-completion:${fingerprint}`;
async function fingerprint(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function rememberFlow(key: string, flow: CompletedFlow) {
	completedFlows.set(key, flow);
	try {
		sessionStorage.setItem(key, JSON.stringify(flow));
	} catch {
		/* A same-page retry remains possible if browser storage fills after exchange. */
	}
}
function readCompletedFlow(key: string, destinationFingerprint: string): CompletedFlow | undefined {
	let saved = completedFlows.get(key);
	if (!saved) {
		const raw = sessionStorage.getItem(key);
		if (raw === null) return undefined;
		try {
			saved = JSON.parse(raw);
		} catch {
			throw new Error(
				"This completed sign-in cannot be resumed. Request a new link in this browser.",
			);
		}
	}
	if (!saved || typeof saved !== "object" || Array.isArray(saved))
		throw new Error(
			"This completed sign-in cannot be resumed. Request a new link in this browser.",
		);
	const age = Date.now() - saved.createdAt;
	if (
		saved.version !== 1 ||
		typeof saved.accountId !== "string" ||
		!saved.accountId ||
		saved.destinationFingerprint !== destinationFingerprint ||
		!Number.isFinite(age) ||
		age < 0 ||
		age >= 60 * 60 * 1000 ||
		(saved.state !== "complete" && saved.state !== "pending-consent") ||
		(saved.challenge !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(saved.challenge)) ||
		(saved.state === "pending-consent" &&
			(!saved.challenge || !/^[a-f0-9]{64}$/.test(saved.noticeFingerprint || "")))
	)
		throw new Error(
			"This completed sign-in cannot be resumed. Request a new link in this browser.",
		);
	return saved as CompletedFlow;
}
function acceptedNotice(raw: string | null): ReturnType<typeof cloudSignupMetadata> | undefined {
	try {
		const value = JSON.parse(raw || "null")?.signup_consent;
		const age = Date.now() - Date.parse(value?.recorded_at);
		if (
			value?.version !== SIGNUP_CONSENT_VERSION ||
			value.source !== "web-signup" ||
			value.legal_accepted !== true ||
			value.acceptance_method !== "continue-with-notice" ||
			value.legal_wording !== LEGAL_CONSENT_LABEL ||
			!Number.isFinite(age) ||
			age < 0 ||
			age >= 60 * 60 * 1000
		)
			return undefined;
		// Only the accepted legal notice is part of this web contract. Never infer
		// marketing/email choices from extra browser-storage fields.
		return {
			signup_consent: {
				version: value.version,
				recorded_at: value.recorded_at,
				source: value.source,
				legal_accepted: true,
				acceptance_method: value.acceptance_method,
				legal_wording: value.legal_wording,
			},
		};
	} catch {
		return undefined;
	}
}

/** Complete a matching PKCE flow; a failed preference save resumes its exchanged session. */
export async function completeCloudCallback(
	client: SupabaseClient,
	href: string,
	onComplete?: (challenge?: string) => void,
	config?: SignupConsentAuthConfig,
) {
	const url = new URL(href);
	if (url.searchParams.has("error") || url.hash.includes("error="))
		throw new Error(
			"This sign-in link could not be used. Request a new link and open it in this browser.",
		);
	const code = url.searchParams.get("code");
	if (!code) return false;
	const destination = validateSignupConsentAuthConfig(config!);
	const flowId = url.searchParams.get("sb_flow_id");
	const destinationFingerprint = await fingerprint(JSON.stringify(destination));
	const key = completionKey(
		await fingerprint(JSON.stringify([url.origin, url.pathname, code, flowId])),
	);
	const existing = readCompletedFlow(key, destinationFingerprint);
	const currentSession = async (accountId: string) => {
		const { data, error } = await client.auth.getSession();
		if (error || !data.session || data.session.user.id !== accountId)
			throw new SignupConsentScopeChangedError();
		return data.session;
	};
	const finish = async (flow: CompletedFlow, capturedToken?: string) => {
		const session = await currentSession(flow.accountId);
		if (flow.state === "pending-consent") {
			const pendingKey = consentKey(flow.challenge!);
			const raw = sessionStorage.getItem(pendingKey);
			const pending = acceptedNotice(raw);
			if (!raw || !pending || (await fingerprint(raw)) !== flow.noticeFingerprint)
				throw new Error(
					"The accepted signup notice no longer matches this sign-in. Request a new link.",
				);
			try {
				await saveSignupConsentForAccount(
					config!,
					{
						userId: flow.accountId,
						accessToken: capturedToken ?? session.access_token,
					},
					pending.signup_consent,
					{
						isCurrent: async () => {
							try {
								await currentSession(flow.accountId);
								const latest = sessionStorage.getItem(pendingKey);
								return Boolean(
									latest &&
										(await fingerprint(latest)) === flow.noticeFingerprint,
								);
							} catch {
								return false;
							}
						},
					},
				);
			} catch (cause) {
				if (cause instanceof SignupConsentScopeChangedError) throw cause;
				throw new CloudSignupConsentRetryError(
					cause instanceof Error
						? cause.message
						: "Signed in, but could not save your signup preferences. Please try again.",
				);
			}
		} else if (!capturedToken) {
			// A completed callback replay verifies its current token explicitly; it
			// must not exchange the consumed code or resume another account's flow.
			const { data, error } = await client.auth.getUser(session.access_token);
			if (error || data.user?.id !== flow.accountId)
				throw new SignupConsentScopeChangedError();
		}
		await currentSession(flow.accountId);
		rememberFlow(key, { ...flow, state: "complete" });
		if (flow.challenge) {
			try {
				sessionStorage.removeItem(consentKey(flow.challenge));
			} catch {
				/* Confirmed completion is not converted back into a failed sign-in. */
			}
		}
		onComplete?.(flow.challenge);
		return true;
	};
	if (existing) return finish(existing);
	const verifier = localStorage.getItem(
		flowId
			? `recordly-cloud-auth-flow-${flowId}-code-verifier`
			: "recordly-cloud-auth-code-verifier",
	);
	let flowChallenge: string | undefined;
	let pending: ReturnType<typeof cloudSignupMetadata> | undefined;
	let noticeFingerprint: string | undefined;
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
				const saved = sessionStorage.getItem(consentKey(challenge));
				pending = acceptedNotice(saved);
				if (saved && pending) noticeFingerprint = await fingerprint(saved);
			}
		} catch {
			/* Malformed pending data never grants consent. */
		}
	}
	const { data, error } = flowId
		? await client.auth.exchangeCodeForSession(code, { flowId })
		: await client.auth.exchangeCodeForSession(code);
	if (
		error ||
		!data.user?.id ||
		!data.session?.access_token ||
		data.session.user.id !== data.user.id
	)
		throw new Error(
			"This sign-in link has expired or was opened in another browser. Request a new link here.",
		);
	const needsConsent =
		pending &&
		Reflect.getOwnPropertyDescriptor(data.user.user_metadata ?? {}, "signup_consent") ===
			undefined &&
		Date.parse(data.user.created_at) >= Date.parse(pending.signup_consent.recorded_at);
	const completed: CompletedFlow = {
		version: 1,
		accountId: data.user.id,
		challenge: flowChallenge,
		noticeFingerprint,
		destinationFingerprint,
		createdAt: Date.now(),
		state: needsConsent ? "pending-consent" : "complete",
	};
	rememberFlow(key, completed);
	return finish(completed, data.session.access_token);
}
