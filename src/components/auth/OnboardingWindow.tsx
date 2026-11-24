import { useCallback, useEffect, useState } from "react";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import { hasSkippedOnboardingSignIn } from "@/lib/auth/onboardingSignIn";
import { hasRequiredRecordingPermissions } from "@/lib/recordingPermissions";
import { OnboardingController } from "./OnboardingController";
import { RecordingPermissionsDialog } from "./RecordingPermissionsDialog";
import { useRecordlyAuth } from "./useRecordlyAuth";

function AccountOnboarding() {
	const auth = useRecordlyAuth();
	const query = new URLSearchParams(window.location.search);
	const startup = query.get("startup") === "1";
	const withIntro = query.get("welcomeSoundtrack") === "intro";
	const [showOnboarding, setShowOnboarding] = useState(!startup || withIntro);
	const [initialPermissions, setInitialPermissions] = useState(false);
	const { loading, callbackActivity, callbackVersion, isCallbackPending, user } = auth;
	const hasAccountAccess = Boolean(user) || hasSkippedOnboardingSignIn();

	const finishStartup = useCallback(async () => {
		if (isCallbackPending()) return false;
		const pendingKey = "recordly.onboarding.permissionsRequested";
		const permissionsRequested = loadAppSetting<boolean>(pendingKey) === true;
		if (permissionsRequested) saveAppSetting(pendingKey, false);
		try {
			if (await window.electronAPI.resolveStartupOnboarding("continue")) return true;
		} catch (error) {
			console.error("[onboarding] Could not open the recording HUD.", error);
		}
		if (permissionsRequested) saveAppSetting(pendingKey, true);
		return false;
	}, [isCallbackPending]);

	useEffect(() => {
		if (showOnboarding || loading || callbackActivity.pending) return;
		if (
			!hasAccountAccess ||
			callbackVersion > 0 ||
			loadAppSetting<boolean>("recordly.onboarding.v1.seen") !== true
		) {
			setShowOnboarding(true);
			return;
		}
		let cancelled = false;
		void hasRequiredRecordingPermissions()
			.catch(() => false)
			.then(async (granted) => {
				if (cancelled || isCallbackPending()) return;
				if (granted && (await finishStartup())) return;
				if (cancelled || isCallbackPending()) return;
				setInitialPermissions(true);
				setShowOnboarding(true);
			});
		return () => {
			cancelled = true;
		};
	}, [
		showOnboarding,
		loading,
		callbackActivity,
		callbackVersion,
		hasAccountAccess,
		finishStartup,
		isCallbackPending,
	]);

	useEffect(() => {
		if (startup && !withIntro && showOnboarding)
			void window.electronAPI.resolveStartupOnboarding("show");
	}, [startup, withIntro, showOnboarding]);

	if (!showOnboarding) return null;
	return (
		<OnboardingController
			requestNonce={0}
			ready={!auth.loading}
			user={auth.user}
			configured={auth.configured}
			callbackError={auth.callbackError}
			authenticationVersion={auth.callbackVersion}
			authCallbackPending={auth.callbackActivity.pending}
			initialPermissions={initialPermissions}
			finishStartup={startup ? finishStartup : undefined}
			onUnlockSavedSignIn={
				!import.meta.env.DEV && auth.savedSignInLocked
					? () => void window.electronAPI.resolveStartupOnboarding("restart")
					: undefined
			}
			standalone
		/>
	);
}

export default function OnboardingWindow() {
	const permissionsOnly =
		new URLSearchParams(window.location.search).get("permissionsOnly") === "1";
	const close = () => void window.electronAPI.closeOnboardingWindow();
	return (
		<div className="relative h-screen w-screen overflow-hidden bg-editor-bg text-foreground">
			{permissionsOnly ? (
				<RecordingPermissionsDialog
					open
					standalone
					persistRequest={false}
					onClose={close}
					onFinish={close}
				/>
			) : (
				<AccountOnboarding />
			)}
		</div>
	);
}
