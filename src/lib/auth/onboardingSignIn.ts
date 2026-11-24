import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";

const SIGN_IN_SKIPPED_KEY = "recordly.onboarding.signInSkipped";

export function hasSkippedOnboardingSignIn(): boolean {
	return loadAppSetting<boolean>(SIGN_IN_SKIPPED_KEY) === true;
}

export function saveSkippedOnboardingSignIn(): boolean {
	return saveAppSetting(SIGN_IN_SKIPPED_KEY, true);
}
