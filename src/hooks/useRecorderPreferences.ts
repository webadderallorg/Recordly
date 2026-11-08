import { useCallback, useEffect, useRef, useState } from "react";
import { hasRecordlySession } from "@/lib/auth/recordlyAuth";
import {
	type BrowserMicrophoneProfile,
	DEFAULT_BROWSER_MICROPHONE_PROFILE,
	normalizeBrowserMicrophoneProfile,
} from "./recordingMicrophoneFallback";
export function useRecorderPreferences() {
	const [isMacOS, setIsMacOS] = useState(false);

	const [microphoneEnabled, setMicrophoneEnabledState] = useState(false);

	const [microphoneDeviceId, setMicrophoneDeviceId] = useState<string | undefined>(undefined);

	const [systemAudioEnabled, setSystemAudioEnabled] = useState(false);

	const [webcamEnabled, setWebcamEnabled] = useState(false);

	const [webcamDeviceId, setWebcamDeviceId] = useState<string | undefined>(undefined);

	const [countdownDelay, setCountdownDelayState] = useState(3);

	const countdownDelayLoaded = useRef(false);

	const recordingPrefsLoaded = useRef(false);

	const browserMicrophoneProfile = useRef<BrowserMicrophoneProfile>(
		DEFAULT_BROWSER_MICROPHONE_PROFILE,
	);

	const requestedBrowserMicrophoneProfile = useRef<string | null>(null);
	const edited = useRef({
		microphoneEnabled: false,
		microphoneDeviceId: false,
		systemAudioEnabled: false,
		webcamEnabled: false,
		webcamDeviceId: false,
		countdownDelay: false,
	});

	const preparePermissions = useCallback(async () => {
		if (!import.meta.env.DEV && !(await hasRecordlySession().catch(() => false))) {
			await window.electronAPI.showRecordingPermissions();
			return false;
		}
		if ((await window.electronAPI.getPlatform()) !== "darwin") return true;
		const [screen, accessibility] = await Promise.all([
			window.electronAPI.getScreenRecordingPermissionStatus(),
			window.electronAPI.getAccessibilityPermissionStatus(),
		]);
		if (
			screen.success &&
			screen.status === "granted" &&
			accessibility.success &&
			accessibility.trusted
		)
			return true;
		await window.electronAPI.showRecordingPermissions();
		return false;
	}, []);

	useEffect(() => {
		void (async () => {
			const platform = await window.electronAPI.getPlatform();
			setIsMacOS(platform === "darwin");
		})();
	}, []);

	useEffect(() => {
		if (typeof window.electronAPI?.getRecordingAudioLabConfig !== "function") {
			return;
		}

		void (async () => {
			const result = await window.electronAPI.getRecordingAudioLabConfig();
			browserMicrophoneProfile.current = normalizeBrowserMicrophoneProfile(
				result.browserMicrophoneProfile,
			);
			requestedBrowserMicrophoneProfile.current =
				result.requestedBrowserMicrophoneProfile ?? null;
			console.info("Browser microphone profile:", browserMicrophoneProfile.current);
		})();
	}, []);

	useEffect(() => {
		if (countdownDelayLoaded.current) return;
		countdownDelayLoaded.current = true;

		void (async () => {
			const result = await window.electronAPI.getCountdownDelay();
			if (
				!edited.current.countdownDelay &&
				result.success &&
				typeof result.delay === "number"
			) {
				setCountdownDelayState(result.delay);
			}
		})();
	}, []);

	const setCountdownDelay = useCallback((delay: number) => {
		edited.current.countdownDelay = true;
		setCountdownDelayState(delay);
		void window.electronAPI.setCountdownDelay(delay);
	}, []);

	useEffect(() => {
		if (recordingPrefsLoaded.current) return;
		recordingPrefsLoaded.current = true;

		void (async () => {
			const result = await window.electronAPI.getRecordingPreferences();
			if (result.success) {
				if (!edited.current.microphoneEnabled)
					setMicrophoneEnabledState(result.microphoneEnabled);
				if (!edited.current.microphoneDeviceId && result.microphoneDeviceId) {
					setMicrophoneDeviceId(result.microphoneDeviceId);
				}
				if (!edited.current.systemAudioEnabled)
					setSystemAudioEnabled(result.systemAudioEnabled);
				if (!edited.current.webcamEnabled) setWebcamEnabled(result.webcamEnabled);
				if (!edited.current.webcamDeviceId && result.webcamDeviceId) {
					setWebcamDeviceId(result.webcamDeviceId);
				}
			}
		})();
	}, []);

	const setMicrophoneEnabled = useCallback((enabled: boolean) => {
		edited.current.microphoneEnabled = true;
		setMicrophoneEnabledState(enabled);
	}, []);

	const persistMicrophoneEnabled = useCallback(
		(enabled: boolean) => {
			setMicrophoneEnabled(enabled);
			void window.electronAPI.setRecordingPreferences({ microphoneEnabled: enabled });
		},
		[setMicrophoneEnabled],
	);

	const persistMicrophoneDeviceId = useCallback((deviceId: string | undefined) => {
		edited.current.microphoneDeviceId = true;
		setMicrophoneDeviceId(deviceId);
		void window.electronAPI.setRecordingPreferences({ microphoneDeviceId: deviceId });
	}, []);

	const persistSystemAudioEnabled = useCallback((enabled: boolean) => {
		edited.current.systemAudioEnabled = true;
		setSystemAudioEnabled(enabled);
		void window.electronAPI.setRecordingPreferences({ systemAudioEnabled: enabled });
	}, []);

	const persistWebcamEnabled = useCallback((enabled: boolean) => {
		edited.current.webcamEnabled = true;
		setWebcamEnabled(enabled);
		void window.electronAPI.setRecordingPreferences({ webcamEnabled: enabled });
	}, []);

	const persistWebcamDeviceId = useCallback((deviceId: string | undefined) => {
		edited.current.webcamDeviceId = true;
		setWebcamDeviceId(deviceId);
		void window.electronAPI.setRecordingPreferences({ webcamDeviceId: deviceId });
	}, []);
	return {
		isMacOS,
		microphoneEnabled,
		setMicrophoneEnabled,
		microphoneDeviceId,
		systemAudioEnabled,
		webcamEnabled,
		webcamDeviceId,
		countdownDelay,
		browserMicrophoneProfile,
		requestedBrowserMicrophoneProfile,
		preparePermissions,
		setCountdownDelay,
		persistMicrophoneEnabled,
		persistMicrophoneDeviceId,
		persistSystemAudioEnabled,
		persistWebcamEnabled,
		persistWebcamDeviceId,
	};
}
