import {
	CaretDownIcon,
	CaretUpIcon,
	MinusIcon,
	PauseIcon,
	PencilSimpleIcon,
	PlayIcon,
	PlusIcon,
	VideoCameraIcon,
	VideoCameraSlashIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useScopedT } from "@/contexts/I18nContext";
import {
	CAMERA_OPACITY_MAX,
	CAMERA_OPACITY_MIN,
	clampCameraOpacity,
	parseStoredCameraOpacity,
} from "./teleprompterCamera";
import {
	advanceScrollTop,
	DEFAULT_FONT_SIZE_INDEX,
	DEFAULT_SPEED_INDEX,
	FONT_SIZES,
	SPEED_LEVELS,
	stepIndex,
} from "./teleprompterScroll";

const SCRIPT_STORAGE_KEY = "recordly-teleprompter-script";
const SPEED_STORAGE_KEY = "recordly-teleprompter-speed-index";
const FONT_STORAGE_KEY = "recordly-teleprompter-font-index";
const CAMERA_ON_STORAGE_KEY = "recordly-teleprompter-camera-on";
const CAMERA_OPACITY_STORAGE_KEY = "recordly-teleprompter-camera-opacity";

const dragRegion = { WebkitAppRegion: "drag" } as React.CSSProperties;
const noDragRegion = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

function loadStoredIndex(key: string, fallback: number, length: number): number {
	const raw = Number.parseInt(window.localStorage.getItem(key) ?? "", 10);
	if (!Number.isFinite(raw) || raw < 0 || raw >= length) {
		return fallback;
	}
	return raw;
}

export function Teleprompter() {
	const t = useScopedT("launch");
	const [script, setScript] = useState(
		() => window.localStorage.getItem(SCRIPT_STORAGE_KEY) ?? "",
	);
	const [editing, setEditing] = useState(
		() => (window.localStorage.getItem(SCRIPT_STORAGE_KEY) ?? "").trim().length === 0,
	);
	const [playing, setPlaying] = useState(false);
	const [speedIndex, setSpeedIndex] = useState(() =>
		loadStoredIndex(SPEED_STORAGE_KEY, DEFAULT_SPEED_INDEX, SPEED_LEVELS.length),
	);
	const [fontIndex, setFontIndex] = useState(() =>
		loadStoredIndex(FONT_STORAGE_KEY, DEFAULT_FONT_SIZE_INDEX, FONT_SIZES.length),
	);
	const [cameraOn, setCameraOn] = useState(
		() => window.localStorage.getItem(CAMERA_ON_STORAGE_KEY) === "true",
	);
	const [cameraOpacity, setCameraOpacity] = useState(() =>
		parseStoredCameraOpacity(window.localStorage.getItem(CAMERA_OPACITY_STORAGE_KEY)),
	);
	const [cameraError, setCameraError] = useState(false);

	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const scrollPositionRef = useRef(0);
	const speedIndexRef = useRef(speedIndex);
	const editingRef = useRef(editing);
	const autoScrollingRef = useRef(false);
	const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
	const cameraStreamRef = useRef<MediaStream | null>(null);

	useEffect(() => {
		window.localStorage.setItem(SCRIPT_STORAGE_KEY, script);
	}, [script]);

	useEffect(() => {
		window.localStorage.setItem(SPEED_STORAGE_KEY, String(speedIndex));
		speedIndexRef.current = speedIndex;
	}, [speedIndex]);

	useEffect(() => {
		window.localStorage.setItem(FONT_STORAGE_KEY, String(fontIndex));
	}, [fontIndex]);

	useEffect(() => {
		editingRef.current = editing;
	}, [editing]);

	useEffect(() => {
		window.localStorage.setItem(CAMERA_ON_STORAGE_KEY, String(cameraOn));
	}, [cameraOn]);

	useEffect(() => {
		window.localStorage.setItem(CAMERA_OPACITY_STORAGE_KEY, String(cameraOpacity));
	}, [cameraOpacity]);

	// Camera stream lifecycle — runs only in read mode with the toggle on.
	useEffect(() => {
		if (!cameraOn || editing) {
			return;
		}
		let cancelled = false;

		const stopStream = () => {
			for (const track of cameraStreamRef.current?.getTracks() ?? []) {
				track.stop();
			}
			cameraStreamRef.current = null;
			if (cameraVideoRef.current) {
				cameraVideoRef.current.srcObject = null;
			}
		};

		void (async () => {
			setCameraError(false);
			const deviceId = await window.electronAPI
				?.getSelectedWebcamDevice?.()
				.catch(() => null);
			const constraintsList: MediaStreamConstraints[] = deviceId
				? [{ video: { deviceId: { exact: deviceId } } }, { video: true }]
				: [{ video: true }];
			for (const constraints of constraintsList) {
				try {
					const stream = await navigator.mediaDevices.getUserMedia(constraints);
					if (cancelled) {
						for (const track of stream.getTracks()) {
							track.stop();
						}
						return;
					}
					cameraStreamRef.current = stream;
					if (cameraVideoRef.current) {
						cameraVideoRef.current.srcObject = stream;
					}
					return;
				} catch {
					// Try the next (less strict) constraints.
				}
			}
			if (!cancelled) {
				setCameraError(true);
				setCameraOn(false);
			}
		})();

		return () => {
			cancelled = true;
			stopStream();
		};
	}, [cameraOn, editing]);

	// Auto-scroll loop. Fractional position lives in scrollPositionRef so slow
	// speeds accumulate sub-pixel movement instead of stalling.
	useEffect(() => {
		if (!playing || editing) {
			return;
		}
		let frame = 0;
		let lastTime: number | null = null;
		const tick = (time: number) => {
			const container = scrollContainerRef.current;
			if (container && lastTime !== null) {
				const next = advanceScrollTop(
					scrollPositionRef.current,
					SPEED_LEVELS[speedIndexRef.current],
					time - lastTime,
				);
				const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
				scrollPositionRef.current = Math.min(next, maxScroll);
				autoScrollingRef.current = true;
				container.scrollTop = scrollPositionRef.current;
				autoScrollingRef.current = false;
				if (scrollPositionRef.current >= maxScroll) {
					setPlaying(false);
					return;
				}
			}
			lastTime = time;
			frame = window.requestAnimationFrame(tick);
		};
		frame = window.requestAnimationFrame(tick);
		return () => window.cancelAnimationFrame(frame);
	}, [playing, editing]);

	const togglePlay = useCallback(() => {
		if (editingRef.current) {
			// Entering read mode mounts a fresh container at scrollTop 0; reset the
			// position ref to match so playback starts from the top, not a stale spot.
			scrollPositionRef.current = 0;
			setEditing(false);
			setPlaying(true);
			return;
		}
		setPlaying((was) => !was);
	}, []);

	// Global hotkeys relayed from the main process.
	useEffect(() => {
		const unsubscribe = window.electronAPI?.onTeleprompterCommand?.((command) => {
			if (command === "toggle-play") {
				togglePlay();
			} else if (command === "speed-down") {
				setSpeedIndex((index) => stepIndex(index, -1, SPEED_LEVELS.length));
			} else if (command === "speed-up") {
				setSpeedIndex((index) => stepIndex(index, 1, SPEED_LEVELS.length));
			}
		});
		return unsubscribe;
	}, [togglePlay]);

	// Manual scrolling always works and pauses auto-scroll.
	const handleWheel = useCallback(() => {
		setPlaying(false);
	}, []);

	// Note: scroll events fire async, so autoScrollingRef is a best-effort guard —
	// programmatic scrolls can still reach this handler. That's harmless because it
	// only syncs the position ref; pause logic must stay on onWheel, never onScroll.
	const handleScroll = useCallback(() => {
		const container = scrollContainerRef.current;
		if (container && !autoScrollingRef.current) {
			scrollPositionRef.current = container.scrollTop;
		}
	}, []);

	const startReading = useCallback(() => {
		scrollPositionRef.current = 0;
		setEditing(false);
	}, []);

	const backToEdit = useCallback(() => {
		setPlaying(false);
		setEditing(true);
	}, []);

	// Camera-full layout mode relayed from the recording HUD: highlight the
	// window blue so the reader knows only the facecam is in frame.
	const [cameraFullLayout, setCameraFullLayout] = useState(false);
	useEffect(() => {
		const unsubscribe = window.electronAPI?.onTeleprompterCameraMode?.((mode) => {
			setCameraFullLayout(mode === "camera-full");
		});
		return unsubscribe;
	}, []);

	return (
		<div className="relative flex h-screen w-screen flex-col overflow-hidden bg-[#161616] text-neutral-100">
			{cameraFullLayout && (
				<div className="pointer-events-none absolute inset-0 z-50 border-[3px] border-blue-500" />
			)}
			<header
				className="flex h-9 shrink-0 items-center gap-2 border-b border-white/10 px-3"
				style={dragRegion}
			>
				<span
					className={`select-none text-xs font-medium ${
						cameraFullLayout ? "text-blue-400" : "text-neutral-400"
					}`}
				>
					{t("teleprompter.menuLabel", "Teleprompter")}
				</span>
				<span className="select-none truncate text-[10px] text-neutral-600">
					{t("teleprompter.hotkeyHint", "⌥F8 play/pause · ⌥F7/⌥F9 speed · ⌥T show/hide")}
				</span>
				{cameraError && (
					<span className="select-none text-[10px] text-red-400">
						{t("teleprompter.cameraError", "Camera unavailable")}
					</span>
				)}
				<div className="ml-auto flex items-center gap-1" style={noDragRegion}>
					<Button
						variant="ghost"
						size="icon"
						className="h-6 w-6 text-neutral-400 hover:text-neutral-100"
						onClick={() => setCameraOn((was) => !was)}
						title={
							cameraOn
								? t("teleprompter.cameraOff", "Hide camera")
								: t("teleprompter.cameraOn", "Show camera")
						}
						aria-label={
							cameraOn
								? t("teleprompter.cameraOff", "Hide camera")
								: t("teleprompter.cameraOn", "Show camera")
						}
					>
						{cameraOn ? (
							<VideoCameraIcon size={13} weight="bold" />
						) : (
							<VideoCameraSlashIcon size={13} weight="bold" />
						)}
					</Button>
					{!editing && (
						<Button
							variant="ghost"
							size="icon"
							className="h-6 w-6 text-neutral-400 hover:text-neutral-100"
							onClick={backToEdit}
							title={t("teleprompter.edit", "Edit")}
							aria-label={t("teleprompter.edit", "Edit")}
						>
							<PencilSimpleIcon size={13} weight="bold" />
						</Button>
					)}
					<Button
						variant="ghost"
						size="icon"
						className="h-6 w-6 text-neutral-400 hover:text-neutral-100"
						onClick={() => window.electronAPI?.teleprompterClose?.()}
						title={t("teleprompter.close", "Close")}
						aria-label={t("teleprompter.close", "Close")}
					>
						<XIcon size={13} weight="bold" />
					</Button>
				</div>
			</header>

			{editing ? (
				<div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
					<textarea
						className="min-h-0 flex-1 resize-none rounded-md border border-white/10 bg-black/30 p-3 text-sm leading-relaxed text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-white/25"
						value={script}
						onChange={(event) => setScript(event.target.value)}
						placeholder={t(
							"teleprompter.scriptPlaceholder",
							"Paste or type your script here…",
						)}
						autoFocus
					/>
					<Button
						className="shrink-0"
						onClick={startReading}
						disabled={script.trim().length === 0}
					>
						{t("teleprompter.startReading", "Start reading")}
					</Button>
				</div>
			) : (
				<>
					<div className="relative min-h-0 flex-1">
						{cameraOn && (
							<video
								ref={cameraVideoRef}
								autoPlay
								muted
								playsInline
								className="pointer-events-none absolute inset-0 h-full w-full object-cover"
								style={{ transform: "scaleX(-1)", opacity: cameraOpacity }}
							/>
						)}
						<div
							ref={scrollContainerRef}
							className="absolute inset-0 overflow-y-auto px-5"
							onWheel={handleWheel}
							onScroll={handleScroll}
						>
							<div
								className="whitespace-pre-wrap pt-6 pb-[70vh] font-medium leading-relaxed"
								style={{
									fontSize: FONT_SIZES[fontIndex],
									textShadow: cameraOn
										? "0 1px 6px rgba(0, 0, 0, 0.9)"
										: undefined,
								}}
							>
								{script}
							</div>
						</div>
					</div>
					<footer className="flex h-10 shrink-0 items-center justify-center gap-1 border-t border-white/10 px-2">
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 text-neutral-300"
							onClick={() =>
								setSpeedIndex((index) => stepIndex(index, -1, SPEED_LEVELS.length))
							}
							title={t("teleprompter.slower", "Slower")}
							aria-label={t("teleprompter.slower", "Slower")}
						>
							<CaretDownIcon size={14} weight="bold" />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8 text-neutral-100"
							onClick={togglePlay}
							title={
								playing
									? t("teleprompter.pause", "Pause")
									: t("teleprompter.play", "Play")
							}
							aria-label={
								playing
									? t("teleprompter.pause", "Pause")
									: t("teleprompter.play", "Play")
							}
						>
							{playing ? (
								<PauseIcon size={16} weight="fill" />
							) : (
								<PlayIcon size={16} weight="fill" />
							)}
						</Button>
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 text-neutral-300"
							onClick={() =>
								setSpeedIndex((index) => stepIndex(index, 1, SPEED_LEVELS.length))
							}
							title={t("teleprompter.faster", "Faster")}
							aria-label={t("teleprompter.faster", "Faster")}
						>
							<CaretUpIcon size={14} weight="bold" />
						</Button>
						<span className="w-10 select-none text-center text-[10px] tabular-nums text-neutral-500">
							{SPEED_LEVELS[speedIndex]}px/s
						</span>
						<div className="mx-1 h-5 w-px bg-white/10" />
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 text-neutral-300"
							onClick={() =>
								setFontIndex((index) => stepIndex(index, -1, FONT_SIZES.length))
							}
							title={t("teleprompter.smallerText", "Smaller text")}
							aria-label={t("teleprompter.smallerText", "Smaller text")}
						>
							<MinusIcon size={14} weight="bold" />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 text-neutral-300"
							onClick={() =>
								setFontIndex((index) => stepIndex(index, 1, FONT_SIZES.length))
							}
							title={t("teleprompter.biggerText", "Bigger text")}
							aria-label={t("teleprompter.biggerText", "Bigger text")}
						>
							<PlusIcon size={14} weight="bold" />
						</Button>
						{cameraOn && (
							<>
								<div className="mx-1 h-5 w-px bg-white/10" />
								<Slider
									value={[cameraOpacity]}
									onValueChange={([value]) =>
										setCameraOpacity(clampCameraOpacity(value))
									}
									min={CAMERA_OPACITY_MIN}
									max={CAMERA_OPACITY_MAX}
									step={0.05}
									className="w-20"
									aria-label={t("teleprompter.cameraFade", "Camera fade")}
								/>
							</>
						)}
					</footer>
				</>
			)}
		</div>
	);
}
