import type React from "react";
import { useCallback, useEffect, useState } from "react";

interface SetupParams {
	preparePermissions: (opts?: { startup?: boolean }) => Promise<boolean>;
	activeDropdown: string;
	projectBrowserOpen: boolean;
	showRecordingWebcamPreview: boolean;
	hudContentRef: React.RefObject<HTMLDivElement | null>;
	hudBarRef: React.RefObject<HTMLDivElement | null>;
	recordingWebcamPreviewContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function useLaunchWindowSetup({
	preparePermissions,
	activeDropdown,
	projectBrowserOpen,
	showRecordingWebcamPreview,
	hudContentRef,
	hudBarRef,
	recordingWebcamPreviewContainerRef,
}: SetupParams) {
	const [selectedSource, setSelectedSource] = useState("Screen");
	const [hasSelectedSource, setHasSelectedSource] = useState(false);
	const [platform, setPlatform] = useState<string | null>(null);
	const [appVersion, setAppVersion] = useState<string | null>(null);
	const [updateStatus, setUpdateStatus] = useState<{
		status:
			| "idle"
			| "checking"
			| "up-to-date"
			| "available"
			| "downloading"
			| "ready"
			| "error";
		currentVersion: string;
		availableVersion: string | null;
		detail?: string;
	}>({
		status: "idle",
		currentVersion: "",
		availableVersion: null,
	});
	const [updateActionPending, setUpdateActionPending] = useState(false);
	const [hideHudFromCapture, setHideHudFromCapture] = useState(true);

	// Selected source listener
	useEffect(() => {
		let mounted = true;

		const applySelectedSource = (source: { name?: string } | null | undefined) => {
			if (!mounted) return;
			if (source?.name) {
				setSelectedSource(source.name);
				setHasSelectedSource(true);
				return;
			}
			setSelectedSource("Screen");
			setHasSelectedSource(false);
		};

		void window.electronAPI.getSelectedSource().then((source) => {
			applySelectedSource(source);
		});

		const cleanup = window.electronAPI.onSelectedSourceChanged((source) => {
			applySelectedSource(source);
		});

		return () => {
			mounted = false;
			cleanup?.();
		};
	}, []);

	// Platform loading
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

	// Prepare permissions
	useEffect(() => {
		void preparePermissions({ startup: true });
	}, [preparePermissions]);

	// Update status polling
	useEffect(() => {
		let mounted = true;

		const refreshUpdateStatus = async () => {
			try {
				const summary = await window.electronAPI.getUpdateStatusSummary();
				if (mounted) setUpdateStatus(summary);
			} catch (error) {
				console.error("Failed to load update status summary:", error);
			}
		};

		void refreshUpdateStatus();
		const pollTimer = window.setInterval(() => {
			void refreshUpdateStatus();
		}, 2500);

		return () => {
			mounted = false;
			window.clearInterval(pollTimer);
		};
	}, []);

	// App version loading
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

	// HUD capture protection loading
	useEffect(() => {
		let cancelled = false;
		const loadHudCaptureProtection = async () => {
			try {
				const result = await window.electronAPI.getHudOverlayCaptureProtection();
				if (!cancelled && result.success) {
					setHideHudFromCapture(result.enabled);
				}
			} catch (error) {
				console.error("Failed to load HUD capture protection state:", error);
			}
		};
		void loadHudCaptureProtection();
		return () => {
			cancelled = true;
		};
	}, []);

	// HUD overlay expanded state
	useEffect(() => {
		const expanded =
			activeDropdown !== "none" || projectBrowserOpen || showRecordingWebcamPreview;
		window.electronAPI.setHudOverlayExpanded(expanded);

		return () => {
			window.electronAPI.setHudOverlayExpanded(false);
		};
	}, [activeDropdown, projectBrowserOpen, showRecordingWebcamPreview]);

	// HUD size reporting
	const reportHudSize = useCallback(() => {
		const hudContent = hudContentRef.current;
		const hudBar = hudBarRef.current;
		if (!hudContent || !hudBar) return;

		if (showRecordingWebcamPreview) {
			const viewportWidth = Math.max(window.innerWidth, window.screen?.width ?? 0);
			const viewportHeight = Math.max(window.innerHeight, window.screen?.height ?? 0);
			window.electronAPI.setHudOverlayCompactWidth(Math.ceil(viewportWidth));
			window.electronAPI.setHudOverlayMeasuredHeight(Math.ceil(viewportHeight), true);
			return;
		}

		const hudContentRect = hudContent.getBoundingClientRect();
		const hudBarRect = hudBar.getBoundingClientRect();
		const standardWidth = Math.max(
			hudBarRect.width,
			hudBar.scrollWidth,
			hudContentRect.width,
			hudContent.scrollWidth,
		);
		const standardHeight = Math.max(hudContentRect.height, hudContent.scrollHeight);

		window.electronAPI.setHudOverlayCompactWidth(Math.ceil(standardWidth + 24));
		window.electronAPI.setHudOverlayMeasuredHeight(
			Math.ceil(standardHeight + 24),
			activeDropdown !== "none" || projectBrowserOpen,
		);
	}, [activeDropdown, projectBrowserOpen, showRecordingWebcamPreview, hudContentRef, hudBarRef]);

	// HUD resize observer
	useEffect(() => {
		const hudContent = hudContentRef.current;
		const hudBar = hudBarRef.current;
		const previewContainer = recordingWebcamPreviewContainerRef.current;
		if (!hudContent || !hudBar || typeof ResizeObserver === "undefined") return;

		let frameId = 0;
		const scheduleHudSizeReport = () => {
			if (frameId !== 0) cancelAnimationFrame(frameId);
			frameId = requestAnimationFrame(() => {
				frameId = 0;
				reportHudSize();
			});
		};

		scheduleHudSizeReport();

		const resizeObserver = new ResizeObserver(() => {
			scheduleHudSizeReport();
		});
		resizeObserver.observe(hudContent);
		resizeObserver.observe(hudBar);
		if (previewContainer) resizeObserver.observe(previewContainer);

		return () => {
			resizeObserver.disconnect();
			if (frameId !== 0) cancelAnimationFrame(frameId);
		};
	}, [reportHudSize, hudContentRef, hudBarRef, recordingWebcamPreviewContainerRef]);

	// Update button handler
	const handleUpdateButtonClick = async () => {
		if (updateActionPending || updateStatus.status === "downloading") return;

		setUpdateActionPending(true);
		try {
			switch (updateStatus.status) {
				case "available":
					await window.electronAPI.downloadAvailableUpdate();
					break;
				case "ready":
					await window.electronAPI.installDownloadedUpdate();
					break;
				default:
					await window.electronAPI.checkForAppUpdates();
					break;
			}
			const summary = await window.electronAPI.getUpdateStatusSummary();
			setUpdateStatus(summary);
		} catch (error) {
			console.error("Failed to handle update button action:", error);
		} finally {
			setUpdateActionPending(false);
		}
	};

	return {
		selectedSource,
		setSelectedSource,
		hasSelectedSource,
		setHasSelectedSource,
		platform,
		appVersion,
		updateStatus,
		updateActionPending,
		hideHudFromCapture,
		setHideHudFromCapture,
		handleUpdateButtonClick,
	};
}
