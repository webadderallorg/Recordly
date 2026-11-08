import { afterEach, expect, it, vi } from "vitest";
import { signupConsentMetadata } from "./signupConsent";
import {
	createPendingSignupConsentStore,
	createSignupConsentRetryStore,
} from "./pendingSignupConsent";

const prefix = "sb-test-auth-token";
const challenge = "a".repeat(43);
const metadata = () => signupConsentMetadata({ legalAccepted: true });
function storage() {
	const values = new Map<string, string>();
	return {
		values,
		getItem: vi.fn(async (key: string) => values.get(key) ?? null),
		setItem: vi.fn(async (key: string, value: string) => {
			values.set(key, value);
		}),
		removeItem: vi.fn(async (key: string) => {
			values.delete(key);
		}),
	};
}
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

it("shares a pending legal acknowledgement through durable storage when browser storage is blocked", async () => {
	vi.stubGlobal("localStorage", {
		getItem: () => {
			throw new Error("blocked");
		},
	});
	const durable = storage();
	const first = createPendingSignupConsentStore(durable, prefix);
	const second = createPendingSignupConsentStore(durable, prefix);
	const accepted = metadata();
	await first.set(challenge, accepted);
	expect(await second.get(challenge)).toEqual(accepted);
	expect(await second.get("b".repeat(43))).toBeNull();
});

it("keeps an actual acknowledgement in bounded memory when persistence fails", async () => {
	const fail = async () => {
		throw new Error("unavailable");
	};
	const records = createPendingSignupConsentStore(
		{ getItem: fail, setItem: fail, removeItem: fail },
		prefix,
	);
	const failLocal = () => {
		throw new Error("blocked");
	};
	vi.stubGlobal("localStorage", {
		getItem: failLocal,
		setItem: failLocal,
		removeItem: failLocal,
	});
	const accepted = metadata();
	for (const letter of ["a", "b", "c", "d", "e", "f"])
		await records.set(letter.repeat(43), accepted);
	expect(await records.get(challenge)).toBeNull();
	expect(await records.get("f".repeat(43))).toEqual(accepted);
	await expect(records.remove("f".repeat(43))).resolves.toBeUndefined();
	expect(await records.get("f".repeat(43))).toBeNull();
});

it("does not use client clock changes to reject a matching server-validated flow", async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2040-01-01T00:00:00Z"));
	const accepted = metadata();
	const durable = storage();
	await createPendingSignupConsentStore(durable, prefix).set(challenge, accepted);
	vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
	expect(await createPendingSignupConsentStore(durable, prefix).get(challenge)).toEqual(accepted);
});

it("sanitizes pending records to legal acknowledgement and never imports marketing preferences", async () => {
	const durable = storage();
	const accepted = metadata();
	durable.values.set(
		`${prefix}-signup-consent-${challenge}`,
		JSON.stringify({
			...accepted,
			email_preferences: { marketing_emails: true },
			signup_consent: { ...accepted.signup_consent, marketing_emails: true },
		}),
	);
	expect(await createPendingSignupConsentStore(durable, prefix).get(challenge)).toEqual(accepted);
});

it.each([
	"missing",
	"invalid JSON",
	"not accepted",
	"wrong wording",
])("does not manufacture consent from %s metadata", async (state) => {
	const durable = storage();
	const accepted = metadata();
	if (state !== "missing")
		durable.values.set(
			`${prefix}-signup-consent-${challenge}`,
			state === "invalid JSON"
				? "{"
				: JSON.stringify({
						signup_consent: {
							...accepted.signup_consent,
							...(state === "not accepted"
								? { legal_accepted: false }
								: { legal_wording: "other notice" }),
						},
					}),
		);
	expect(await createPendingSignupConsentStore(durable, prefix).get(challenge)).toBeNull();
});

it("restores account-bound retry receipts without tokens or inferred marketing preferences", async () => {
	const durable = storage();
	const first = createSignupConsentRetryStore(durable, prefix);
	const accepted = metadata();
	await first.set("account-a", accepted);
	const restarted = createSignupConsentRetryStore(durable, prefix);
	expect(await restarted.get("account-b")).toBeNull();
	expect(await restarted.get("account-a")).toEqual(accepted);
	expect(JSON.parse(durable.values.get(`${prefix}-signup-consent-retry:account-a`)!)).toEqual({
		userId: "account-a",
		metadata: accepted,
	});
	await restarted.remove("account-a");
	expect(await first.get("account-a")).toBeNull();
	expect(durable.values.size).toBe(0);
});

it("keeps failed retry writes bounded in memory and rejects an invalid account or notice", async () => {
	const fail = async () => {
		throw new Error("Unavailable");
	};
	const retries = createSignupConsentRetryStore(
		{ getItem: fail, setItem: fail, removeItem: fail },
		prefix,
	);
	const accepted = metadata();
	for (let n = 0; n < 6; n++) await retries.set(`account-${n}`, accepted);
	await retries.set("../invalid", accepted);
	await retries.set("invalid-notice", {
		signup_consent: { ...accepted.signup_consent, legal_accepted: false },
	} as never);
	expect(await retries.get("account-0")).toBeNull();
	expect(await retries.get("account-5")).toEqual(accepted);
	expect(await retries.get("../invalid")).toBeNull();
	expect(await retries.get("invalid-notice")).toBeNull();
});

it("retains retry metadata in memory when native storage fails without writing browser storage", async () => {
	const fail = async () => {
		throw new Error("Unavailable");
	};
	const local = { setItem: vi.fn() };
	vi.stubGlobal("localStorage", local);
	const retries = createSignupConsentRetryStore(
		{ getItem: fail, setItem: fail, removeItem: fail },
		prefix,
	);
	const accepted = metadata();
	await retries.set("account-a", accepted);
	expect(await retries.get("account-a")).toEqual(accepted);
	expect(await retries.get("account-b")).toBeNull();
	expect(local.setItem).not.toHaveBeenCalled();
});

it("does not overwrite an existing receipt after a failed native read", async () => {
	const durable = storage();
	const accepted = metadata();
	const retries = createSignupConsentRetryStore(durable, prefix);
	await retries.set("account-a", accepted);
	const key = `${prefix}-signup-consent-retry:account-a`;
	const original = durable.values.get(key);
	durable.getItem.mockRejectedValueOnce(new Error("Temporarily busy"));
	await retries.set("account-a", accepted);
	expect(durable.values.get(key)).toBe(original);
	expect(durable.setItem).toHaveBeenCalledOnce();
	await retries.set("account-a", accepted);
	expect(await createSignupConsentRetryStore(durable, prefix).get("account-a")).toEqual(accepted);
});

it("preserves simultaneous different-account receipts across independent renderer lock domains", async () => {
	// Separate packaged app instances have different loopback origins. Native
	// storage is shared, but navigator.locks cannot serialize their transactions.
	vi.stubGlobal("navigator", {});
	const durable = storage();
	let release!: () => void;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	let reads = 0;
	durable.getItem.mockImplementation(async (key) => {
		const snapshot = durable.values.get(key) ?? null;
		if (++reads === 2) release();
		await held;
		return snapshot;
	});
	const accepted = metadata();
	const first = createSignupConsentRetryStore(durable, prefix);
	const second = createSignupConsentRetryStore(durable, prefix);
	await Promise.all([first.set("account-a", accepted), second.set("account-b", accepted)]);
	const restarted = createSignupConsentRetryStore(durable, prefix);
	expect(await restarted.get("account-a")).toEqual(accepted);
	expect(await restarted.get("account-b")).toEqual(accepted);
	expect(durable.values.size).toBe(2);
});

it("does not resurrect another renderer's removed receipt after a failed write", async () => {
	const durable = storage();
	const first = createSignupConsentRetryStore(durable, prefix);
	const second = createSignupConsentRetryStore(durable, prefix);
	const accepted = metadata();
	await first.set("account-a", accepted);
	durable.setItem.mockRejectedValueOnce(new Error("Storage busy"));
	await first.set("account-b", accepted);
	await second.remove("account-a");
	expect(await first.get("account-b")).toEqual(accepted);
	await first.set("account-b", accepted);
	const restarted = createSignupConsentRetryStore(durable, prefix);
	expect(await restarted.get("account-a")).toBeNull();
	expect(await restarted.get("account-b")).toEqual(accepted);
});

it("rejects a retry receipt bound to a different account", async () => {
	const durable = storage();
	durable.values.set(
		`${prefix}-signup-consent-retry:account-a`,
		JSON.stringify({ userId: "account-b", metadata: metadata() }),
	);
	expect(await createSignupConsentRetryStore(durable, prefix).get("account-a")).toBeNull();
});
