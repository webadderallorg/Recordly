import { useCallback, useEffect, useRef, useState } from "react";
import { hasRecordlySession } from "@/lib/auth/recordlyAuth";
import {
	type BrowserMicrophoneProfile,
	DEFAULT_BROWSER_MICROPHONE_PROFILE,
	normalizeBrowserMicrophoneProfile,
} from "./recordingMicrophoneFallback";
export function useRecorderPreferences() {
	const [isMacOS, setIsMacOS] = useState(false);

	const [microphoneEnabled, setMicrophoneEnabled] = useState(false);

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
			if (result.success && typeof result.delay === "number") {
				setCountdownDelayState(result.delay);
			}
		})();
	}, []);

	const setCountdownDelay = useCallback((delay: number) => {
		setCountdownDelayState(delay);
		void window.electronAPI.setCountdownDelay(delay);
	}, []);

	useEffect(() => {
		if (recordingPrefsLoaded.current) return;
		recordingPrefsLoaded.current = true;

		void (async () => {
			const result = await window.electronAPI.getRecordingPreferences();
			if (result.success) {
				setMicrophoneEnabled(result.microphoneEnabled);
				if (result.microphoneDeviceId) {
					setMicrophoneDeviceId(result.microphoneDeviceId);
				}
				setSystemAudioEnabled(result.systemAudioEnabled);
				setWebcamEnabled(result.webcamEnabled);
				if (result.webcamDeviceId) {
					setWebcamDeviceId(result.webcamDeviceId);
				}
			}
		})();
	}, []);

	const persistMicrophoneEnabled = useCallback((enabled: boolean) => {
		setMicrophoneEnabled(enabled);
		void window.electronAPI.setRecordingPreferences({ microphoneEnabled: enabled });
	}, []);

	const persistMicrophoneDeviceId = useCallback((deviceId: string | undefined) => {
		setMicrophoneDeviceId(deviceId);
		void window.electronAPI.setRecordingPreferences({ microphoneDeviceId: deviceId });
	}, []);

	const persistSystemAudioEnabled = useCallback((enabled: boolean) => {
		setSystemAudioEnabled(enabled);
		void window.electronAPI.setRecordingPreferences({ systemAudioEnabled: enabled });
	}, []);

	const persistWebcamEnabled = useCallback((enabled: boolean) => {
		setWebcamEnabled(enabled);
		void window.electronAPI.setRecordingPreferences({ webcamEnabled: enabled });
	}, []);

	const persistWebcamDeviceId = useCallback((deviceId: string | undefined) => {
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
