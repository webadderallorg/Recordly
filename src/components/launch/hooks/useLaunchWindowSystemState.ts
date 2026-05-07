import { useCallback, useEffect, useState } from "react";

export function useLaunchWindowSystemState(
	preparePermissions: (args: { startup?: boolean }) => Promise<unknown>,
) {
	const [recordingsDirectory, setRecordingsDirectory] = useState<string | null>(null);
	const [hudOverlayMousePassthroughSupported, setHudOverlayMousePassthroughSupported] = useState<
		boolean | null
	>(null);
	const [platform, setPlatform] = useState<string | null>(null);
	const [appVersion, setAppVersion] = useState<string | null>(null);
	const [hideHudFromCapture, setHideHudFromCapture] = useState(true);

	useEffect(() => {
		window.electronAPI?.hudOverlayRendererReady?.();
	}, []);

	useEffect(() => {
		const load = async () => {
			const result = await window.electronAPI.getRecordingsDirectory();
			if (result.success) setRecordingsDirectory(result.path);
		};
		void load();
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

	return {
		recordingsDirectory,
		hudOverlayMousePassthroughSupported,
		platform,
		appVersion,
		hideHudFromCapture,
		setHideHudFromCapture,
		chooseRecordingsDirectory,
		toggleHudCaptureProtection,
	};
}
