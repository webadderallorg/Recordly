import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import { RecordlySignInDialog } from "./RecordlySignInDialog";

const SEEN_KEY = "recordly.onboarding.v1.seen";

export function OnboardingController({
	requestNonce,
	ready,
	user,
	configured,
	callbackError,
}: {
	requestNonce: number;
	ready: boolean;
	user: User | null;
	configured: boolean;
	callbackError?: string;
}) {
	const [open, setOpen] = useState(false);
	const [startWithPermissions, setStartWithPermissions] = useState(false);
	const checked = useRef(false);
	useEffect(() => {
		if (requestNonce > 0) {
			setStartWithPermissions(true);
			setOpen(true);
		}
	}, [requestNonce]);
	const close = useCallback(() => {
		saveAppSetting("recordly.onboarding.permissionsRequested", false);
		setStartWithPermissions(false);
		setOpen(false);
	}, []);

	useEffect(() => {
		if (!ready) return;
		// Check this before the "already seen" gates below so a permissions
		// flow interrupted mid-way (e.g. app restart) reopens for guests too.
		if (loadAppSetting<boolean>("recordly.onboarding.permissionsRequested")) {
			setStartWithPermissions(true);
			setOpen(true);
			if (user) checked.current = true;
			return;
		}
		if (!user) {
			// Cloud sign-in isn't set up in this build - don't keep re-trapping
			// someone who already chose to continue without an account.
			if (!configured && loadAppSetting<boolean>(SEEN_KEY)) return;
			setOpen(true);
			return;
		}
		if (checked.current) return;
		checked.current = true;
		if (!loadAppSetting<boolean>(SEEN_KEY)) setOpen(true);
	}, [ready, user, configured]);

	useEffect(
		() =>
			window.electronAPI.onRecordingPermissionsRequested?.(() => {
				setStartWithPermissions(true);
				setOpen(true);
			}),
		[],
	);

	const finish = () => {
		if (!user) return;
		saveAppSetting(SEEN_KEY, true);
		close();
		void window.electronAPI.showRecordingHud();
	};

	const continueWithoutAccount = () => {
		saveAppSetting(SEEN_KEY, true);
		close();
		void window.electronAPI.showRecordingHud();
	};

	return (
		<RecordlySignInDialog
			onboarding
			startWithPermissions={startWithPermissions}
			variant="wide"
			open={open}
			onOpenChange={(value) => {
				if (!value && (user || !configured)) close();
			}}
			user={user}
			configured={configured}
			callbackError={callbackError}
			onAuthenticated={finish}
			onContinueWithoutAccount={configured ? undefined : continueWithoutAccount}
		/>
	);
}
