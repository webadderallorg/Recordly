import type { signupConsentMetadata } from "./signupConsent";
import { LEGAL_CONSENT_LABEL, SIGNUP_CONSENT_VERSION } from "./signupConsentCopy";

type Metadata = ReturnType<typeof signupConsentMetadata>;
type Storage = {
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
	removeItem(key: string): Promise<void>;
};
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const MAX_PENDING = 5;

function parseMetadata(value: string | null): Metadata | null {
	if (typeof value !== "string" || value.length > 8192) return null;
	try {
		const candidate = JSON.parse(value ?? "null")?.signup_consent;
		if (
			candidate?.legal_accepted !== true ||
			candidate.version !== SIGNUP_CONSENT_VERSION ||
			candidate.source !== "desktop-signup" ||
			candidate.acceptance_method !== "continue-with-notice" ||
			candidate.legal_wording !== LEGAL_CONSENT_LABEL ||
			typeof candidate.recorded_at !== "string" ||
			!Number.isFinite(Date.parse(candidate.recorded_at))
		)
			return null;
		// Pending legal acknowledgement must never carry an inferred marketing choice.
		return {
			signup_consent: {
				version: SIGNUP_CONSENT_VERSION,
				recorded_at: candidate.recorded_at,
				source: "desktop-signup",
				legal_accepted: true,
				acceptance_method: "continue-with-notice",
				legal_wording: LEGAL_CONSENT_LABEL,
			},
		};
	} catch {
		return null;
	}
}

/** A matching, server-validated PKCE flow establishes freshness; client clocks do not. */
export function createPendingSignupConsentStore(storage: Storage, prefix: string) {
	const memory = new Map<string, Metadata>();
	const key = (challenge: string) => `${prefix}-signup-consent-${challenge}`;
	const trimLegacyRecords = () => {
		try {
			const local = globalThis.localStorage;
			const owned: string[] = [];
			for (let index = 0; local && index < local.length; index++) {
				const candidate = local.key(index);
				if (
					candidate?.startsWith(`${prefix}-signup-consent-`) &&
					CHALLENGE.test(candidate.slice(`${prefix}-signup-consent-`.length))
				)
					owned.push(candidate);
			}
			for (const expired of owned.slice(0, -MAX_PENDING)) local.removeItem(expired);
		} catch {
			/* Metadata cleanup never blocks an authentication flow. */
		}
	};
	const remember = (challenge: string, metadata: Metadata) => {
		memory.delete(challenge);
		memory.set(challenge, metadata);
		while (memory.size > MAX_PENDING) memory.delete(memory.keys().next().value!);
	};
	return {
		async set(challenge: string, metadata: Metadata) {
			if (!CHALLENGE.test(challenge)) return;
			const contents = JSON.stringify(metadata);
			const validated = parseMetadata(contents);
			if (!validated) return;
			remember(challenge, validated);
			try {
				await storage.setItem(key(challenge), JSON.stringify(validated));
			} catch {
				try {
					globalThis.localStorage?.setItem(key(challenge), JSON.stringify(validated));
				} catch {
					/* Memory keeps this flow usable when persistence is unavailable. */
				}
			}
			trimLegacyRecords();
		},
		async get(challenge: string): Promise<Metadata | null> {
			if (!CHALLENGE.test(challenge)) return null;
			const known = memory.get(challenge);
			if (known) return known;
			let stored: string | null = null;
			try {
				stored = await storage.getItem(key(challenge));
			} catch {
				/* Try legacy metadata. */
			}
			if (stored === null) {
				try {
					stored = globalThis.localStorage?.getItem(key(challenge)) ?? null;
				} catch {
					/* Missing acknowledgement never grants consent. */
				}
			}
			const metadata = parseMetadata(stored);
			if (metadata) remember(challenge, metadata);
			return metadata;
		},
		async remove(challenge: string) {
			if (!CHALLENGE.test(challenge)) return;
			memory.delete(challenge);
			try {
				await storage.removeItem(key(challenge));
			} catch {
				/* Auth success is independent. */
			}
			try {
				globalThis.localStorage?.removeItem(key(challenge));
			} catch {
				/* A stale record cannot match a different one-use PKCE flow. */
			}
		},
	};
}
