import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import {
	hasSkippedOnboardingSignIn,
	saveSkippedOnboardingSignIn,
} from "@/lib/auth/onboardingSignIn";
import { hasRequiredRecordingPermissions } from "@/lib/recordingPermissions";
import { RecordingPermissionsDialog } from "./RecordingPermissionsDialog";
import { RecordlySignInDialog } from "./RecordlySignInDialog";

const SEEN_KEY = "recordly.onboarding.v1.seen";
const DEV_DISMISSED_KEY = "recordly.dev.onboardingDismissed";

export function OnboardingController({
	requestNonce,
	ready,
	user,
	configured,
	callbackError,
	authenticationVersion,
	standalone = false,
	authCallbackPending = false,
	initialPermissions = false,
	finishStartup,
	onUnlockSavedSignIn,
}: {
	requestNonce: number;
	ready: boolean;
	user: User | null;
	configured: boolean;
	callbackError?: string;
	authenticationVersion?: number;
	standalone?: boolean;
	authCallbackPending?: boolean;
	initialPermissions?: boolean;
	finishStartup?: () => Promise<boolean>;
	onUnlockSavedSignIn?: () => void;
}) {
	// The development tour is optional. Native permission requests and explicit
	// real-flow tests use preview=0; neither mode changes the restored account.
	const [preview, setPreview] = useState(
		() =>
			import.meta.env.DEV &&
			new URLSearchParams(window.location.search).get("onboardingPreview") !== "0",
	);
	const [open, setOpen] = useState(standalone);
	const [inlineFallback, setInlineFallback] = useState(false);
	const [signInSkipped, setSignInSkipped] = useState(hasSkippedOnboardingSignIn);
	const canContinue = Boolean(user || signInSkipped);
	const [startWithPermissions, setStartWithPermissions] = useState(
		() =>
			initialPermissions ||
			(standalone &&
				!preview &&
				loadAppSetting<boolean>("recordly.onboarding.permissionsRequested") === true),
	);
	const checked = useRef(false);
	const handledRequest = useRef(0);
	const finishingPermissions = useRef(false);
	const openWindow = useCallback(
		(windowPreview = preview) => {
			checked.current = true;
			setPreview(windowPreview);
			if (standalone) setOpen(true);
			else
				void window.electronAPI
					.showOnboardingWindow({ preview: windowPreview })
					.catch(() => false)
					.then((shown) => {
						if (!shown) {
							setInlineFallback(true);
							setOpen(true);
						}
					});
		},
		[standalone, preview],
	);
	useEffect(() => {
		if (requestNonce > handledRequest.current) {
			handledRequest.current = requestNonce;
			const requestedPreview = import.meta.env.DEV;
			setStartWithPermissions(!requestedPreview);
			if (!requestedPreview) saveAppSetting("recordly.onboarding.permissionsRequested", true);
			openWindow(requestedPreview);
		}
	}, [requestNonce, openWindow]);
	const close = useCallback(() => {
		checked.current = true;
		if (preview) {
			saveAppSetting(DEV_DISMISSED_KEY, true);
		}
		setStartWithPermissions(false);
		setOpen(false);
	}, [preview]);

	useEffect(() => {
		if (!ready) return;
		if (checked.current && (preview || standalone)) return;
		const hasAccountAccess = canContinue || hasSkippedOnboardingSignIn();
		if (!standalone) {
			// A preview dismissal survives renderer/window recreation without marking
			// production onboarding complete or replaying a stale permission request.
			if (preview && loadAppSetting<boolean>(DEV_DISMISSED_KEY)) return;
			const permissionsRequested =
				!preview && loadAppSetting<boolean>("recordly.onboarding.permissionsRequested");
			const seen = loadAppSetting<boolean>(SEEN_KEY);
			if (hasAccountAccess && seen && permissionsRequested && !checked.current) {
				let cancelled = false;
				void hasRequiredRecordingPermissions()
					.catch(() => false)
					.then((granted) => {
						if (cancelled || checked.current) return;
						if (granted) {
							saveAppSetting("recordly.onboarding.permissionsRequested", false);
							return;
						}
						setStartWithPermissions(true);
						openWindow();
					});
				return () => {
					cancelled = true;
				};
			}
			if (permissionsRequested) setStartWithPermissions(true);
			if (
				!checked.current &&
				(permissionsRequested || !seen || (!preview && !hasAccountAccess))
			) {
				// Session updates must not duplicate an in-flight native window request.
				openWindow();
			}
			return;
		}
		if (!preview && loadAppSetting<boolean>("recordly.onboarding.permissionsRequested")) {
			setStartWithPermissions(true);
			setOpen(true);
			return;
		}
		if (preview || !hasAccountAccess) {
			setOpen(true);
			return;
		}
		if (checked.current) return;
		checked.current = true;
		if (!loadAppSetting<boolean>(SEEN_KEY)) setOpen(true);
	}, [ready, canContinue, standalone, openWindow, preview]);

	const finishPermissions = (markSeen = false) => {
		if (finishingPermissions.current) return;
		if (!preview) {
			if (authCallbackPending || (!canContinue && !hasSkippedOnboardingSignIn())) return;
			if (markSeen) saveAppSetting(SEEN_KEY, true);
		}
		finishingPermissions.current = true;
		if (finishStartup) {
			void finishStartup()
				.then((finished) => {
					if (finished) close();
				})
				.finally(() => {
					finishingPermissions.current = false;
				});
			return;
		}
		let restorePermissionsRequest = false;
		let previousPreviewDismissal: boolean | null = null;
		let markedPreviewDismissed = false;
		// Recreate the HUD before closing the last window, including on Windows/Linux.
		void window.electronAPI
			.showRecordingHud()
			.then(() => {
				// Native close may destroy this renderer before its next continuation.
				if (preview) {
					previousPreviewDismissal = loadAppSetting<boolean>(DEV_DISMISSED_KEY);
					saveAppSetting(DEV_DISMISSED_KEY, true);
					markedPreviewDismissed = true;
				} else {
					restorePermissionsRequest =
						loadAppSetting<boolean>("recordly.onboarding.permissionsRequested") ===
						true;
					saveAppSetting("recordly.onboarding.permissionsRequested", false);
				}
				return window.electronAPI.closeOnboardingWindow();
			})
			.then(() => close())
			.catch(() => {
				if (restorePermissionsRequest)
					saveAppSetting("recordly.onboarding.permissionsRequested", true);
				if (markedPreviewDismissed)
					saveAppSetting(DEV_DISMISSED_KEY, previousPreviewDismissal);
				console.error("[onboarding] Could not return to the recording HUD.");
			})
			.finally(() => {
				finishingPermissions.current = false;
			});
	};
	// Wait for session restoration before choosing a page on a permission restart.
	if (standalone && startWithPermissions && !preview && !ready) return null;

	if (
		startWithPermissions &&
		!finishStartup &&
		!preview &&
		canContinue &&
		loadAppSetting<boolean>(SEEN_KEY) === true &&
		(standalone || inlineFallback)
	)
		return (
			<RecordingPermissionsDialog
				open={open}
				standalone={standalone}
				finishDisabled={authCallbackPending}
				onFinish={() => finishPermissions()}
				onClose={() => {
					close();
					if (standalone) void window.electronAPI.closeOnboardingWindow();
				}}
			/>
		);

	return standalone || inlineFallback ? (
		<RecordlySignInDialog
			onboarding
			finishDisabled={!preview && (!ready || authCallbackPending)}
			preview={preview}
			startWithPermissions={startWithPermissions}
			signInSkipped={!preview && signInSkipped}
			onContinueAsGuest={() => {
				if (preview || signInSkipped) return true;
				if (!saveSkippedOnboardingSignIn()) return false;
				setSignInSkipped(true);
				return true;
			}}
			variant="wide"
			open={open}
			onOpenChange={(value) => {
				if (!value && (user || preview)) {
					close();
					if (standalone) void window.electronAPI.closeOnboardingWindow();
				}
			}}
			user={user}
			configured={configured}
			callbackError={callbackError}
			onUnlockSavedSignIn={onUnlockSavedSignIn}
			authenticationVersion={authenticationVersion}
			onAuthenticated={() => finishPermissions(true)}
			onWindowClose={
				standalone
					? () => {
							close();
							void window.electronAPI.closeOnboardingWindow();
						}
					: undefined
			}
		/>
	) : null;
}
