import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import { RecordlySignInDialog } from "./RecordlySignInDialog";
import { RecordingPermissionsDialog } from "./RecordingPermissionsDialog";

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
	// Every development entry point uses the same freely navigable preview.
	const preview = import.meta.env.DEV;
	// The dedicated window can paint its account UI while session recovery runs.
	// `ready` gates account-dependent routing, not the window's initial display.
	const [open, setOpen] = useState(standalone);
	const [inlineFallback, setInlineFallback] = useState(false);
	const [returningSignIn, setReturningSignIn] = useState(false);
	const [startWithPermissions, setStartWithPermissions] = useState(false);
	const checked = useRef(false);
	const openWindow = useCallback(() => {
		setReturningSignIn(false);
		if (standalone) setOpen(true);
		else
			void window.electronAPI.showOnboardingWindow({ preview }).then((shown) => {
				if (!shown) {
					setInlineFallback(true);
					setOpen(true);
				}
			});
	}, [standalone, preview]);
	useEffect(() => {
		if (requestNonce > 0) {
			setStartWithPermissions(!preview);
			if (!preview) saveAppSetting("recordly.onboarding.permissionsRequested", true);
			openWindow();
		}
	}, [requestNonce, openWindow, preview]);
	const close = useCallback(() => {
		if (preview) {
			checked.current = true;
			saveAppSetting(DEV_DISMISSED_KEY, true);
		} else saveAppSetting("recordly.onboarding.permissionsRequested", false);
		setStartWithPermissions(false);
		setOpen(false);
	}, [preview]);

	useEffect(() => {
		if (!ready) return;
		if (preview && checked.current) return;
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
			} else if (permissionsRequested || !seen) {
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
				setStartWithPermissions(true);
				openWindow();
			}),
		[openWindow],
	);

	const finishPermissions = () => {
		if (!preview && !user) return;
		close();
		// Recreate the HUD before closing the last window, including on Windows/Linux.
		void window.electronAPI
			.showRecordingHud()
			.then(() => window.electronAPI.closeOnboardingWindow());
	};
	const finish = () => {
		if (!preview && !user) return;
		if (!preview) saveAppSetting(SEEN_KEY, true);
		finishPermissions();
	};

	if (startWithPermissions && !preview && user && (standalone || inlineFallback))
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
