import { useCallback, useEffect, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { loadAppSetting, saveAppSetting } from "../../../lib/appSettings";
import { KEYSTROKE_OVERLAY_CAPTURE_SETTING } from "../../../lib/keystrokeOverlay";

export function useLaunchWindowSystemState(
	preparePermissions: (args: { startup?: boolean }) => Promise<unknown>,
) {
	const t = useScopedT("launch");
	const [recordingsDirectory, setRecordingsDirectory] = useState<string | null>(null);
	const [hudOverlayMousePassthroughSupported, setHudOverlayMousePassthroughSupported] = useState<
		boolean | null
	>(null);
	const [platform, setPlatform] = useState<string | null>(null);
	const [appVersion, setAppVersion] = useState<string | null>(null);
	const [hideHudFromCapture, setHideHudFromCapture] = useState(true);
	const [captureKeystrokes, setCaptureKeystrokes] = useState(
		() => loadAppSetting<boolean>(KEYSTROKE_OVERLAY_CAPTURE_SETTING) === true,
	);

	useEffect(() => {
		window.electronAPI?.hudOverlayRendererReady?.();
	}, []);

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			try {
				const result = await window.electronAPI.getRecordingsDirectory();
				if (!cancelled && result.success) setRecordingsDirectory(result.path);
			} catch (error) {
				console.error("Failed to load recordings directory:", error);
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		const loadPlatform = async () => {
			try {
				const nextPlatform = await window.electronAPI.getPlatform();
				if (!cancelled) setPlatform(nextPlatform);
			} catch (error) {
				console.error("Failed to load platform:", error);
			}
		};
		void loadPlatform();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		const loadSupport = async () => {
			try {
				const result = await window.electronAPI.getHudOverlayMousePassthroughSupported();
				if (!cancelled && result.success) {
					setHudOverlayMousePassthroughSupported(result.supported);
				}
			} catch (error) {
				console.error("Failed to load HUD overlay mouse passthrough support:", error);
			}
		};
		void loadSupport();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		const syncKeystrokePermission = async () => {
			if (!captureKeystrokes) {
				return;
			}
			try {
				const nextPlatform = platform ?? (await window.electronAPI.getPlatform());
				if (nextPlatform !== "darwin") {
					return;
				}
				const status = await window.electronAPI.getAccessibilityPermissionStatus();
				if (!cancelled && status?.success && status.trusted === false) {
					setCaptureKeystrokes(false);
					saveAppSetting(KEYSTROKE_OVERLAY_CAPTURE_SETTING, false);
				}
			} catch {
				// Keep the stored preference if permission status cannot be read.
			}
		};
		void syncKeystrokePermission();
		return () => {
			cancelled = true;
		};
	}, [captureKeystrokes, platform]);

	useEffect(() => {
		void preparePermissions({ startup: true });
	}, [preparePermissions]);

	useEffect(() => {
		let cancelled = false;
		const loadVersion = async () => {
			try {
				const version = await window.electronAPI.getAppVersion();
				if (!cancelled) setAppVersion(version);
			} catch (error) {
				console.error("Failed to load app version:", error);
			}
		};
		void loadVersion();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		const loadCaptureProtection = async () => {
			try {
				const result = await window.electronAPI.getHudOverlayCaptureProtection();
				if (!cancelled && result.success) {
					setHideHudFromCapture(result.enabled);
				}
			} catch (error) {
				console.error("Failed to load HUD capture protection state:", error);
			}
		};
		void loadCaptureProtection();
		return () => {
			cancelled = true;
		};
	}, []);

	const chooseRecordingsDirectory = useCallback(async () => {
		try {
			const result = await window.electronAPI.chooseRecordingsDirectory();
			if (result.canceled) return;
			if (result.success && result.path) setRecordingsDirectory(result.path);
		} catch (error) {
			console.error("Failed to choose recordings directory:", error);
		}
	}, []);

	const toggleHudCaptureProtection = useCallback(async () => {
		const nextValue = !hideHudFromCapture;
		setHideHudFromCapture(nextValue);
		try {
			const result = await window.electronAPI.setHudOverlayCaptureProtection(nextValue);
			if (!result.success) {
				setHideHudFromCapture(!nextValue);
				return;
			}
			setHideHudFromCapture(result.enabled);
		} catch (error) {
			console.error("Failed to update HUD capture protection:", error);
			setHideHudFromCapture(!nextValue);
		}
	}, [hideHudFromCapture]);

	const toggleCaptureKeystrokes = useCallback(async () => {
		if (captureKeystrokes) {
			setCaptureKeystrokes(false);
			saveAppSetting(KEYSTROKE_OVERLAY_CAPTURE_SETTING, false);
			void window.electronAPI.stopKeystrokeTap?.();
			return;
		}

		const nextPlatform = platform ?? (await window.electronAPI.getPlatform().catch(() => null));
		if (nextPlatform === "darwin") {
			try {
				const permission = await window.electronAPI.requestKeystrokeCapturePermission?.();
				if (!permission?.trusted || permission.tapOk === false) {
					await window.electronAPI.openAccessibilityPreferences();
					await window.electronAPI.openInputMonitoringPreferences?.();
					const clientName = permission?.clientName || "Electron";
					alert(
						t(
							"recording.captureKeystrokesNeedAccessibility",
							"System Settings opened. Under Privacy & Security, enable {{name}} in both Accessibility and Input Monitoring. Not Cursor. Then click Show keys in recording again.",
							{ name: clientName },
						),
					);
					return;
				}
			} catch (error) {
				console.warn("Unable to request key overlay permissions:", error);
				setCaptureKeystrokes(false);
				saveAppSetting(KEYSTROKE_OVERLAY_CAPTURE_SETTING, false);
				return;
			}
		}

		setCaptureKeystrokes(true);
		saveAppSetting(KEYSTROKE_OVERLAY_CAPTURE_SETTING, true);
	}, [captureKeystrokes, platform, t]);

	return {
		recordingsDirectory,
		hudOverlayMousePassthroughSupported,
		platform,
		appVersion,
		hideHudFromCapture,
		setHideHudFromCapture,
		captureKeystrokes,
		chooseRecordingsDirectory,
		toggleHudCaptureProtection,
		toggleCaptureKeystrokes,
	};
}
