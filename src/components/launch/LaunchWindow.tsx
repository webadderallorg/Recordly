import {
	CaretUp as ChevronUp,
	Microphone as Mic,
	MicrophoneSlash as MicOff,
	Minus,
	Monitor,
	DotsThreeVertical as MoreVertical,
	Timer,
	VideoCamera as Video,
	VideoCameraSlash as VideoOff,
	X,
	ArrowClockwise as RefreshCw,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { RxDragHandleDots2 } from "react-icons/rx";
import { useScopedT } from "../../contexts/I18nContext";
import { useMicrophoneDevices } from "../../hooks/useMicrophoneDevices";
import { useScreenRecorder } from "../../hooks/useScreenRecorder";
import { useVideoDevices } from "../../hooks/useVideoDevices";
import ProjectBrowserDialog, {
	type ProjectLibraryEntry,
} from "../video-editor/ProjectBrowserDialog";
import {
	canShowFloatingWebcamPreview,
	canToggleFloatingWebcamPreview,
} from "./floatingWebcamPreview";
import {
	mergeHudInteractiveBounds,
	shouldRestoreHudMousePassthroughAfterDrag,
} from "./hudMousePassthrough";
import styles from "./LaunchWindow.module.css";
import {
	CountdownPopover,
	MicPopover,
	MorePopover,
	SourcePopover,
	WebcamPopover,
} from "./LaunchHudPopovers";

import { Separator } from "@/components/ui/separator";
import { Button } from "../ui/button";
import { RecordingControls } from "./RecordingControls";
import { useCallback, useEffect, useRef, useState } from "react";

interface DesktopSource {
	id: string;
	name: string;
	thumbnail: string | null;
	display_id: string;
	appIcon: string | null;
	sourceType?: "screen" | "window";
	appName?: string;
	windowTitle?: string;
}

const WEBCAM_PREVIEW_DRAG_THRESHOLD = 6;
const DEFAULT_WEBCAM_PREVIEW_OFFSET = { x: 0, y: 0 };
const DEFAULT_RECORDING_HUD_OFFSET = { x: 0, y: 0 };
const SHOW_DEV_UPDATE_PREVIEW = import.meta.env.DEV;

export function LaunchWindow() {
	const t = useScopedT("launch");

	const {
		recording,
		paused,
		finalizing,
		countdownActive,
		toggleRecording,
		pauseRecording,
		resumeRecording,
		cancelRecording,
		microphoneEnabled,
		setMicrophoneEnabled,
		microphoneDeviceId,
		setMicrophoneDeviceId,
		systemAudioEnabled,
		setSystemAudioEnabled,
		webcamEnabled,
		setWebcamEnabled,
		webcamDeviceId,
		setWebcamDeviceId,
		countdownDelay,
		setCountdownDelay,
		preparePermissions,
	} = useScreenRecorder();

	const [recordingStart, setRecordingStart] = useState<number | null>(null);
	const [elapsed, setElapsed] = useState(0);
	const [pausedAt, setPausedAt] = useState<number | null>(null);
	const [pausedTotal, setPausedTotal] = useState(0);
	const [selectedSource, setSelectedSource] = useState("Screen");
	const [hasSelectedSource, setHasSelectedSource] = useState(false);
	const [, setRecordingsDirectory] = useState<string | null>(null);
	const [sourcePopoverOpen, setSourcePopoverOpen] = useState(false);
	const [micPopoverOpen, setMicPopoverOpen] = useState(false);
	const [webcamPopoverOpen, setWebcamPopoverOpen] = useState(false);
	const [countdownPopoverOpen, setCountdownPopoverOpen] = useState(false);
	const [morePopoverOpen, setMorePopoverOpen] = useState(false);
	const [projectLibraryEntries, setProjectLibraryEntries] = useState<ProjectLibraryEntry[]>([]);
	const [projectBrowserOpen, setProjectBrowserOpen] = useState(false);
	const [sources, setSources] = useState<DesktopSource[]>([]);
	const [sourcesLoading, setSourcesLoading] = useState(false);
	const [hideHudFromCapture, setHideHudFromCapture] = useState(true);
	const [showFloatingWebcamPreview, setShowFloatingWebcamPreview] = useState(true);
	const [webcamPreviewOffset, setWebcamPreviewOffset] = useState(DEFAULT_WEBCAM_PREVIEW_OFFSET);
	const [recordingHudOffset, setRecordingHudOffset] = useState(DEFAULT_RECORDING_HUD_OFFSET);
	const [isHudDragging, setIsHudDragging] = useState(false);
	const [hudOverlayMousePassthroughSupported, setHudOverlayMousePassthroughSupported] = useState<
		boolean | null
	>(null);
	const [platform, setPlatform] = useState<string | null>(null);
	const [appVersion, setAppVersion] = useState<string | null>(null);
	const hudContentRef = useRef<HTMLDivElement>(null);
	const hudBarRef = useRef<HTMLDivElement>(null);
	const hudBarTransformRef = useRef<HTMLDivElement | null>(null);
	const recordingHudOffsetRef = useRef(DEFAULT_RECORDING_HUD_OFFSET);
	const webcamPreviewRef = useRef<HTMLVideoElement | null>(null);
	const recordingWebcamPreviewRef = useRef<HTMLVideoElement | null>(null);
	const recordingWebcamPreviewContainerRef = useRef<HTMLDivElement | null>(null);
	const previewStreamRef = useRef<MediaStream | null>(null);
	const webcamPreviewDragStartRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		originX: number;
		originY: number;
		initialLeft: number;
		initialTop: number;
		previewWidth: number;
		previewHeight: number;
		dragging: boolean;
	} | null>(null);
	const hudDragStartRef = useRef<
		| {
				pointerId: number;
				startX: number;
				startY: number;
				originX: number;
				originY: number;
				initialLeft: number;
				initialTop: number;
				hudWidth: number;
				hudHeight: number;
		  }
		| null
	>(null);
	const isHudDraggingRef = useRef(false);
	const isWebcamPreviewDraggingRef = useRef(false);
	const hudDragMoveRafRef = useRef<number | null>(null);
	const hudDragPendingPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);

	const anyPopoverOpen =
		sourcePopoverOpen ||
		micPopoverOpen ||
		webcamPopoverOpen ||
		countdownPopoverOpen ||
		morePopoverOpen;

	const closeAllPopovers = useCallback(() => {
		setSourcePopoverOpen(false);
		setMicPopoverOpen(false);
		setWebcamPopoverOpen(false);
		setCountdownPopoverOpen(false);
		setMorePopoverOpen(false);
	}, []);

	const showWebcamControls = webcamEnabled && !recording;
	const showRecordingWebcamPreview =
		webcamEnabled &&
		canShowFloatingWebcamPreview(
			showFloatingWebcamPreview,
			hudOverlayMousePassthroughSupported,
		);
	const shouldStreamWebcamPreview =
		webcamEnabled && (showRecordingWebcamPreview || (showWebcamControls && webcamPopoverOpen));
	const { devices, selectedDeviceId, setSelectedDeviceId } = useMicrophoneDevices(
		microphoneEnabled || micPopoverOpen,
		microphoneDeviceId,
	);
	const {
		devices: videoDevices,
		selectedDeviceId: selectedVideoDeviceId,
		setSelectedDeviceId: setSelectedVideoDeviceId,
	} = useVideoDevices(webcamEnabled || webcamPopoverOpen);

	const supportsHudCaptureProtection = platform !== "linux";

	useEffect(() => {
		if (!selectedDeviceId) {
			return;
		}

		setMicrophoneDeviceId(selectedDeviceId === "default" ? undefined : selectedDeviceId);
	}, [selectedDeviceId, setMicrophoneDeviceId]);

	useEffect(() => {
		if (selectedVideoDeviceId && selectedVideoDeviceId !== "default") {
			setWebcamDeviceId(selectedVideoDeviceId);
		}
	}, [selectedVideoDeviceId, setWebcamDeviceId]);

	useEffect(() => {
		if (!webcamEnabled) {
			setWebcamPreviewOffset(DEFAULT_WEBCAM_PREVIEW_OFFSET);
			webcamPreviewDragStartRef.current = null;
			isWebcamPreviewDraggingRef.current = false;
			setShowFloatingWebcamPreview(true);
		}
	}, [webcamEnabled]);

	useEffect(() => {
		recordingHudOffsetRef.current = recordingHudOffset;
		if (!isHudDraggingRef.current && hudBarTransformRef.current) {
			hudBarTransformRef.current.style.transform = `translate3d(${recordingHudOffset.x}px, ${recordingHudOffset.y}px, 0)`;
		}
	}, [recordingHudOffset]);

	const handleWebcamPreviewPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) {
			return;
		}

		const previewRect = event.currentTarget.getBoundingClientRect();

		event.preventDefault();
		window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
		webcamPreviewDragStartRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			originX: webcamPreviewOffset.x,
			originY: webcamPreviewOffset.y,
			initialLeft: previewRect.left,
			initialTop: previewRect.top,
			previewWidth: previewRect.width,
			previewHeight: previewRect.height,
			dragging: false,
		};
		event.currentTarget.setPointerCapture(event.pointerId);
	};

	const handleWebcamPreviewPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const dragState = webcamPreviewDragStartRef.current;
		if (!dragState || dragState.pointerId !== event.pointerId) {
			return;
		}

		const deltaX = event.clientX - dragState.startX;
		const deltaY = event.clientY - dragState.startY;

		if (!dragState.dragging && Math.hypot(deltaX, deltaY) < WEBCAM_PREVIEW_DRAG_THRESHOLD) {
			return;
		}

		if (!dragState.dragging) {
			dragState.dragging = true;
			isWebcamPreviewDraggingRef.current = true;
		}

		const viewportWidth = Math.max(window.innerWidth, window.screen?.width ?? 0);
		const viewportHeight = Math.max(window.innerHeight, window.screen?.height ?? 0);
		const unclampedLeft = dragState.initialLeft + deltaX;
		const unclampedTop = dragState.initialTop + deltaY;
		const clampedLeft = Math.min(
			Math.max(0, unclampedLeft),
			Math.max(0, viewportWidth - dragState.previewWidth),
		);
		const clampedTop = Math.min(
			Math.max(0, unclampedTop),
			Math.max(0, viewportHeight - dragState.previewHeight),
		);

		setWebcamPreviewOffset({
			x: dragState.originX + (clampedLeft - dragState.initialLeft),
			y: dragState.originY + (clampedTop - dragState.initialTop),
		});
	};

	const handleWebcamPreviewPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
		const dragState = webcamPreviewDragStartRef.current;
		if (!dragState || dragState.pointerId !== event.pointerId) {
			return;
		}

		const wasDragging = dragState.dragging;
		webcamPreviewDragStartRef.current = null;
		isWebcamPreviewDraggingRef.current = false;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		if (wasDragging) {
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
		}
	};

	const handleHudBarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) {
			return;
		}

		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		isHudDraggingRef.current = true;
		setIsHudDragging(true);
		window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
		if (!hudBarRef.current) {
			return;
		}
		const hudRect = hudBarRef.current.getBoundingClientRect();
		hudDragStartRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			originX: recordingHudOffsetRef.current.x,
			originY: recordingHudOffsetRef.current.y,
			initialLeft: hudRect.left,
			initialTop: hudRect.top,
			hudWidth: hudRect.width,
			hudHeight: hudRect.height,
		};
	};

	const handleHudBarPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const dragState = hudDragStartRef.current;
		if (!dragState || dragState.pointerId !== event.pointerId) {
			return;
		}

		hudDragPendingPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
		if (hudDragMoveRafRef.current !== null) {
			return;
		}

		hudDragMoveRafRef.current = requestAnimationFrame(() => {
			hudDragMoveRafRef.current = null;
			const latestDragState = hudDragStartRef.current;
			const pointer = hudDragPendingPointerRef.current;
			if (!latestDragState || !pointer) {
				return;
			}

			const deltaX = pointer.clientX - latestDragState.startX;
			const deltaY = pointer.clientY - latestDragState.startY;
			const viewportWidth = Math.max(window.innerWidth, window.screen?.width ?? 0);
			const viewportHeight = Math.max(window.innerHeight, window.screen?.height ?? 0);
			const unclampedLeft = latestDragState.initialLeft + deltaX;
			const unclampedTop = latestDragState.initialTop + deltaY;
			const clampedLeft = Math.min(
				Math.max(0, unclampedLeft),
				Math.max(0, viewportWidth - latestDragState.hudWidth),
			);
			const clampedTop = Math.min(
				Math.max(0, unclampedTop),
				Math.max(0, viewportHeight - latestDragState.hudHeight),
			);

			const nextOffset = {
				x: latestDragState.originX + (clampedLeft - latestDragState.initialLeft),
				y: latestDragState.originY + (clampedTop - latestDragState.initialTop),
			};
			recordingHudOffsetRef.current = nextOffset;
			if (hudBarTransformRef.current) {
				hudBarTransformRef.current.style.transform = `translate3d(${nextOffset.x}px, ${nextOffset.y}px, 0)`;
			}
		});
	};

	const handleHudBarPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
		const dragState = hudDragStartRef.current;
		if (!dragState || dragState.pointerId !== event.pointerId) {
			return;
		}

		if (hudDragMoveRafRef.current !== null) {
			cancelAnimationFrame(hudDragMoveRafRef.current);
			hudDragMoveRafRef.current = null;
		}
		hudDragPendingPointerRef.current = null;

		hudDragStartRef.current = null;
		const wasDragging = isHudDraggingRef.current;
		isHudDraggingRef.current = false;
		setIsHudDragging(false);
		setRecordingHudOffset({ ...recordingHudOffsetRef.current });
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		const hudBounds = mergeHudInteractiveBounds(
			[
				hudContentRef.current?.getBoundingClientRect(),
				hudBarRef.current?.getBoundingClientRect(),
				recordingWebcamPreviewContainerRef.current?.getBoundingClientRect(),
			].map((bounds) =>
				bounds
					? {
							left: bounds.left,
							top: bounds.top,
							right: bounds.right,
							bottom: bounds.bottom,
						}
					: null,
			),
		);
		if (
			wasDragging &&
			shouldRestoreHudMousePassthroughAfterDrag(hudBounds, event.clientX, event.clientY)
		) {
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
		}
	};

	const attachPreviewStreamToNode = useCallback((videoElement: HTMLVideoElement | null) => {
		const previewStream = previewStreamRef.current;
		if (!videoElement || !previewStream || videoElement.srcObject === previewStream) {
			return;
		}

		videoElement.srcObject = previewStream;
		const playPromise = videoElement.play();
		if (playPromise) {
			playPromise.catch(() => {
				// Ignore autoplay interruptions while the preview element mounts.
			});
		}
	}, []);

	useEffect(() => {
		return () => {
			if (hudDragMoveRafRef.current !== null) {
				cancelAnimationFrame(hudDragMoveRafRef.current);
			}
			hudDragMoveRafRef.current = null;
			hudDragPendingPointerRef.current = null;
			hudDragStartRef.current = null;
		};
	}, []);

	const setWebcamPreviewNode = useCallback(
		(node: HTMLVideoElement | null) => {
			webcamPreviewRef.current = node;
			attachPreviewStreamToNode(node);
		},
		[attachPreviewStreamToNode],
	);

	const setRecordingWebcamPreviewNode = useCallback(
		(node: HTMLVideoElement | null) => {
			recordingWebcamPreviewRef.current = node;
			attachPreviewStreamToNode(node);
		},
		[attachPreviewStreamToNode],
	);

	useEffect(() => {
		let mounted = true;

		const startPreview = async () => {
			if (!shouldStreamWebcamPreview) {
				return;
			}

			try {
				const previewStream = await navigator.mediaDevices.getUserMedia({
					video: webcamDeviceId
						? {
								deviceId: { exact: webcamDeviceId },
								width: { ideal: 320 },
								height: { ideal: 320 },
								frameRate: { ideal: 24, max: 30 },
							}
						: {
								width: { ideal: 320 },
								height: { ideal: 320 },
								frameRate: { ideal: 24, max: 30 },
							},
					audio: false,
				});

				if (!mounted) {
					previewStream.getTracks().forEach((track) => track.stop());
					return;
				}

				previewStreamRef.current = previewStream;
				attachPreviewStreamToNode(webcamPreviewRef.current);
				attachPreviewStreamToNode(recordingWebcamPreviewRef.current);
			} catch (error) {
				console.warn("Failed to start live webcam preview:", error);
			}
		};

		void startPreview();

		return () => {
			mounted = false;
			const previewNode = webcamPreviewRef.current;
			const recordingPreviewNode = recordingWebcamPreviewRef.current;
			const previewStream = previewStreamRef.current;

			[previewNode, recordingPreviewNode]
				.filter((node): node is HTMLVideoElement => Boolean(node))
				.forEach((videoElement) => {
					videoElement.pause();
					videoElement.srcObject = null;
				});
			previewStream?.getTracks().forEach((track) => track.stop());
			if (previewStreamRef.current === previewStream) {
				previewStreamRef.current = null;
			}
		};
	}, [attachPreviewStreamToNode, shouldStreamWebcamPreview, webcamDeviceId]);

	useEffect(() => {
		let timer: NodeJS.Timeout | null = null;
		if (recording) {
			if (!recordingStart) {
				setRecordingStart(Date.now());
				setPausedTotal(0);
			}
			if (paused) {
				if (!pausedAt) setPausedAt(Date.now());
				if (timer) clearInterval(timer);
			} else {
				if (pausedAt) {
					setPausedTotal((prev) => prev + (Date.now() - pausedAt));
					setPausedAt(null);
				}
				timer = setInterval(() => {
					if (recordingStart) {
						setElapsed(Math.floor((Date.now() - recordingStart - pausedTotal) / 1000));
					}
				}, 1000);
			}
		} else {
			setRecordingStart(null);
			setElapsed(0);
			setPausedAt(null);
			setPausedTotal(0);
			if (timer) clearInterval(timer);
		}
		return () => {
			if (timer) clearInterval(timer);
		};
	}, [recording, recordingStart, paused, pausedAt, pausedTotal]);

	const formatTime = (seconds: number) => {
		const m = Math.floor(seconds / 60)
			.toString()
			.padStart(2, "0");
		const s = (seconds % 60).toString().padStart(2, "0");
		return `${m}:${s}`;
	};

	useEffect(() => {
		let mounted = true;

		const applySelectedSource = (source: { name?: string } | null | undefined) => {
			if (!mounted) {
				return;
			}

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
		const loadHudOverlayMousePassthroughSupport = async () => {
			try {
				const result = await window.electronAPI.getHudOverlayMousePassthroughSupported();
				if (!cancelled && result.success) {
					setHudOverlayMousePassthroughSupported(result.supported);
				}
			} catch (error) {
				console.error("Failed to load HUD overlay mouse passthrough support:", error);
			}
		};
		void loadHudOverlayMousePassthroughSupport();
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

	const fetchSources = useCallback(async () => {
		if (!window.electronAPI) return;
		setSourcesLoading(true);
		try {
			const rawSources = await window.electronAPI.getSources({
				types: ["screen", "window"],
				thumbnailSize: { width: 160, height: 90 },
				fetchWindowIcons: true,
			});
			setSources(
				rawSources.map((s) => {
					const isWindow = s.id.startsWith("window:");
					const type = s.sourceType ?? (isWindow ? "window" : "screen");
					let displayName = s.name;
					let appName = s.appName;
					if (isWindow && !appName && s.name.includes(" — ")) {
						const parts = s.name.split(" — ");
						appName = parts[0]?.trim();
						displayName = parts.slice(1).join(" — ").trim() || s.name;
					} else if (isWindow && s.windowTitle) {
						displayName = s.windowTitle;
					}
					return {
						id: s.id,
						name: displayName,
						thumbnail: s.thumbnail,
						display_id: s.display_id,
						appIcon: s.appIcon,
						sourceType: type,
						appName,
						windowTitle: s.windowTitle ?? displayName,
					};
				}),
			);
		} catch (error) {
			console.error("Failed to fetch sources:", error);
		} finally {
			setSourcesLoading(false);
		}
	}, []);

	const handleSourceSelect = async (source: DesktopSource) => {
		await window.electronAPI.selectSource(source);
		setSelectedSource(source.name);
		setHasSelectedSource(true);
		setSourcePopoverOpen(false);
		window.electronAPI.showSourceHighlight?.({
			...source,
			name: source.appName ? `${source.appName} — ${source.name}` : source.name,
			appName: source.appName,
		});
	};

	const openVideoFile = async () => {
		setMorePopoverOpen(false);
		const result = await window.electronAPI.openVideoFilePicker();
		if (result.canceled) return;
		if (result.success && result.path) {
			await window.electronAPI.setCurrentVideoPath(result.path);
			await window.electronAPI.switchToEditor();
		}
	};

	const refreshProjectLibrary = useCallback(async () => {
		try {
			const result = await window.electronAPI.listProjectFiles();
			if (!result.success) return;

			setProjectLibraryEntries(result.entries);
		} catch (error) {
			console.error("Failed to load project library:", error);
		}
	}, []);

	const openProjectBrowser = useCallback(async () => {
		if (projectBrowserOpen) {
			setProjectBrowserOpen(false);
			return;
		}

		closeAllPopovers();
		await refreshProjectLibrary();
		setProjectBrowserOpen(true);
	}, [closeAllPopovers, projectBrowserOpen, refreshProjectLibrary]);

	const openProjectFromLibrary = useCallback(async (projectPath: string) => {
		try {
			const result = await window.electronAPI.openProjectFileAtPath(projectPath);
			if (result.canceled || !result.success) {
				return;
			}

			setProjectBrowserOpen(false);
			await window.electronAPI.switchToEditor();
		} catch (error) {
			console.error("Failed to open project from library:", error);
		}
	}, []);

	const chooseRecordingsDirectory = async () => {
		setMorePopoverOpen(false);
		const result = await window.electronAPI.chooseRecordingsDirectory();
		if (result.canceled) return;
		if (result.success && result.path) setRecordingsDirectory(result.path);
	};

	const toggleHudCaptureProtection = async () => {
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
	};

	const handlePopoverOpenChange = useCallback(
		(which: "sources" | "mic" | "webcam" | "countdown" | "more", open: boolean) => {
			if (!open) {
				if (which === "sources") setSourcePopoverOpen(false);
				if (which === "mic") setMicPopoverOpen(false);
				if (which === "webcam") setWebcamPopoverOpen(false);
				if (which === "countdown") setCountdownPopoverOpen(false);
				if (which === "more") setMorePopoverOpen(false);
				return;
			}

			setProjectBrowserOpen(false);
			closeAllPopovers();
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
			if (which === "sources") setSourcePopoverOpen(true);
			if (which === "mic") setMicPopoverOpen(true);
			if (which === "webcam") setWebcamPopoverOpen(true);
			if (which === "countdown") setCountdownPopoverOpen(true);
			if (which === "more") setMorePopoverOpen(true);
		},
		[closeAllPopovers],
	);

	const screenSources = sources.filter((s) => s.sourceType === "screen");
	const windowSources = sources.filter((s) => s.sourceType === "window");
	const hudStateTransition = {
		duration: 0.24,
		ease: [0.22, 1, 0.36, 1] as const,
	};


	const recordingControls = (
		<RecordingControls
			paused={paused}
			microphoneEnabled={microphoneEnabled}
			elapsed={elapsed}
			onToggleMicrophone={() => setMicrophoneEnabled(!microphoneEnabled)}
			onPauseResume={paused ? resumeRecording : pauseRecording}
			onStopRecording={toggleRecording}
			onHideHud={() => window.electronAPI?.hudOverlayHide?.()}
			onCancelRecording={cancelRecording}
			formatTime={formatTime}
		/>
	);

	const idleControls = (
		<>
			{platform !== "linux" && (
				<>
					<SourcePopover
						open={sourcePopoverOpen}
						onOpenChange={(open) => handlePopoverOpenChange("sources", open)}
						screenSources={screenSources}
						windowSources={windowSources}
						selectedSource={selectedSource}
						loading={sourcesLoading}
						onSourceSelect={(source) => {
							void handleSourceSelect(source);
						}}
						onFetchSources={fetchSources}
						trigger={
							<Button
								variant="outline"
								size="lg"
								className={`${styles.electronNoDrag} group gap-2 px-3 min-w-0 max-w-[180px] rounded-[11px] font-medium text-[12px] shrink-0 border-[#2a2a34] bg-[#1a1a22] text-[#eeeef2] hover:border-[#3e3e4c] hover:bg-[#20202a] transition-all ${sourcePopoverOpen ? "border-[#3e3e4c] bg-[#20202a]" : ""}`}
								title={selectedSource}
							>
								<Monitor size={16} className="shrink-0" />
								<div className="flex-1 min-w-0 overflow-hidden">
									<div className="truncate">{selectedSource}</div>
								</div>
								<ChevronUp
									size={10}
									className={`text-[#6b6b78] ml-0.5 shrink-0 transition-transform duration-200 ${
										sourcePopoverOpen ? "" : "rotate-180"
									}`}
								/>
							</Button>
						}
					/>

					<Separator orientation="vertical" className="mx-[5px] h-6" />
				</>
			)}

			<MicPopover
				open={micPopoverOpen}
				onOpenChange={(open) => {
					if (recording) return;
					handlePopoverOpenChange("mic", open);
				}}
				systemAudioEnabled={systemAudioEnabled}
				onToggleSystemAudio={() => setSystemAudioEnabled(!systemAudioEnabled)}
				microphoneEnabled={microphoneEnabled}
				onDisableMicrophone={() => {
					setMicrophoneEnabled(false);
					setMicPopoverOpen(false);
				}}
				devices={devices}
				microphoneDeviceId={microphoneDeviceId}
				selectedDeviceId={selectedDeviceId}
				onSelectDevice={(deviceId) => {
					setMicrophoneEnabled(true);
					setSelectedDeviceId(deviceId);
					setMicrophoneDeviceId(deviceId === "default" ? undefined : deviceId);
				}}
				trigger={
					<Button
						variant="ghost"
						size="icon"
						iconSize="lg"
						title={
							microphoneEnabled
								? t("recording.disableMicrophone")
								: t("recording.enableMicrophone")
						}
						className={microphoneEnabled ? styles.ibActive : ""}
					>
						{microphoneEnabled ? <Mic size={18} /> : <MicOff size={18} />}
					</Button>
				}
			/>

			<WebcamPopover
				open={webcamPopoverOpen}
				onOpenChange={(open) => {
					if (recording) return;
					handlePopoverOpenChange("webcam", open);
				}}
				webcamEnabled={webcamEnabled}
				onDisableWebcam={() => {
					setWebcamEnabled(false);
					setWebcamPopoverOpen(false);
				}}
				canToggleFloatingPreview={canToggleFloatingWebcamPreview(
					hudOverlayMousePassthroughSupported,
				)}
				showFloatingWebcamPreview={showFloatingWebcamPreview}
				onToggleFloatingPreview={() =>
					setShowFloatingWebcamPreview((current) => !current)
				}
				showWebcamControls={showWebcamControls}
				setWebcamPreviewNode={setWebcamPreviewNode}
				videoDevices={videoDevices}
				webcamDeviceId={webcamDeviceId}
				selectedVideoDeviceId={selectedVideoDeviceId}
				onSelectVideoDevice={(deviceId) => {
					setWebcamEnabled(true);
					setSelectedVideoDeviceId(deviceId);
					setWebcamDeviceId(deviceId);
				}}
				trigger={
					<Button
						variant="ghost"
						size="icon"
						iconSize="lg"
						title={
							webcamEnabled
								? t("recording.disableWebcam")
								: t("recording.enableWebcam")
						}
						className={webcamEnabled ? styles.ibActive : ""}
					>
						{webcamEnabled ? <Video size={18} /> : <VideoOff size={18} />}
					</Button>
				}
			/>

			<CountdownPopover
				open={countdownPopoverOpen}
				onOpenChange={(open) => handlePopoverOpenChange("countdown", open)}
				countdownDelay={countdownDelay}
				onSelectDelay={(delay) => {
					setCountdownDelay(delay);
					setCountdownPopoverOpen(false);
				}}
				trigger={
					<Button
						variant="ghost"
						size="icon"
						iconSize="lg"
						title={t("recording.countdownDelay")}
						className={countdownDelay > 0 ? styles.ibActive : ""}
					>
						<Timer size={18} />
					</Button>
				}
			/>

			<Separator orientation="vertical" className="mx-[5px] h-6" />

			<button
				type="button"
				className={`${styles.recBtn} ${styles.electronNoDrag}`}
				onClick={
					hasSelectedSource || platform === "linux"
						? toggleRecording
						: () => handlePopoverOpenChange("sources", true)
				}
				disabled={countdownActive}
				title={t("recording.record")}
			>
				<div className={styles.recDot} />
			</button>

			<Separator orientation="vertical" className="mx-[5px] h-6" />

			<MorePopover
				open={morePopoverOpen}
				onOpenChange={(open) => handlePopoverOpenChange("more", open)}
				supportsHudCaptureProtection={supportsHudCaptureProtection}
				hideHudFromCapture={hideHudFromCapture}
				onToggleHudCaptureProtection={() => {
					void toggleHudCaptureProtection();
				}}
				onChooseRecordingsDirectory={() => {
					void chooseRecordingsDirectory();
				}}
				onOpenVideoFile={() => {
					void openVideoFile();
				}}
				onOpenProjectBrowser={() => {
					void openProjectBrowser();
				}}
				showDevUpdatePreview={SHOW_DEV_UPDATE_PREVIEW}
				onPreviewUpdateUi={() => {
					setMorePopoverOpen(false);
					void window.electronAPI.previewUpdateToast().catch((error) => {
						console.warn("Failed to preview update toast:", error);
					});
				}}
				appVersion={appVersion}
				trigger={
					<Button
						variant="ghost"
						size="icon"
						iconSize="lg"
						title={t("recording.more")}
					>
						<MoreVertical size={18} />
					</Button>
				}
			/>

			<Button
				variant="ghost"
				size="icon"
				iconSize="lg"
				onClick={() => window.electronAPI?.hudOverlayHide?.()}
				title={t("recording.hideHud")}
			>
				<Minus size={16} />
			</Button>

			<Button
				variant="ghost"
				size="icon"
				iconSize="lg"
				onClick={() => window.electronAPI?.hudOverlayClose?.()}
				title={t("recording.closeApp")}
			>
				<X size={16} />
			</Button>
		</>
	);

	const finalizingControls = (
		<div className={styles.finalizingState}>
			<RefreshCw size={15} className={styles.finalizingSpin} />
			<div className={styles.finalizingCopy}>
				<span>{t("recording.preparing", "Preparing recording")}</span>
				<small>{t("recording.preparingSubtitle", "Opening the editor in a moment")}</small>
			</div>
		</div>
	);

	const hudMode = finalizing ? "finalizing" : recording ? "recording" : "idle";

	return (
		<div
			className="w-full flex justify-center bg-transparent overflow-visible items-end pb-5"
			style={{ height: "100vh" }}
		>
			<div
				ref={hudContentRef}
				className="flex items-center overflow-visible flex-col-reverse"
				onMouseEnter={() => window.electronAPI?.hudOverlaySetIgnoreMouse?.(false)}
				onMouseLeave={() => {
					if (
						!isHudDraggingRef.current &&
						!isWebcamPreviewDraggingRef.current &&
						!webcamPreviewDragStartRef.current &&
						!anyPopoverOpen &&
						!projectBrowserOpen
					) {
						window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
					}
				}}
			>
				<div className="flex flex-col items-center pointer-events-auto">
					<div
						ref={hudBarTransformRef}
						style={{
							transform: `translate3d(${recordingHudOffset.x}px, ${recordingHudOffset.y}px, 0)`,
						}}
					>
						<motion.div
							ref={hudBarRef}
							layout={!showRecordingWebcamPreview && !isHudDragging}
							transition={hudStateTransition}
							className={`${styles.bar} mb-2`}
						>
							<div
								// On Linux (especially Wayland) the compositor owns window
								// placement, so BrowserWindow.setBounds() is silently ignored.
								// Fall back to a native OS drag via -webkit-app-region on the
								// handle.  We still need JS pointer handlers in webcam-preview
								// mode (which translates via CSS inside the window), so only
								// mark the handle as a native drag region for the IPC path.
								className={`flex items-center px-0.5 cursor-grab active:cursor-grabbing ${
									platform === "linux" && !showRecordingWebcamPreview
										? styles.electronDrag
										: ""
								}`}
								onPointerDown={handleHudBarPointerDown}
								onPointerMove={handleHudBarPointerMove}
								onPointerUp={handleHudBarPointerUp}
								onPointerCancel={handleHudBarPointerUp}
							>
								<RxDragHandleDots2 size={14} className="text-[#6b6b78]" />
							</div>

							<div className={styles.barStateViewport}>
								<AnimatePresence initial={false} mode="wait">
									<motion.div
										key={hudMode}
										layout={!showRecordingWebcamPreview && !isHudDragging}
										className={styles.barState}
										initial={{
											opacity: 0,
											y: 10,
											scale: 0.985,
											filter: "blur(8px)",
										}}
										animate={{
											opacity: 1,
											y: 0,
											scale: 1,
											filter: "blur(0px)",
										}}
										exit={{
											opacity: 0,
											y: -10,
											scale: 0.985,
											filter: "blur(6px)",
										}}
										transition={hudStateTransition}
									>
										{finalizing
											? finalizingControls
											: recording
												? recordingControls
												: idleControls}
									</motion.div>
								</AnimatePresence>
							</div>
						</motion.div>
					</div>
					{showRecordingWebcamPreview && (
						<div
							ref={recordingWebcamPreviewContainerRef}
							className={`${styles.recordingWebcamPreview} ${styles.electronNoDrag}`}
							title={t("recording.webcam")}
							style={{
								transform: `translate(${webcamPreviewOffset.x}px, ${webcamPreviewOffset.y}px)`,
							}}
							onPointerDown={handleWebcamPreviewPointerDown}
							onPointerMove={handleWebcamPreviewPointerMove}
							onPointerUp={handleWebcamPreviewPointerUp}
							onPointerCancel={handleWebcamPreviewPointerUp}
						>
							<video
								ref={setRecordingWebcamPreviewNode}
								className={styles.recordingWebcamPreviewVideo}
								muted
								playsInline
								style={{ transform: "scaleX(-1)" }}
							/>
						</div>
					)}
				</div>

				{projectBrowserOpen ? (
					<div className={styles.electronNoDrag}>
						<ProjectBrowserDialog
							open={projectBrowserOpen}
							onOpenChange={setProjectBrowserOpen}
							entries={projectLibraryEntries}
							renderMode="inline"
							onOpenProject={(projectPath) => {
								void openProjectFromLibrary(projectPath);
							}}
						/>
					</div>
				) : null}
			</div>
		</div>
	);
}
