import {
	AppWindow,
	ArrowUpCircle,
	ChevronUp,
	CheckCircle2,
	Crop,
	Eye,
	EyeOff,
	FolderOpen,
	Languages,
	Mic,
	MicOff,
	Minus,
	Monitor,
	MoreVertical,
	Pause,
	Play,
	RefreshCw,
	Square,
	Timer,
	Video,
	VideoIcon,
	VideoOff,
	Volume2,
	VolumeX,
	X,
} from "lucide-react";
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
	"zh-CN": "中文",
};

const COUNTDOWN_OPTIONS = [0, 3, 5, 10];

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
	const [selectedSource, setSelectedSource] = useState<any>({ name: "Screen" });
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
	const [platform, setPlatform] = useState<string | null>(null);
	const [appVersion, setAppVersion] = useState<string | null>(null);
	const [updateStatus, setUpdateStatus] = useState<{
		status: "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error";
		currentVersion: string;
		availableVersion: string | null;
		detail?: string;
	}>({
		status: "idle",
		currentVersion: "",
		availableVersion: null,
	});
	const [updateActionPending, setUpdateActionPending] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const hudContentRef = useRef<HTMLDivElement>(null);
	const hudBarRef = useRef<HTMLDivElement>(null);
	const moreButtonRef = useRef<HTMLButtonElement | null>(null);
	const webcamPreviewRef = useRef<HTMLVideoElement | null>(null);
	const isDraggingRef = useRef(false);
	// Tracks the last real (non-area) screen source so we can revert from area mode
	const lastScreenSourceRef = useRef<any>(null);

	const micDropdownOpen = activeDropdown === "mic";
	const webcamDropdownOpen = activeDropdown === "webcam";
	const showWebcamControls = webcamEnabled && !recording;
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
		let mounted = true;
		let previewStream: MediaStream | null = null;

		const startPreview = async () => {
			if (!showWebcamControls || !webcamPreviewRef.current) {
				return;
			}

			try {
				previewStream = await navigator.mediaDevices.getUserMedia({
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

				if (!mounted || !webcamPreviewRef.current) {
					previewStream.getTracks().forEach((track) => track.stop());
					return;
				}

				webcamPreviewRef.current.srcObject = previewStream;
				const playPromise = webcamPreviewRef.current.play();
				if (playPromise) {
					playPromise.catch(() => {
						// Ignore autoplay interruptions while the preview element mounts.
					});
				}
			} catch (error) {
				console.warn("Failed to start live webcam preview:", error);
			}
		};

		void startPreview();

		return () => {
			mounted = false;
			if (webcamPreviewRef.current) {
				webcamPreviewRef.current.pause();
				webcamPreviewRef.current.srcObject = null;
			}
			previewStream?.getTracks().forEach((track) => track.stop());
		};
	}, [showWebcamControls, webcamDeviceId]);

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

		const applySelectedSource = (source: any | null | undefined) => {
			if (!mounted) {
				return;
			}

			if (source?.name) {
				setSelectedSource(source);
				setHasSelectedSource(true);
				// Keep lastScreenSourceRef up-to-date so area mode can find its parent screen
				if (source?.id?.startsWith('screen:')) {
					lastScreenSourceRef.current = source;
				}
				return;
			}

			setSelectedSource({ name: "Screen" });
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
		void preparePermissions({ startup: true });
	}, [preparePermissions]);

	useEffect(() => {
		let mounted = true;

		const refreshUpdateStatus = async () => {
			try {
				const summary = await window.electronAPI.getUpdateStatusSummary();
				if (mounted) {
					setUpdateStatus(summary);
				}
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
		const expanded = activeDropdown !== "none" || projectBrowserOpen;
		window.electronAPI.setHudOverlayExpanded(expanded);

		return () => {
			window.electronAPI.setHudOverlayExpanded(false);
		};
	}, [activeDropdown, projectBrowserOpen]);

	useEffect(() => {
		const hudContent = hudContentRef.current;
		const hudBar = hudBarRef.current;
		if (!hudContent || !hudBar || typeof ResizeObserver === "undefined") {
			return;
		}

		let frameId = 0;
		const reportHudSize = () => {
			frameId = 0;
			const measuredWidth = Math.ceil(
				Math.max(
					hudBar.getBoundingClientRect().width,
					hudBar.scrollWidth,
					hudContent.getBoundingClientRect().width,
					hudContent.scrollWidth,
				) + 24,
			);
			const measuredHeight = Math.ceil(
				Math.max(hudContent.getBoundingClientRect().height, hudContent.scrollHeight) + 24,
			);
			window.electronAPI.setHudOverlayCompactWidth(measuredWidth);
			window.electronAPI.setHudOverlayMeasuredHeight(
				measuredHeight,
				activeDropdown !== "none" || projectBrowserOpen,
			);
		};

		const scheduleHudSizeReport = () => {
			if (frameId !== 0) {
				cancelAnimationFrame(frameId);
			}
			frameId = requestAnimationFrame(reportHudSize);
		};

		scheduleHudSizeReport();

		const resizeObserver = new ResizeObserver(() => {
			scheduleHudSizeReport();
		});
		resizeObserver.observe(hudContent);
		resizeObserver.observe(hudBar);

		return () => {
			resizeObserver.disconnect();
			if (frameId !== 0) {
				cancelAnimationFrame(frameId);
			}
		};
	}, [activeDropdown, projectBrowserOpen]);

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
		// Store as full object for consistent type throughout the component
		setSelectedSource(source);
		if (source.id?.startsWith('screen:')) {
			lastScreenSourceRef.current = source;
		}
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

	const isAreaSelected = selectedSource.id === "area:custom";
	const screenSources = sources.filter((s) => s.sourceType === "screen");
	const windowSources = sources.filter((s) => s.sourceType === "window");
	const hudStateTransition = { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const };

	const toggleWebcam = () => {
		if (recording) return;
		toggleDropdown("webcam");
	};

	const updateButtonLabel =
		updateStatus.status === "up-to-date"
			? t("recording.update.updated")
			: t("recording.update.update");
	const updateButtonTitle = (() => {
		switch (updateStatus.status) {
			case "up-to-date":
				return t("recording.update.upToDateTitle", "Recordly {{version}} is up to date.", {
					version: updateStatus.currentVersion,
				});
			case "available":
			case "ready":
				return updateStatus.availableVersion
					? t("recording.update.availableTitle", "Recordly {{version}} is available.", {
						version: updateStatus.availableVersion,
					})
					: t("recording.update.availableGenericTitle");
			case "downloading":
				return updateStatus.detail ?? t("recording.update.downloadingTitle");
			case "checking":
				return t("recording.update.checkingTitle");
			case "error":
				return updateStatus.detail ?? t("recording.update.errorTitle");
			default:
				return t("recording.update.idleTitle");
		}
	})();
	const updateButtonClassName = `${styles.updateBadge} ${updateStatus.status === "up-to-date" ? styles.updateBadgeQuiet : styles.updateBadgeHot} ${styles.electronNoDrag}`;
	const updateButtonIcon = (() => {
		switch (updateStatus.status) {
			case "up-to-date":
				return <CheckCircle2 size={14} />;
			case "checking":
			case "downloading":
				return <RefreshCw size={14} className={styles.updateBadgeSpin} />;
			default:
				return <ArrowUpCircle size={14} />;
		}
	})();

	const handleUpdateButtonClick = async () => {
		if (updateActionPending || updateStatus.status === "downloading") {
			return;
		}

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
					microphoneEnabled ? t("recording.disableMicrophone") : t("recording.enableMicrophone")
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
				{paused ? <Play size={18} fill="currentColor" strokeWidth={0} /> : <Pause size={18} />}
			</IconButton>

			<IconButton onClick={toggleRecording} title={t("recording.stop")} className={styles.ibRed}>
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
			<button
				type="button"
				className={`${styles.screenSel} ${styles.electronNoDrag}`}
				onClick={() => toggleDropdown("sources")}
				title={selectedSource.name}
				style={selectedSource.id === "area:custom" ? {
					border: '1px solid rgba(37,99,235,0.5)',
					boxShadow: '0 0 15px rgba(37,99,235,0.2)',
					background: 'rgba(37,99,235,0.08)'
				} : {}}
			>
				{selectedSource.id === "area:custom" ? (
					<div className="relative">
						<Video size={16} className="text-blue-400" />
						<div className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
					</div>
				) : (
					<Monitor size={16} />
				)}
				<ContentClamp className={styles.sourceLabel} truncateLength={36}>
					{selectedSource.name}
				</ContentClamp>
				{selectedSource.id === "area:custom" && (
					<span className="text-[9px] font-black bg-blue-600 text-white px-1 rounded ml-1 scale-90">CROP</span>
				)}
				<ChevronUp
					size={10}
					className={`text-[#6b6b78] ml-0.5 transition-transform duration-200 ${activeDropdown === "sources" ? "" : "rotate-180"}`}
				/>
			</button>

			<Separator />

			<IconButton
				onClick={toggleMicrophone}
				title={
					microphoneEnabled ? t("recording.disableMicrophone") : t("recording.enableMicrophone")
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
				onClick={hasSelectedSource ? toggleRecording : () => toggleDropdown("sources")}
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

	return (
		<div
			className="w-full flex items-end justify-center bg-transparent overflow-visible pb-5"
			style={{ height: "100vh" }}
			ref={dropdownRef}
		>
			<div
				ref={hudContentRef}
				className="flex flex-col items-center overflow-visible"
				onMouseEnter={() => window.electronAPI?.hudOverlaySetIgnoreMouse?.(false)}
				onMouseLeave={() => {
					if (!isDraggingRef.current) {
						window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
					}
				}}
			>
				{/* Only the visible HUD content should become interactive. */}
				<div className={styles.menuArea}>
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
											{/* Quick Mode Switcher */}
											<div className="flex flex-col shrink-0">
												<div className={styles.ddLabel} style={{ paddingBottom: 6 }}>Recording Mode</div>
												<div className="px-3 pb-2">
													<div className="flex items-center gap-1 p-1 bg-black/40 rounded-xl border border-white/5 shadow-inner">
														<button
															onClick={() => {
																// Revert to the last real screen source (or current if already full)
																const target = isAreaSelected
																	? (lastScreenSourceRef.current || sources.find(s => s.id?.startsWith('screen:')))
																	: selectedSource;
																if (target?.id && !target.id.startsWith('area:')) {
																	window.electronAPI.selectSource(target);
																	setActiveDropdown('none');
																}
															}}
															className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-[9px] text-[10px] font-bold tracking-wider uppercase transition-all duration-200 ${
																!isAreaSelected 
																? 'bg-[#6360f5] text-white shadow-[0_2px_8px_rgba(99,96,245,0.4)]' 
																: 'text-[#6b6b78] hover:text-[#eeeef2] hover:bg-white/5'
															}`}
														>
															<Monitor size={12} strokeWidth={2.5} />
															Full
														</button>
														<button
															onClick={() => {
																// Use the actual screen display_id — from current source or last screen
																const screenSrc = isAreaSelected
																	? (lastScreenSourceRef.current || sources.find(s => s.id?.startsWith('screen:')))
																	: selectedSource;
																window.electronAPI.openAreaSelector({ displayId: screenSrc?.display_id });
																setActiveDropdown('none');
															}}
															className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-[9px] text-[10px] font-bold tracking-wider uppercase transition-all duration-200 ${
																isAreaSelected 
																? 'bg-[#6360f5] text-white shadow-[0_2px_8px_rgba(99,96,245,0.4)]' 
																: 'text-[#6b6b78] hover:text-[#eeeef2] hover:bg-white/5'
															}`}
														>
															<Crop size={12} strokeWidth={2.5} />
															Area
														</button>
													</div>
												</div>
											</div>
											<div className="h-[1px] bg-white/5 mx-3 mb-1" />

											{screenSources.length > 0 && (
												<>
													<div className={styles.ddLabel}>{t("recording.screens")}</div>
													{screenSources.map((source) => {
														const isAreaMode = selectedSource?.id?.startsWith('area:');
														const isParentScreen = isAreaMode && lastScreenSourceRef.current?.id === source.id;
														return (
														<DropdownItem
															key={source.id}
															icon={<Monitor size={16} />}
															selected={selectedSource?.id === source.id || isParentScreen}
															onClick={() => handleSourceSelect(source)}
														>
															{source.name}
														</DropdownItem>
														);
													})}
												</>
											)}
											{windowSources.length > 0 && (
												<>
													<div
														className={styles.ddLabel}
														style={screenSources.length > 0 ? { marginTop: 4 } : undefined}
													>
														{t("recording.windows")}
													</div>
													{windowSources.map((source) => (
														<DropdownItem
															key={source.id}
															icon={<AppWindow size={16} />}
															selected={selectedSource?.id === source.id}
															onClick={() => handleSourceSelect(source)}
														>
															{source.appName && source.appName !== source.name
																? `${source.appName} — ${source.name}`
																: source.name}
														</DropdownItem>
													))}
												</>
											)}
											{screenSources.length === 0 && windowSources.length === 0 && (
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
									<div className={styles.ddLabel}>{t("recording.microphone")}</div>
									<DropdownItem
										icon={systemAudioEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
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
													device.deviceId === "default" ? undefined : device.deviceId,
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
										<DropdownItem
											icon={<VideoOff size={16} />}
											onClick={() => {
												setWebcamEnabled(false);
												setActiveDropdown("none");
											}}
										>
											{t("recording.turnOffWebcam")}
										</DropdownItem>
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
													ref={webcamPreviewRef}
													className="h-full w-full object-cover"
													muted
													playsInline
													style={{ transform: "scaleX(-1)" }}
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
									<div className={styles.ddLabel}>{t("recording.countdownDelay")}</div>
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
											icon={hideHudFromCapture ? <EyeOff size={16} /> : <Eye size={16} />}
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
									<DropdownItem icon={<FolderOpen size={16} />} onClick={chooseRecordingsDirectory}>
										{t("recording.recordingsFolder")}
									</DropdownItem>
									<DropdownItem icon={<VideoIcon size={16} />} onClick={openVideoFile}>
										{t("recording.openVideoFile")}
									</DropdownItem>
									<DropdownItem
										icon={<FolderOpen size={16} />}
										onClick={() => void openProjectBrowser()}
									>
										{t("recording.openProject")}
									</DropdownItem>
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
					<motion.div
						ref={hudBarRef}
						layout
						transition={hudStateTransition}
						className={`${styles.bar} mb-2`}
					>
						<div
							className="flex items-center px-0.5 cursor-grab active:cursor-grabbing"
							onMouseDown={(e) => {
								e.preventDefault();
								isDraggingRef.current = true;
								window.electronAPI?.hudOverlayDrag?.("start", e.screenX, e.screenY);
								const handleMove = (ev: MouseEvent) => {
									window.electronAPI?.hudOverlayDrag?.("move", ev.screenX, ev.screenY);
								};
								const handleUp = () => {
									isDraggingRef.current = false;
									window.electronAPI?.hudOverlayDrag?.("end", 0, 0);
									document.removeEventListener("mousemove", handleMove);
									document.removeEventListener("mouseup", handleUp);
								};
								document.addEventListener("mousemove", handleMove);
								document.addEventListener("mouseup", handleUp);
							}}
						>
							<RxDragHandleDots2 size={14} className="text-[#6b6b78]" />
						</div>

						<button
							type="button"
							onClick={() => {
								void handleUpdateButtonClick();
							}}
							className={updateButtonClassName}
							title={updateButtonTitle}
							disabled={updateActionPending}
						>
							{updateButtonIcon}
							<span>{updateButtonLabel}</span>
						</button>

						<div className={styles.barStateViewport}>
							<AnimatePresence initial={false} mode="wait">
								<motion.div
									key={recording ? "recording" : "idle"}
									layout
									className={styles.barState}
									initial={{ opacity: 0, y: 10, scale: 0.985, filter: "blur(8px)" }}
									animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
									exit={{ opacity: 0, y: -10, scale: 0.985, filter: "blur(6px)" }}
									transition={hudStateTransition}
								>
									{recording ? recordingControls : idleControls}
								</motion.div>
							</AnimatePresence>
						</div>
					</motion.div>
				</div>
			</div>
		</div>
	);
}
