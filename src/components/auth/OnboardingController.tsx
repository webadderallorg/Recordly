import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
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
		if (requestNonce > 0) setOpen(true);
	}, [requestNonce]);
	const close = useCallback(() => {
		saveAppSetting(SEEN_KEY, true);
		saveAppSetting("recordly.onboarding.permissionsRequested", false);
		setStartWithPermissions(false);
		setOpen(false);
	}, []);

	useEffect(() => {
		if (!ready || checked.current) return;
		checked.current = true;
		if (loadAppSetting<boolean>("recordly.onboarding.permissionsRequested")) {
			setStartWithPermissions(true);
			setOpen(true);
		} else if (!loadAppSetting<boolean>(SEEN_KEY)) setOpen(true);
	}, [ready]);

	useEffect(
		() =>
			window.electronAPI.onRecordingPermissionsRequested?.(() => {
				setStartWithPermissions(true);
				setOpen(true);
			}),
		[],
	);

	const finish = () => {
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
				if (!value) close();
			}}
			user={user}
			configured={configured}
			callbackError={callbackError}
			onAuthenticated={finish}
		/>
	);
}
