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

/** Persist accepted notices by account after their one-use PKCE flow is consumed. */
export function createSignupConsentRetryStore(storage: Storage, prefix: string) {
	const memory = new Map<string, Metadata>();
	let pending = Promise.resolve();
	const validAccount = (userId: string) =>
		typeof userId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(userId);
	const key = (userId: string) => `${prefix}-signup-consent-retry:${userId}`;
	const read = async (userId: string) => {
		try {
			const raw = await storage.getItem(key(userId));
			if (raw === null) return { metadata: memory.get(userId) ?? null, readable: true };
			if (raw.length > 8192) return { metadata: null, readable: false };
			const record = JSON.parse(raw);
			if (record?.userId !== userId) return { metadata: null, readable: false };
			return { metadata: parseMetadata(JSON.stringify(record.metadata)), readable: true };
		} catch {
			return { metadata: memory.get(userId) ?? null, readable: false };
		}
	};
	const transaction = <T>(operation: () => Promise<T>): Promise<T> => {
		const result = pending.then(operation);
		pending = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	};
	return {
		get(userId: string): Promise<Metadata | null> {
			return transaction(async () =>
				validAccount(userId) ? (await read(userId)).metadata : null,
			);
		},
		set(userId: string, metadata: Metadata): Promise<void> {
			return transaction(async () => {
				const accepted = parseMetadata(JSON.stringify(metadata));
				if (!validAccount(userId) || !accepted) return;
				const previous = await read(userId);
				const notice = previous.metadata ?? accepted;
				memory.set(userId, notice);
				while (memory.size > MAX_PENDING) memory.delete(memory.keys().next().value!);
				if (!previous.readable) return;
				try {
					// Separate account keys let the main process serialize each mutation
					// across app instances, whose renderer origins and Web Locks differ.
					await storage.setItem(
						key(userId),
						JSON.stringify({ userId, metadata: notice }),
					);
					memory.delete(userId);
				} catch {
					/* Retain this account's notice if encrypted persistence is unavailable. */
				}
			});
		},
		remove(userId: string): Promise<void> {
			return transaction(async () => {
				if (!validAccount(userId)) return;
				memory.delete(userId);
				try {
					await storage.removeItem(key(userId));
				} catch {
					/* The next retry checks the server's existing acknowledgement first. */
				}
			});
		},
	};
}
