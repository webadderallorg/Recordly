import {
	AppWindow,
	CaretUp as ChevronUp,
	Eye,
	EyeSlash as EyeOff,
	FolderOpen,
	Translate as Languages,
	Microphone as Mic,
	MicrophoneSlash as MicOff,
	Minus,
	Monitor,
	DotsThreeVertical as MoreVertical,
	Pause,
	Play,
	ArrowClockwise as RefreshCw,
	Stop as Square,
	Timer,
	VideoCamera as Video,
	VideoCamera as VideoIcon,
	VideoCameraSlash as VideoOff,
	SpeakerHigh as Volume2,
	SpeakerX as VolumeX,
	X,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RxDragHandleDots2 } from "react-icons/rx";
import { useI18n } from "@/contexts/I18nContext";
import type { AppLocale } from "@/i18n/config";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import { useScopedT } from "../../contexts/I18nContext";
import { useAudioLevelMeter } from "../../hooks/useAudioLevelMeter";
import { useMicrophoneDevices } from "../../hooks/useMicrophoneDevices";
import { useScreenRecorder } from "../../hooks/useScreenRecorder";
import { useVideoDevices } from "../../hooks/useVideoDevices";
import { AudioLevelMeter } from "../ui/audio-level-meter";
import { ContentClamp } from "../ui/content-clamp";
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

const LOCALE_LABELS: Record<string, string> = {
	en: "EN",
	es: "ES",
	nl: "NL",
	"zh-CN": "中文",
	ko: "한국어",
};

const COUNTDOWN_OPTIONS = [0, 3, 5, 10];
const WEBCAM_PREVIEW_DRAG_THRESHOLD = 6;
const DEFAULT_WEBCAM_PREVIEW_OFFSET = { x: 0, y: 0 };
const DEFAULT_RECORDING_HUD_OFFSET = { x: 0, y: 0 };
const SHOW_DEV_UPDATE_PREVIEW = import.meta.env.DEV;

function IconButton({
	onClick,
	title,
	className = "",
	buttonRef,
	children,
}: {
	onClick?: () => void;
	title?: string;
	className?: string;
	buttonRef?: React.Ref<HTMLButtonElement>;
	children: ReactNode;
}) {
	return (
		<button
			ref={buttonRef}
			type="button"
			className={`${styles.ib} ${styles.electronNoDrag} ${className}`}
			onClick={onClick}
			title={title}
		>
			{children}
		</button>
	);
}

function DropdownItem({
	onClick,
	selected,
	icon,
	children,
	trailing,
}: {
	onClick: () => void;
	selected?: boolean;
	icon: ReactNode;
	children: ReactNode;
	trailing?: ReactNode;
}) {
	return (
		<button
			type="button"
			className={`${styles.ddItem} ${selected ? styles.ddItemSelected : ""}`}
			onClick={onClick}
		>
			<span className="shrink-0">{icon}</span>
			<span className="truncate">{children}</span>
			{trailing}
		</button>
	);
}

function Separator({ dropdown = false }: { dropdown?: boolean }) {
	return <div className={dropdown ? styles.ddSep : styles.sep} />;
}

function MicDeviceRow({
	device,
	selected,
	onSelect,
}: {
	device: { deviceId: string; label: string };
	selected: boolean;
	onSelect: () => void;
}) {
	const { level } = useAudioLevelMeter({
		enabled: true,
		deviceId: device.deviceId,
	});

	return (
		<button
			type="button"
			className={`${styles.ddItem} ${selected ? styles.ddItemSelected : ""}`}
			onClick={onSelect}
		>
			<span className="shrink-0">{selected ? <Mic size={16} /> : <MicOff size={16} />}</span>
			<span className="truncate flex-1">{device.label}</span>
			<AudioLevelMeter level={level} className="w-16 shrink-0" />
		</button>
	);
}

export function LaunchWindow() {
	const { locale, setLocale } = useI18n();
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
	const [activeDropdown, setActiveDropdown] = useState<
		"none" | "sources" | "more" | "mic" | "countdown" | "webcam"
	>("none");
	const [projectLibraryEntries, setProjectLibraryEntries] = useState<ProjectLibraryEntry[]>([]);
	const [projectBrowserOpen, setProjectBrowserOpen] = useState(false);
	const [sources, setSources] = useState<DesktopSource[]>([]);
	const [sourcesLoading, setSourcesLoading] = useState(false);
	const [hideHudFromCapture, setHideHudFromCapture] = useState(true);
	const [showFloatingWebcamPreview, setShowFloatingWebcamPreview] = useState(true);
	const [webcamPreviewOffset, setWebcamPreviewOffset] = useState(DEFAULT_WEBCAM_PREVIEW_OFFSET);
	const [recordingHudOffset, setRecordingHudOffset] = useState(DEFAULT_RECORDING_HUD_OFFSET);
	const [hudOverlayMousePassthroughSupported, setHudOverlayMousePassthroughSupported] = useState<
		boolean | null
	>(null);
	const [platform, setPlatform] = useState<string | null>(null);
	const [appVersion, setAppVersion] = useState<string | null>(null);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const hudContentRef = useRef<HTMLDivElement>(null);
	const hudBarRef = useRef<HTMLDivElement>(null);
	const moreButtonRef = useRef<HTMLButtonElement | null>(null);
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
				mode: "webcam-preview";
				startX: number;
				startY: number;
				originX: number;
				originY: number;
				initialLeft: number;
				initialTop: number;
				hudWidth: number;
				hudHeight: number;
		  }
		| {
				pointerId: number;
				mode: "overlay";
		  }
		| null
	>(null);
	const isHudDraggingRef = useRef(false);
	const isWebcamPreviewDraggingRef = useRef(false);

	const micDropdownOpen = activeDropdown === "mic";
	const webcamDropdownOpen = activeDropdown === "webcam";
	const showWebcamControls = webcamEnabled && !recording;
	const showRecordingWebcamPreview =
		webcamEnabled &&
		canShowFloatingWebcamPreview(
			showFloatingWebcamPreview,
			hudOverlayMousePassthroughSupported,
		);
	const shouldStreamWebcamPreview =
		webcamEnabled && (showRecordingWebcamPreview || (showWebcamControls && webcamDropdownOpen));
	const { devices, selectedDeviceId, setSelectedDeviceId } = useMicrophoneDevices(
		microphoneEnabled || micDropdownOpen,
		microphoneDeviceId,
	);
	const {
		devices: videoDevices,
		selectedDeviceId: selectedVideoDeviceId,
		setSelectedDeviceId: setSelectedVideoDeviceId,
	} = useVideoDevices(webcamEnabled || webcamDropdownOpen);

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
			setRecordingHudOffset(DEFAULT_RECORDING_HUD_OFFSET);
			webcamPreviewDragStartRef.current = null;
			isWebcamPreviewDraggingRef.current = false;
			setShowFloatingWebcamPreview(true);
		}
	}, [webcamEnabled]);

	useEffect(() => {
		if (!showRecordingWebcamPreview) {
			setRecordingHudOffset(DEFAULT_RECORDING_HUD_OFFSET);
		}
	}, [showRecordingWebcamPreview]);

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
		window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);

		if (showRecordingWebcamPreview && hudBarRef.current) {
			const hudRect = hudBarRef.current.getBoundingClientRect();
			hudDragStartRef.current = {
				pointerId: event.pointerId,
				mode: "webcam-preview",
				startX: event.clientX,
				startY: event.clientY,
				originX: recordingHudOffset.x,
				originY: recordingHudOffset.y,
				initialLeft: hudRect.left,
				initialTop: hudRect.top,
				hudWidth: hudRect.width,
				hudHeight: hudRect.height,
			};
			return;
		}

		hudDragStartRef.current = {
			pointerId: event.pointerId,
			mode: "overlay",
		};
		window.electronAPI?.hudOverlayDrag?.("start", event.screenX, event.screenY);
	};

	const handleHudBarPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const dragState = hudDragStartRef.current;
		if (!dragState || dragState.pointerId !== event.pointerId) {
			return;
		}

		if (dragState.mode === "webcam-preview") {
			const deltaX = event.clientX - dragState.startX;
			const deltaY = event.clientY - dragState.startY;
			const viewportWidth = Math.max(window.innerWidth, window.screen?.width ?? 0);
			const viewportHeight = Math.max(window.innerHeight, window.screen?.height ?? 0);
			const unclampedLeft = dragState.initialLeft + deltaX;
			const unclampedTop = dragState.initialTop + deltaY;
			const clampedLeft = Math.min(
				Math.max(0, unclampedLeft),
				Math.max(0, viewportWidth - dragState.hudWidth),
			);
			const clampedTop = Math.min(
				Math.max(0, unclampedTop),
				Math.max(0, viewportHeight - dragState.hudHeight),
			);

			setRecordingHudOffset({
				x: dragState.originX + (clampedLeft - dragState.initialLeft),
				y: dragState.originY + (clampedTop - dragState.initialTop),
			});
			return;
		}

		window.electronAPI?.hudOverlayDrag?.("move", event.screenX, event.screenY);
	};

	const handleHudBarPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
		const dragState = hudDragStartRef.current;
		if (!dragState || dragState.pointerId !== event.pointerId) {
			return;
		}

		if (dragState.mode === "overlay") {
			window.electronAPI?.hudOverlayDrag?.("end", 0, 0);
		}

		hudDragStartRef.current = null;
		const wasDragging = isHudDraggingRef.current;
		isHudDraggingRef.current = false;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		const hudBounds = mergeHudInteractiveBounds(
			[
				dropdownRef.current?.getBoundingClientRect(),
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

	useEffect(() => {
		const expanded =
			activeDropdown !== "none" || projectBrowserOpen || showRecordingWebcamPreview;
		window.electronAPI.setHudOverlayExpanded(expanded);

		return () => {
			window.electronAPI.setHudOverlayExpanded(false);
		};
	}, [activeDropdown, projectBrowserOpen, showRecordingWebcamPreview]);

	const reportHudSize = useCallback(() => {
		const hudContent = hudContentRef.current;
		const hudBar = hudBarRef.current;
		if (!hudContent || !hudBar) {
			return;
		}

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
	}, [activeDropdown, projectBrowserOpen, showRecordingWebcamPreview]);

	useEffect(() => {
		const hudContent = hudContentRef.current;
		const hudBar = hudBarRef.current;
		const previewContainer = recordingWebcamPreviewContainerRef.current;
		if (!hudContent || !hudBar || typeof ResizeObserver === "undefined") {
			return;
		}

		let frameId = 0;
		const scheduleHudSizeReport = () => {
			if (frameId !== 0) {
				cancelAnimationFrame(frameId);
			}
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
		if (previewContainer) {
			resizeObserver.observe(previewContainer);
		}

		return () => {
			resizeObserver.disconnect();
			if (frameId !== 0) {
				cancelAnimationFrame(frameId);
			}
		};
	}, [reportHudSize]);

	useEffect(() => {
		const handleClick = (e: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
				setActiveDropdown("none");
				setProjectBrowserOpen(false);
			}
		};
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
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

	const toggleDropdown = (which: "sources" | "more" | "mic" | "countdown" | "webcam") => {
		setProjectBrowserOpen(false);
		setActiveDropdown(activeDropdown === which ? "none" : which);
		if (activeDropdown !== which && which === "sources") fetchSources();
	};

	const handleSourceSelect = async (source: DesktopSource) => {
		await window.electronAPI.selectSource(source);
		setSelectedSource(source.name);
		setHasSelectedSource(true);
		setActiveDropdown("none");
		window.electronAPI.showSourceHighlight?.({
			...source,
			name: source.appName ? `${source.appName} — ${source.name}` : source.name,
			appName: source.appName,
		});
	};

	const openVideoFile = async () => {
		setActiveDropdown("none");
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

		setActiveDropdown("none");
		await refreshProjectLibrary();
		setProjectBrowserOpen(true);
	}, [projectBrowserOpen, refreshProjectLibrary]);

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
		setActiveDropdown("none");
		const result = await window.electronAPI.chooseRecordingsDirectory();
		if (result.canceled) return;
		if (result.success && result.path) setRecordingsDirectory(result.path);
	};

	const toggleMicrophone = () => {
		if (recording) return;
		toggleDropdown("mic");
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

	const screenSources = sources.filter((s) => s.sourceType === "screen");
	const windowSources = sources.filter((s) => s.sourceType === "window");
	const hudStateTransition = {
		duration: 0.24,
		ease: [0.22, 1, 0.36, 1] as const,
	};

	const toggleWebcam = () => {
		if (recording) return;
		toggleDropdown("webcam");
	};

	const recordingControls = (
		<>
			<div className="flex items-center gap-[5px]">
				<div
					className={`w-[7px] h-[7px] rounded-full ${paused ? "bg-[#fbbf24]" : `bg-[#f43f5e] ${styles.recDotBlink}`}`}
				/>
				<span
					className={`text-[10px] font-bold tracking-[0.06em] ${paused ? "text-[#fbbf24]" : "text-[#f43f5e]"}`}
				>
					{paused ? t("recording.paused") : t("recording.rec")}
				</span>
			</div>

			<span
				className={`font-mono text-xs font-semibold min-w-[52px] text-center tracking-[0.02em] ${paused ? "text-[#fbbf24]" : "text-[#eeeef2]"}`}
			>
				{formatTime(elapsed)}
			</span>

			<Separator />

			<IconButton
				title={
					microphoneEnabled
						? t("recording.disableMicrophone")
						: t("recording.enableMicrophone")
				}
				className={microphoneEnabled ? styles.ibActive : ""}
			>
				{microphoneEnabled ? <Mic size={18} /> : <MicOff size={18} />}
			</IconButton>

			<Separator />

			<IconButton
				onClick={paused ? resumeRecording : pauseRecording}
				title={paused ? t("recording.resume") : t("recording.pause")}
				className={paused ? styles.ibGreen : ""}
			>
				{paused ? (
					<Play size={18} fill="currentColor" strokeWidth={0} />
				) : (
					<Pause size={18} />
				)}
			</IconButton>

			<IconButton
				onClick={toggleRecording}
				title={t("recording.stop")}
				className={styles.ibRed}
			>
				<Square size={16} fill="currentColor" strokeWidth={0} />
			</IconButton>

			<IconButton
				onClick={() => window.electronAPI?.hudOverlayHide?.()}
				title={t("recording.hideHud")}
			>
				<Minus size={16} />
			</IconButton>

			<IconButton onClick={cancelRecording} title={t("recording.cancel")}>
				<X size={18} />
			</IconButton>
		</>
	);

	const idleControls = (
		<>
			{platform !== "linux" && (
				<>
					<button
						type="button"
						className={`${styles.screenSel} ${styles.electronNoDrag}`}
						onClick={() => toggleDropdown("sources")}
						title={selectedSource}
					>
						<Monitor size={16} />
						<ContentClamp className={styles.sourceLabel} truncateLength={36}>
							{selectedSource}
						</ContentClamp>
						<ChevronUp
							size={10}
							className={`text-[#6b6b78] ml-0.5 transition-transform duration-200 ${activeDropdown === "sources" ? "" : "rotate-180"}`}
						/>
					</button>

					<Separator />
				</>
			)}

			<IconButton
				onClick={toggleMicrophone}
				title={
					microphoneEnabled
						? t("recording.disableMicrophone")
						: t("recording.enableMicrophone")
				}
				className={microphoneEnabled ? styles.ibActive : ""}
			>
				{microphoneEnabled ? <Mic size={18} /> : <MicOff size={18} />}
			</IconButton>

			<IconButton
				onClick={toggleWebcam}
				title={webcamEnabled ? t("recording.disableWebcam") : t("recording.enableWebcam")}
				className={webcamEnabled ? styles.ibActive : ""}
			>
				{webcamEnabled ? <Video size={18} /> : <VideoOff size={18} />}
			</IconButton>

			<IconButton
				onClick={() => toggleDropdown("countdown")}
				title={t("recording.countdownDelay")}
				className={countdownDelay > 0 ? styles.ibActive : ""}
			>
				<Timer size={18} />
			</IconButton>

			<Separator />

			<button
				type="button"
				className={`${styles.recBtn} ${styles.electronNoDrag}`}
				onClick={
					hasSelectedSource || platform === "linux"
						? toggleRecording
						: () => toggleDropdown("sources")
				}
				disabled={countdownActive}
				title={t("recording.record")}
			>
				<div className={styles.recDot} />
			</button>

			<Separator />

			<IconButton
				buttonRef={moreButtonRef}
				onClick={() => toggleDropdown("more")}
				title={t("recording.more")}
			>
				<MoreVertical size={18} />
			</IconButton>

			<IconButton
				onClick={() => window.electronAPI?.hudOverlayHide?.()}
				title={t("recording.hideHud")}
			>
				<Minus size={16} />
			</IconButton>

			<IconButton
				onClick={() => window.electronAPI?.hudOverlayClose?.()}
				title={t("recording.closeApp")}
			>
				<X size={16} />
			</IconButton>
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
			className="w-full flex items-end justify-center bg-transparent overflow-visible pb-5"
			style={{ height: "100vh" }}
		>
			<div
				ref={hudContentRef}
				className="flex flex-col items-center overflow-visible"
				onMouseEnter={() => window.electronAPI?.hudOverlaySetIgnoreMouse?.(false)}
				onMouseLeave={() => {
					if (
						!isHudDraggingRef.current &&
						!isWebcamPreviewDraggingRef.current &&
						!webcamPreviewDragStartRef.current
					) {
						window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
					}
				}}
			>
				{/* Only the visible HUD content should become interactive. */}
				<div
					className={styles.menuArea}
					ref={dropdownRef}
					style={{
						transform: `translate(${recordingHudOffset.x}px, ${recordingHudOffset.y}px)`,
					}}
				>
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
					{activeDropdown !== "none" && (
						<div className={`${styles.menuCard} ${styles.electronNoDrag}`}>
							{activeDropdown === "sources" && (
								<>
									{sourcesLoading ? (
										<div className="flex items-center justify-center py-6">
											<div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#6b6b78]" />
										</div>
									) : (
										<>
											{screenSources.length > 0 && (
												<>
													<div className={styles.ddLabel}>
														{t("recording.screens")}
													</div>
													{screenSources.map((source) => (
														<DropdownItem
															key={source.id}
															icon={<Monitor size={16} />}
															selected={
																selectedSource === source.name
															}
															onClick={() =>
																handleSourceSelect(source)
															}
														>
															{source.name}
														</DropdownItem>
													))}
												</>
											)}
											{windowSources.length > 0 && (
												<>
													<div
														className={styles.ddLabel}
														style={
															screenSources.length > 0
																? {
																		marginTop: 4,
																	}
																: undefined
														}
													>
														{t("recording.windows")}
													</div>
													{windowSources.map((source) => (
														<DropdownItem
															key={source.id}
															icon={<AppWindow size={16} />}
															selected={
																selectedSource === source.name
															}
															onClick={() =>
																handleSourceSelect(source)
															}
														>
															{source.appName &&
															source.appName !== source.name
																? `${source.appName} — ${source.name}`
																: source.name}
														</DropdownItem>
													))}
												</>
											)}
											{screenSources.length === 0 &&
												windowSources.length === 0 && (
													<div className="text-center text-xs text-[#6b6b78] py-4">
														{t("recording.noSourcesFound")}
													</div>
												)}
										</>
									)}
								</>
							)}

							{activeDropdown === "mic" && (
								<>
									<div className={styles.ddLabel}>
										{t("recording.microphone")}
									</div>
									<DropdownItem
										icon={
											systemAudioEnabled ? (
												<Volume2 size={16} />
											) : (
												<VolumeX size={16} />
											)
										}
										selected={systemAudioEnabled}
										onClick={() => {
											setSystemAudioEnabled(!systemAudioEnabled);
										}}
									>
										{systemAudioEnabled
											? t("recording.disableSystemAudio")
											: t("recording.enableSystemAudio")}
									</DropdownItem>
									{microphoneEnabled && (
										<DropdownItem
											icon={<MicOff size={16} />}
											onClick={() => {
												setMicrophoneEnabled(false);
												setActiveDropdown("none");
											}}
										>
											{t("recording.turnOffMicrophone")}
										</DropdownItem>
									)}
									{!microphoneEnabled && (
										<div className="px-3 py-2 text-xs text-[#6b6b78]">
											{t("recording.selectMicToEnable")}
										</div>
									)}
									{devices.map((device) => (
										<MicDeviceRow
											key={device.deviceId}
											device={device}
											selected={
												microphoneEnabled &&
												(microphoneDeviceId === device.deviceId ||
													selectedDeviceId === device.deviceId)
											}
											onSelect={() => {
												setMicrophoneEnabled(true);
												setSelectedDeviceId(device.deviceId);
												setMicrophoneDeviceId(
													device.deviceId === "default"
														? undefined
														: device.deviceId,
												);
											}}
										/>
									))}
									{devices.length === 0 && (
										<div className="text-center text-xs text-[#6b6b78] py-4">
											{t("recording.noMicrophonesFound")}
										</div>
									)}
								</>
							)}

							{activeDropdown === "webcam" && (
								<>
									<div className={styles.ddLabel}>{t("recording.webcam")}</div>
									{webcamEnabled && (
										<>
											<DropdownItem
												icon={<VideoOff size={16} />}
												onClick={() => {
													setWebcamEnabled(false);
													setActiveDropdown("none");
												}}
											>
												{t("recording.turnOffWebcam")}
											</DropdownItem>
											{canToggleFloatingWebcamPreview(
												hudOverlayMousePassthroughSupported,
											) ? (
												<DropdownItem
													icon={
														showFloatingWebcamPreview ? (
															<EyeOff size={16} />
														) : (
															<Eye size={16} />
														)
													}
													selected={showFloatingWebcamPreview}
													onClick={() => {
														setShowFloatingWebcamPreview(
															(current) => !current,
														);
													}}
												>
													{showFloatingWebcamPreview
														? t("recording.hideFloatingWebcamPreview")
														: t("recording.showFloatingWebcamPreview")}
												</DropdownItem>
											) : null}
										</>
									)}
									{!webcamEnabled && (
										<div className="px-3 py-2 text-xs text-[#6b6b78]">
											{t("recording.selectWebcamToEnable")}
										</div>
									)}
									{showWebcamControls && (
										<div className="flex justify-center px-3 py-2">
											<div className="h-24 w-24 overflow-hidden rounded-2xl bg-white/5 ring-1 ring-white/10">
												<video
													ref={setWebcamPreviewNode}
													className="h-full w-full object-cover"
													muted
													playsInline
													style={{
														transform: "scaleX(-1)",
													}}
												/>
											</div>
										</div>
									)}
									{videoDevices.map((device) => (
										<DropdownItem
											key={device.deviceId}
											icon={
												webcamEnabled &&
												(webcamDeviceId === device.deviceId ||
													selectedVideoDeviceId === device.deviceId) ? (
													<Video size={16} />
												) : (
													<VideoOff size={16} />
												)
											}
											selected={
												webcamEnabled &&
												(webcamDeviceId === device.deviceId ||
													selectedVideoDeviceId === device.deviceId)
											}
											onClick={() => {
												setWebcamEnabled(true);
												setSelectedVideoDeviceId(device.deviceId);
												setWebcamDeviceId(device.deviceId);
											}}
										>
											{device.label}
										</DropdownItem>
									))}
									{videoDevices.length === 0 && (
										<div className="text-center text-xs text-[#6b6b78] py-4">
											{t("recording.noWebcamsFound")}
										</div>
									)}
								</>
							)}

							{activeDropdown === "countdown" && (
								<>
									<div className={styles.ddLabel}>
										{t("recording.countdownDelay")}
									</div>
									{COUNTDOWN_OPTIONS.map((delay) => (
										<DropdownItem
											key={delay}
											icon={<Timer size={16} />}
											selected={countdownDelay === delay}
											onClick={() => {
												setCountdownDelay(delay);
												setActiveDropdown("none");
											}}
										>
											{delay === 0 ? t("recording.noDelay") : `${delay}s`}
										</DropdownItem>
									))}
								</>
							)}

							{activeDropdown === "more" && (
								<>
									{supportsHudCaptureProtection && (
										<DropdownItem
											icon={
												hideHudFromCapture ? (
													<EyeOff size={16} />
												) : (
													<Eye size={16} />
												)
											}
											selected={hideHudFromCapture}
											onClick={() => {
												void toggleHudCaptureProtection();
											}}
										>
											{hideHudFromCapture
												? t("recording.hideHudFromVideo")
												: t("recording.showHudInVideo")}
										</DropdownItem>
									)}
									<DropdownItem
										icon={<FolderOpen size={16} />}
										onClick={chooseRecordingsDirectory}
									>
										{t("recording.recordingsFolder")}
									</DropdownItem>
									<DropdownItem
										icon={<VideoIcon size={16} />}
										onClick={openVideoFile}
									>
										{t("recording.openVideoFile")}
									</DropdownItem>
									<DropdownItem
										icon={<FolderOpen size={16} />}
										onClick={() => void openProjectBrowser()}
									>
										{t("recording.openProject")}
									</DropdownItem>
									{SHOW_DEV_UPDATE_PREVIEW ? (
										<DropdownItem
											icon={<RefreshCw size={16} />}
											onClick={() => {
												setActiveDropdown("none");
												void window.electronAPI
													.previewUpdateToast()
													.catch((error) => {
														console.warn(
															"Failed to preview update toast:",
															error,
														);
													});
											}}
										>
											{t("recording.previewUpdateUi", "Preview Update UI")}
										</DropdownItem>
									) : null}
									<div className={styles.ddLabel} style={{ marginTop: 4 }}>
										{t("recording.language")}
									</div>
									{SUPPORTED_LOCALES.map((code) => (
										<DropdownItem
											key={code}
											icon={<Languages size={16} />}
											selected={locale === code}
											onClick={() => {
												setLocale(code as AppLocale);
												setActiveDropdown("none");
											}}
										>
											{LOCALE_LABELS[code] ?? code}
										</DropdownItem>
									))}
									{appVersion && (
										<div
											style={{
												marginTop: 8,
												padding: "4px 12px",
												fontSize: 11,
												color: "#6b6b78",
												textAlign: "center",
												userSelect: "text",
											}}
										>
											v{appVersion}
										</div>
									)}
								</>
							)}
						</div>
					)}
				</div>

				<div className="flex flex-col items-center pointer-events-auto">
					<div
						style={{
							transform: `translate(${recordingHudOffset.x}px, ${recordingHudOffset.y}px)`,
						}}
					>
						<motion.div
							ref={hudBarRef}
							layout={!showRecordingWebcamPreview}
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
										layout={!showRecordingWebcamPreview}
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
			</div>
		</div>
	);
}
