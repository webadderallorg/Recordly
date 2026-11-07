import { afterEach, expect, it, vi } from "vitest";
import { signupConsentMetadata } from "./signupConsent";
import { createPendingSignupConsentStore } from "./pendingSignupConsent";

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
