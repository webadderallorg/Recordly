import { translate } from "@/i18n/runtime";
import {
	SIGNUP_CONSENT_VERSION,
	LEGAL_CONSENT_LABEL,
	MARKETING_CONSENT_LABEL,
} from "./signupConsentCopy";
export {
	SIGNUP_CONSENT_VERSION,
	LEGAL_CONSENT_LABEL,
	MARKETING_CONSENT_LABEL,
} from "./signupConsentCopy";

export type SignupConsent = { legalAccepted: boolean };

export function signupConsentMetadata(consent: SignupConsent) {
	if (consent.legalAccepted !== true) {
		throw new Error(translate("support.legalRequired"));
	}
	return {
		signup_consent: {
			version: SIGNUP_CONSENT_VERSION,
			recorded_at: new Date().toISOString(),
			source: "desktop-signup",
			legal_accepted: true,
			acceptance_method: "continue-with-notice",
			legal_wording: LEGAL_CONSENT_LABEL,
		},
	};
}

export function marketingEmailsEnabled(
	user: { user_metadata?: Record<string, unknown> } | null,
): boolean {
	const preferences = user?.user_metadata?.email_preferences as
		| { marketing_emails?: unknown }
		| undefined;
	if (typeof preferences?.marketing_emails === "boolean") return preferences.marketing_emails;
	const signup = user?.user_metadata?.signup_consent as
		| { marketing_emails?: unknown }
		| undefined;
	return signup?.marketing_emails === true;
}

export function marketingEmailMetadata(enabled: boolean) {
	if (typeof enabled !== "boolean") throw new Error(translate("support.emailPreferenceRequired"));
	return {
		email_preferences: {
			marketing_emails: enabled,
			recorded_at: new Date().toISOString(),
			version: SIGNUP_CONSENT_VERSION,
			source: "account-settings",
			wording: MARKETING_CONSENT_LABEL,
		},
	};
}
