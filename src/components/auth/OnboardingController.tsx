import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
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
	standalone = false,
}: {
	requestNonce: number;
	ready: boolean;
	user: User | null;
	configured: boolean;
	callbackError?: string;
	standalone?: boolean;
}) {
	// The development tour is optional. Native permission requests and explicit
	// real-flow tests use preview=0; neither mode changes the restored account.
	const [preview, setPreview] = useState(
		() =>
			import.meta.env.DEV &&
			new URLSearchParams(window.location.search).get("onboardingPreview") !== "0",
	);
	// The dedicated window can paint its account UI while session recovery runs.
	// `ready` gates account-dependent routing, not the window's initial display.
	const [open, setOpen] = useState(standalone);
	const [inlineFallback, setInlineFallback] = useState(false);
	const [returningSignIn, setReturningSignIn] = useState(false);
	const [startWithPermissions, setStartWithPermissions] = useState(false);
	const checked = useRef(false);
	const handledRequest = useRef(0);
	const finishingPermissions = useRef(false);
	const openWindow = useCallback(
		(windowPreview = preview) => {
			checked.current = true;
			setPreview(windowPreview);
			setReturningSignIn(false);
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
		if (!standalone) {
			// A preview dismissal survives renderer/window recreation without marking
			// production onboarding complete or replaying a stale permission request.
			if (preview && loadAppSetting<boolean>(DEV_DISMISSED_KEY)) return;
			const permissionsRequested =
				!preview && loadAppSetting<boolean>("recordly.onboarding.permissionsRequested");
			if (permissionsRequested) setStartWithPermissions(true);
			const seen = loadAppSetting<boolean>(SEEN_KEY);
			if (!preview && !user && seen && !permissionsRequested) {
				setReturningSignIn(true);
				setOpen(true);
			} else if (!checked.current && (permissionsRequested || !seen)) {
				// Session updates must not duplicate an in-flight native window request.
				setReturningSignIn(false);
				openWindow();
			}
			return;
		}
		if (!preview && loadAppSetting<boolean>("recordly.onboarding.permissionsRequested")) {
			setStartWithPermissions(true);
			setOpen(true);
			return;
		}
		if (preview || !user) {
			setOpen(true);
			return;
		}
		if (checked.current) return;
		checked.current = true;
		if (!loadAppSetting<boolean>(SEEN_KEY)) setOpen(true);
	}, [ready, user, standalone, openWindow, preview]);

	useEffect(
		() =>
			window.electronAPI.onRecordingPermissionsRequested?.(() => {
				saveAppSetting("recordly.onboarding.permissionsRequested", true);
				setStartWithPermissions(true);
				openWindow(false);
			}),
		[openWindow],
	);

	const finishPermissions = () => {
		if ((!preview && !user) || finishingPermissions.current) return;
		finishingPermissions.current = true;
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
	const finish = () => {
		if (!preview && !user) return;
		if (!preview) saveAppSetting(SEEN_KEY, true);
		finishPermissions();
	};

	if (
		startWithPermissions &&
		!preview &&
		user &&
		loadAppSetting<boolean>(SEEN_KEY) === true &&
		(standalone || inlineFallback)
	)
		return (
			<RecordingPermissionsDialog
				open={open}
				standalone={standalone}
				onFinish={finishPermissions}
				onClose={() => {
					close();
					if (standalone) void window.electronAPI.closeOnboardingWindow();
				}}
			/>
		);

	if (returningSignIn)
		return (
			<RecordlySignInDialog
				open={open}
				onOpenChange={setOpen}
				user={user}
				configured={configured}
				callbackError={callbackError}
				requireSignIn
				onAuthenticated={() => {
					setReturningSignIn(false);
					setOpen(false);
				}}
			/>
		);

	return standalone || inlineFallback ? (
		<RecordlySignInDialog
			onboarding
			preview={preview}
			startWithPermissions={startWithPermissions}
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
			onAuthenticated={finish}
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
