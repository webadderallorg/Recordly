import { useCallback, useEffect, useRef, useState } from "react";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import { hasRequiredRecordingPermissions } from "@/lib/recordingPermissions";
import { OnboardingController } from "./OnboardingController";
import { RecordingPermissionsDialog } from "./RecordingPermissionsDialog";
import { RecordlySignInDialog } from "./RecordlySignInDialog";
import { useRecordlyAuth } from "./useRecordlyAuth";

function ReturningOnboarding({ auth }: { auth: ReturnType<typeof useRecordlyAuth> }) {
	const signedIn = Boolean(auth.user);
	const { callbackActivity, isCallbackPending } = auth;
	const [needsPermissions, setNeedsPermissions] = useState(false);
	const view = auth.loading
		? null
		: !signedIn
			? "sign-in"
			: needsPermissions
				? "permissions"
				: null;
	const continuing = useRef(false);
	const close = () => void window.electronAPI.closeOnboardingWindow();
	const continueToHud = useCallback(async () => {
		if (!signedIn || continuing.current || isCallbackPending()) return;
		continuing.current = true;
		if (loadAppSetting<boolean>("recordly.onboarding.permissionsRequested") === true)
			saveAppSetting("recordly.onboarding.permissionsRequested", false);
		if (isCallbackPending()) {
			continuing.current = false;
			return;
		}
		try {
			if (!(await window.electronAPI.resolveStartupOnboarding("continue")))
				throw new Error("Recording controls could not open.");
		} catch (error) {
			console.error("[onboarding] Could not open the recording HUD.", error);
			continuing.current = false;
			setNeedsPermissions(true);
		}
	}, [signedIn, isCallbackPending]);

	useEffect(() => {
		// A cold launch can carry an OAuth callback. Keep its renderer alive
		// until the exchange and callback acknowledgement are both finished.
		if (auth.loading || callbackActivity.pending || !signedIn) return;
		if (loadAppSetting<boolean>("recordly.onboarding.v1.seen") !== true)
			saveAppSetting("recordly.onboarding.v1.seen", true);
		let cancelled = false;
		void hasRequiredRecordingPermissions()
			.catch(() => false)
			.then((granted) => {
				if (cancelled) return;
				if (granted) void continueToHud();
				else setNeedsPermissions(true);
			});
		return () => {
			cancelled = true;
		};
	}, [auth.loading, callbackActivity, signedIn, continueToHud]);

	useEffect(() => {
		if (view) void window.electronAPI.resolveStartupOnboarding("show");
	}, [view]);

	if (view === "permissions") {
		return (
			<RecordingPermissionsDialog
				open
				standalone
				finishDisabled={callbackActivity.pending}
				onFinish={continueToHud}
				onClose={close}
			/>
		);
	}
	if (view === "sign-in") {
		return (
			<RecordlySignInDialog
				onboarding
				signInOnly
				open
				user={null}
				configured={auth.configured}
				callbackError={auth.callbackError}
				onOpenChange={() => undefined}
				onAuthenticated={() => undefined}
				onWindowClose={close}
				onUnlockSavedSignIn={
					auth.savedSignInLocked
						? () => void window.electronAPI.resolveStartupOnboarding("restart")
						: undefined
				}
			/>
		);
	}
	return null;
}

export default function OnboardingWindow() {
	const auth = useRecordlyAuth();
	const returning = new URLSearchParams(window.location.search).get("returning") === "1";
	return (
		<div className="relative h-screen w-screen overflow-hidden bg-editor-bg text-foreground">
			{returning ? (
				<ReturningOnboarding auth={auth} />
			) : (
				<OnboardingController
					requestNonce={0}
					ready={!auth.loading}
					user={auth.user}
					configured={auth.configured}
					callbackError={auth.callbackError}
					standalone
				/>
			)}
		</div>
	);
}
