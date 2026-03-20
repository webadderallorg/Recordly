import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
	Monitor,
	Mic,
	MicOff,
	ChevronUp,
	Pause,
	Square,
	X,
	Play,
	Minus,
	MoreVertical,
	FolderOpen,
	VideoIcon,
	Languages,
	Volume2,
	VolumeX,
	AppWindow,
	Eye,
	EyeOff,
	Timer,
	Video,
	VideoOff,
} from "lucide-react";
import { RxDragHandleDots2 } from "react-icons/rx";
import { useAudioLevelMeter } from "../../hooks/useAudioLevelMeter";
import { useMicrophoneDevices } from "../../hooks/useMicrophoneDevices";
import { useScreenRecorder } from "../../hooks/useScreenRecorder";
import { useScopedT } from "../../contexts/I18nContext";
import { useVideoDevices } from "../../hooks/useVideoDevices";
import { AudioLevelMeter } from "../ui/audio-level-meter";
import { ContentClamp } from "../ui/content-clamp";
import { useI18n } from "@/contexts/I18nContext";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import type { AppLocale } from "@/i18n/config";
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
	children,
}: {
	onClick?: () => void;
	title?: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<button
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

function Separator() {
	return <div className={styles.sep} />;
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
	} = useScreenRecorder();

	const [recordingStart, setRecordingStart] = useState<number | null>(null);
	const [elapsed, setElapsed] = useState(0);
	const [pausedAt, setPausedAt] = useState<number | null>(null);
	const [pausedTotal, setPausedTotal] = useState(0);
	const [selectedSource, setSelectedSource] = useState("Screen");
	const [hasSelectedSource, setHasSelectedSource] = useState(false);
	const [, setRecordingsDirectory] = useState<string | null>(null);
	const [activeDropdown, setActiveDropdown] = useState<"none" | "sources" | "more" | "mic" | "countdown" | "webcam">("none");
	const [sources, setSources] = useState<DesktopSource[]>([]);
	const [sourcesLoading, setSourcesLoading] = useState(false);
	const [hideHudFromCapture, setHideHudFromCapture] = useState(true);
	const [platform, setPlatform] = useState<string | null>(null);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const hudContentRef = useRef<HTMLDivElement>(null);
	const hudBarRef = useRef<HTMLDivElement>(null);
	const webcamPreviewRef = useRef<HTMLVideoElement | null>(null);

	const micDropdownOpen = activeDropdown === "mic";
	const webcamDropdownOpen = activeDropdown === "webcam";
	const showWebcamControls = webcamEnabled && !recording;
	const { devices, selectedDeviceId, setSelectedDeviceId } =
		useMicrophoneDevices(microphoneEnabled || micDropdownOpen);
	const {
		devices: videoDevices,
		selectedDeviceId: selectedVideoDeviceId,
		setSelectedDeviceId: setSelectedVideoDeviceId,
	} = useVideoDevices(webcamEnabled || webcamDropdownOpen);

	const supportsHudCaptureProtection = platform !== "linux";

	useEffect(() => {
		if (selectedDeviceId && selectedDeviceId !== "default") {
			setMicrophoneDeviceId(selectedDeviceId);
		}
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
					playPromise.catch(() => {});
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
		const m = Math.floor(seconds / 60).toString().padStart(2, "0");
		const s = (seconds % 60).toString().padStart(2, "0");
		return `${m}:${s}`;
	};

	useEffect(() => {
		const checkSelectedSource = async () => {
			if (!window.electronAPI) return;
			const source = await window.electronAPI.getSelectedSource();
			if (source) {
				setSelectedSource(source.name);
				setHasSelectedSource(true);
			} else {
				setSelectedSource("Screen");
				setHasSelectedSource(false);
			}
		};
		void checkSelectedSource();
		const interval = setInterval(checkSelectedSource, 500);
		return () => clearInterval(interval);
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
		return () => { cancelled = true; };
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
		return () => { cancelled = true; };
	}, []);

	useEffect(() => {
		const expanded = activeDropdown !== "none";
		window.electronAPI.setHudOverlayExpanded(expanded);

		return () => {
			window.electronAPI.setHudOverlayExpanded(false);
		};
	}, [activeDropdown]);

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
				activeDropdown !== "none",
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
	}, [selectedSource, recording, paused, activeDropdown]);

	useEffect(() => {
		const handleClick = (e: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
				setActiveDropdown("none");
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

	const openProjectFile = async () => {
		setActiveDropdown("none");
		const result = await window.electronAPI.loadProjectFile();
		if (result.canceled || !result.success) return;
		await window.electronAPI.switchToEditor();
	};

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
	const hudStateTransition = { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const };

	const toggleWebcam = () => {
		if (recording) return;
		toggleDropdown("webcam");
	};

	const recordingControls = (
		<>
			<div className="flex items-center gap-[5px]">
				<div className={`w-[7px] h-[7px] rounded-full ${paused ? "bg-[#fbbf24]" : `bg-[#f43f5e] ${styles.recDotBlink}`}`} />
				<span className={`text-[10px] font-bold tracking-[0.06em] ${paused ? "text-[#fbbf24]" : "text-[#f43f5e]"}`}>
					{paused ? t("recording.paused") : t("recording.rec")}
				</span>
			</div>

			<span className={`font-mono text-xs font-semibold min-w-[52px] text-center tracking-[0.02em] ${paused ? "text-[#fbbf24]" : "text-[#eeeef2]"}`}>
				{formatTime(elapsed)}
			</span>

			<Separator />

			<IconButton title={microphoneEnabled ? t("recording.disableMicrophone") : t("recording.enableMicrophone")} className={microphoneEnabled ? styles.ibActive : ""}>
				{microphoneEnabled ? <Mic size={18} /> : <MicOff size={18} />}
			</IconButton>

			<Separator />

			<IconButton onClick={paused ? resumeRecording : pauseRecording} title={paused ? t("recording.resume") : t("recording.pause")} className={paused ? styles.ibGreen : ""}>
				{paused ? <Play size={18} fill="currentColor" strokeWidth={0} /> : <Pause size={18} />}
			</IconButton>

			<IconButton onClick={toggleRecording} title={t("recording.stop")} className={styles.ibRed}>
				<Square size={16} fill="currentColor" strokeWidth={0} />
			</IconButton>

			<IconButton onClick={() => window.electronAPI?.hudOverlayHide?.()} title={t("recording.hideHud")}>
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
				title={selectedSource}
			>
				<Monitor size={16} />
				<ContentClamp className={styles.sourceLabel} truncateLength={36}>
					{selectedSource}
				</ContentClamp>
				<ChevronUp size={10} className={`text-[#6b6b78] ml-0.5 transition-transform duration-200 ${activeDropdown === "sources" ? "" : "rotate-180"}`} />
			</button>

			<Separator />

			<IconButton
				onClick={toggleMicrophone}
				title={microphoneEnabled ? t("recording.disableMicrophone") : t("recording.enableMicrophone")}
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

			<IconButton onClick={() => toggleDropdown("more")} title={t("recording.more")}>
				<MoreVertical size={18} />
			</IconButton>

			<IconButton onClick={() => window.electronAPI?.hudOverlayHide?.()} title={t("recording.hideHud")}>
				<Minus size={16} />
			</IconButton>

			<IconButton onClick={() => window.electronAPI?.hudOverlayClose?.()} title={t("recording.closeApp")}>
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
			>
				{/* Only the visible HUD content should become interactive. */}
				<div className={styles.menuArea}>
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
												<div className={styles.ddLabel}>{t("recording.screens")}</div>
												{screenSources.map((source) => (
													<DropdownItem
														key={source.id}
														icon={<Monitor size={16} />}
														selected={selectedSource === source.name}
														onClick={() => handleSourceSelect(source)}
													>
														{source.name}
													</DropdownItem>
												))}
											</>
										)}
										{windowSources.length > 0 && (
											<>
												<div className={styles.ddLabel} style={screenSources.length > 0 ? { marginTop: 4 } : undefined}>
													{t("recording.windows")}
												</div>
												{windowSources.map((source) => (
													<DropdownItem
														key={source.id}
														icon={<AppWindow size={16} />}
														selected={selectedSource === source.name}
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
									{systemAudioEnabled ? t("recording.disableSystemAudio") : t("recording.enableSystemAudio")}
								</DropdownItem>
								<Separator />
								{microphoneEnabled && (
									<DropdownItem
										icon={<MicOff size={16} />}
										onClick={() => { setMicrophoneEnabled(false); setActiveDropdown("none"); }}
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
										selected={microphoneEnabled && (microphoneDeviceId === device.deviceId || selectedDeviceId === device.deviceId)}
										onSelect={() => {
											setMicrophoneEnabled(true);
											setSelectedDeviceId(device.deviceId);
											setMicrophoneDeviceId(device.deviceId);
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
										onClick={() => { setWebcamEnabled(false); setActiveDropdown("none"); }}
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
										icon={webcamEnabled && (webcamDeviceId === device.deviceId || selectedVideoDeviceId === device.deviceId) ? <Video size={16} /> : <VideoOff size={16} />}
										selected={webcamEnabled && (webcamDeviceId === device.deviceId || selectedVideoDeviceId === device.deviceId)}
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
										onClick={() => { setCountdownDelay(delay); setActiveDropdown("none"); }}
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
										{hideHudFromCapture ? t("recording.hideHudFromVideo") : t("recording.showHudInVideo")}
									</DropdownItem>
								)}
								<DropdownItem icon={<FolderOpen size={16} />} onClick={chooseRecordingsDirectory}>
									{t("recording.recordingsFolder")}
								</DropdownItem>
								<DropdownItem icon={<VideoIcon size={16} />} onClick={openVideoFile}>
									{t("recording.openVideoFile")}
								</DropdownItem>
								<DropdownItem icon={<FolderOpen size={16} />} onClick={openProjectFile}>
									{t("recording.openProject")}
								</DropdownItem>
								<div className={styles.ddLabel} style={{ marginTop: 4 }}>{t("recording.language")}</div>
								{SUPPORTED_LOCALES.map((code) => (
									<DropdownItem
										key={code}
										icon={<Languages size={16} />}
										selected={locale === code}
										onClick={() => { setLocale(code as AppLocale); setActiveDropdown("none"); }}
									>
										{LOCALE_LABELS[code] ?? code}
									</DropdownItem>
								))}
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
						className={`${styles.bar} ${styles.electronDrag} mb-2`}
					>
						<div className={`flex items-center px-0.5 ${styles.electronDrag}`}>
							<RxDragHandleDots2 size={14} className="text-[#6b6b78]" />
						</div>

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
