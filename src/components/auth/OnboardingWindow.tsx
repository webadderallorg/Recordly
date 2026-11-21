import { useCallback, useEffect, useRef, useState } from "react";
import { BillingSessionProvider } from "@/components/billing/BillingProvider";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import { hasRequiredRecordingPermissions } from "@/lib/recordingPermissions";
import { OnboardingController } from "./OnboardingController";
import { RecordingPermissionsDialog } from "./RecordingPermissionsDialog";
import { RecordlySignInDialog } from "./RecordlySignInDialog";
import { useRecordlyAuth } from "./useRecordlyAuth";

function ReturningOnboarding({
	auth,
	inlineRecordingStart,
}: {
	auth: ReturnType<typeof useRecordlyAuth>;
	inlineRecordingStart: boolean;
}) {
	const signedIn = Boolean(auth.user);
	const { callbackActivity, callbackVersion, isCallbackPending } = auth;
	const [showedSignIn, setShowedSignIn] = useState(false);
	const [needsPermissions, setNeedsPermissions] = useState(false);
	const needsStartConfirmation = inlineRecordingStart && (showedSignIn || callbackVersion > 0);
	const view = auth.loading
		? null
		: !signedIn
			? "sign-in"
			: needsStartConfirmation || needsPermissions
				? inlineRecordingStart
					? "ready"
					: "permissions"
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
		// On Windows and Linux, a fresh sign-in stops at Start recording.
		if (needsStartConfirmation) return;
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
	}, [auth.loading, callbackActivity, signedIn, continueToHud, needsStartConfirmation]);

	useEffect(() => {
		if (view === "sign-in") setShowedSignIn(true);
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
	if (view === "sign-in" || view === "ready") {
		return (
			<RecordlySignInDialog
				onboarding
				signInOnly
				open
				user={view === "ready" ? auth.user : null}
				configured={auth.configured}
				callbackError={auth.callbackError}
				onOpenChange={() => undefined}
				onAuthenticated={() => undefined}
				recordingStart={
					inlineRecordingStart
						? { disabled: callbackActivity.pending, onPress: continueToHud }
						: undefined
				}
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

function AccountOnboarding() {
	const auth = useRecordlyAuth();
	const returning = new URLSearchParams(window.location.search).get("returning") === "1";
	const [platform, setPlatform] = useState<string>();
	useEffect(() => {
		if (returning)
			void window.electronAPI.getPlatform().then(setPlatform, () => setPlatform("darwin"));
	}, [returning]);
	const inlineRecordingStart = platform === "win32" || platform === "linux";
	if (returning && !platform) return null;
	return returning ? (
		<ReturningOnboarding auth={auth} inlineRecordingStart={inlineRecordingStart} />
	) : (
		<BillingSessionProvider auth={auth}>
			<OnboardingController
				requestNonce={0}
				ready={!auth.loading}
				user={auth.user}
				configured={auth.configured}
				callbackError={auth.callbackError}
				authenticationVersion={auth.callbackVersion}
				authCallbackPending={auth.callbackActivity.pending}
				onUnlockSavedSignIn={
					!import.meta.env.DEV && auth.savedSignInLocked
						? () => void window.electronAPI.resolveStartupOnboarding("restart")
						: undefined
				}
				standalone
			/>
		</BillingSessionProvider>
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
