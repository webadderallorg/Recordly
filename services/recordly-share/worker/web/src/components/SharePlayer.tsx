// Adapted from Voom (MIT), Copyright (c) 2026 Aritro Paul.
// See ../../../LICENSE and ../../../../../THIRD_PARTY_NOTICES.md.
import {
	Button,
	Card,
	Dropdown,
	Label,
	Link,
	ProgressBar,
	Spinner,
	Tooltip,
	toast,
} from "@heroui/react";
import {
	ArrowsOutIcon,
	ArrowsInIcon,
	ArrowCounterClockwiseIcon,
	ClosedCaptioningIcon,
	PauseIcon,
	PictureInPictureIcon,
	PlayIcon,
	SpeakerHighIcon,
	SpeakerSlashIcon,
	FastForwardIcon,
	RewindIcon,
	ChatCircleIcon,
} from "@phosphor-icons/react";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type RefObject,
	type CSSProperties,
} from "react";
import type { Comment, Reaction, ShareData } from "../scripts/api";
import { formatTimestamp } from "../scripts/api";
import { clusterTimeline, type TimelineItem } from "../scripts/shareModel";
import { togglePlayerFullscreen, type FullscreenVideo } from "../scripts/playerFullscreen";

interface Props {
	data: ShareData;
	videoRef: RefObject<HTMLVideoElement | null>;
	comments: Comment[];
	reactions: Reaction[];
	time: number;
	duration: number;
	onTime: (time: number) => void;
	onDuration: (duration: number) => void;
	seek: (time: number) => void;
}

export default function SharePlayer({
	data,
	videoRef,
	comments,
	reactions,
	time,
	duration,
	onTime,
	onDuration,
	seek,
}: Props) {
	const shell = useRef<HTMLDivElement>(null);
	const [poster, setPoster] = useState<string>();
	useEffect(() => {
		let active = true;
		setPoster(undefined);
		const image = new Image();
		const url = `/thumb/${data.shareCode}`;
		image.onload = () => {
			if (active) setPoster(url);
		};
		// A missing poster must not obscure the video element's decoded first frame.
		image.onerror = () => {
			if (active) setPoster(undefined);
		};
		image.src = url;
		return () => {
			active = false;
			image.onload = null;
			image.onerror = null;
		};
	}, [data.shareCode]);
	const markers = useRef<HTMLDivElement>(null);
	const [trackWidth, setTrackWidth] = useState(500);
	const [playing, setPlaying] = useState(false);
	const [controlsVisible, setControlsVisible] = useState(true);
	const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [nativeFullscreen, setNativeFullscreen] = useState(false);
	const revealOnly = useRef(false);
	const hideControls = useRef<ReturnType<typeof setTimeout> | null>(null);
	const revealControls = useCallback(() => {
		setControlsVisible(true);
		if (hideControls.current) clearTimeout(hideControls.current);
		if (playing) hideControls.current = setTimeout(() => setControlsVisible(false), 2500);
	}, [playing]);
	useEffect(() => {
		revealControls();
		return () => {
			if (hideControls.current) clearTimeout(hideControls.current);
		};
	}, [revealControls]);
	const [waiting, setWaiting] = useState(false);
	const [ended, setEnded] = useState(false);
	const [volume, setVolume] = useState(1);
	const [muted, setMuted] = useState(false);
	const [speed, setSpeed] = useState(1);
	const [captions, setCaptions] = useState(true);
	const [pip, setPip] = useState(false);
	const [error, setError] = useState(false);
	const savedVolume = useRef(1);
	const caption = data.segments.find((s) => time >= s.start_time && time < s.end_time);
	const cta =
		data.video.cta_url && /^https?:\/\//i.test(data.video.cta_url) ? data.video.cta_url : null;

	const togglePlay = useCallback(async () => {
		const video = videoRef.current;
		if (!video) return;
		if (!video.paused) video.pause();
		else
			try {
				await video.play();
			} catch {
				toast.danger("Playback could not start. Try again.");
			}
	}, [videoRef]);
	const toggleMute = useCallback(() => {
		const video = videoRef.current;
		if (!video) return;
		if (video.muted || video.volume === 0) {
			video.muted = false;
			video.volume = savedVolume.current || 1;
		} else {
			savedVolume.current = video.volume;
			video.muted = true;
		}
	}, [videoRef]);
	const fullscreen = useCallback(async () => {
		if (!shell.current || !videoRef.current) return;
		try {
			await togglePlayerFullscreen(shell.current, videoRef.current);
		} catch {
			toast.danger("Fullscreen is unavailable in this browser.");
		}
	}, [videoRef]);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		const update = () => {
			setIsFullscreen(
				document.fullscreenElement === shell.current ||
					(document as Document & { webkitFullscreenElement?: Element })
						.webkitFullscreenElement === shell.current,
			);
			revealControls();
		};
		const begin = () => {
			setNativeFullscreen(true);
			setIsFullscreen(true);
		};
		const end = () => {
			setNativeFullscreen(false);
			setIsFullscreen(false);
			revealControls();
		};
		document.addEventListener("fullscreenchange", update);
		document.addEventListener("webkitfullscreenchange", update);
		video.addEventListener("webkitbeginfullscreen", begin);
		video.addEventListener("webkitendfullscreen", end);
		return () => {
			document.removeEventListener("fullscreenchange", update);
			document.removeEventListener("webkitfullscreenchange", update);
			video.removeEventListener("webkitbeginfullscreen", begin);
			video.removeEventListener("webkitendfullscreen", end);
		};
	}, [videoRef, revealControls]);

	// Native iPhone fullscreen renders the video tracks instead of our caption overlay.
	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		const update = () => {
			for (const track of Array.from(video.textTracks))
				track.mode = nativeFullscreen && captions ? "showing" : "hidden";
		};
		update();
		video.textTracks.addEventListener("addtrack", update);
		video.addEventListener("loadedmetadata", update);
		return () => {
			video.textTracks.removeEventListener("addtrack", update);
			video.removeEventListener("loadedmetadata", update);
		};
	}, [videoRef, nativeFullscreen, captions]);
	async function pictureInPicture() {
		try {
			if (document.pictureInPictureElement) await document.exitPictureInPicture();
			else await videoRef.current?.requestPictureInPicture();
		} catch {
			toast.danger("Picture in picture is unavailable for this recording.");
		}
	}

	useEffect(() => {
		setPip(!!document.pictureInPictureEnabled);
		if (!markers.current) return;
		const observer = new ResizeObserver(([entry]) => setTrackWidth(entry.contentRect.width));
		observer.observe(markers.current);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		function keyboard(e: KeyboardEvent) {
			const target = e.target as HTMLElement;
			if (
				e.defaultPrevented ||
				e.metaKey ||
				e.ctrlKey ||
				e.altKey ||
				target.closest(
					'input, textarea, select, button, a, [role="slider"], [role="tab"], [role="menuitem"], [contenteditable="true"]',
				)
			)
				return;
			const video = videoRef.current;
			if (!video) return;
			switch (e.key.toLowerCase()) {
				case " ":
				case "k":
					e.preventDefault();
					void togglePlay();
					break;
				case "arrowleft":
					e.preventDefault();
					seek(video.currentTime - 5);
					break;
				case "arrowright":
					e.preventDefault();
					seek(video.currentTime + 5);
					break;
				case "m":
					toggleMute();
					break;
				case "f":
					void fullscreen();
					break;
				case "c":
					setCaptions((value) => !value);
					break;
			}
		}
		document.addEventListener("keydown", keyboard);
		return () => document.removeEventListener("keydown", keyboard);
	}, [seek, videoRef, togglePlay, toggleMute, fullscreen]);

	return (
		<Card
			ref={shell}
			className="video-shell"
			style={
				{
					"--recording-aspect-ratio":
						data.video.width > 0 && data.video.height > 0
							? data.video.width / data.video.height
							: 16 / 9,
				} as CSSProperties
			}
			role="region"
			aria-label="Video player"
			data-controls-visible={!playing || controlsVisible || speedMenuOpen}
			onPointerEnter={(event) => {
				if (event.pointerType === "mouse") revealControls();
			}}
			onPointerMove={(event) => {
				if (event.pointerType === "mouse") revealControls();
			}}
			onPointerDown={(event) => {
				revealOnly.current = event.pointerType !== "mouse" && playing && !controlsVisible;
				revealControls();
			}}
			onPointerLeave={(event) => {
				if (event.pointerType === "mouse" && playing) setControlsVisible(false);
			}}
			onFocusCapture={revealControls}
		>
			<div className="video-stage">
				<video
					ref={videoRef}
					src={`/v/${data.shareCode}`}
					poster={poster}
					preload="metadata"
					playsInline
					onClick={() => {
						if (revealOnly.current) {
							revealOnly.current = false;
							revealControls();
						} else void togglePlay();
					}}
					onPlay={() => {
						setPlaying(true);
						setEnded(false);
					}}
					onPause={() => setPlaying(false)}
					onWaiting={() => setWaiting(true)}
					onPlaying={() => setWaiting(false)}
					onCanPlay={() => setWaiting(false)}
					onError={() => {
						setError(true);
						setWaiting(false);
					}}
					onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
					onVolumeChange={(e) => {
						setVolume(e.currentTarget.volume);
						setMuted(e.currentTarget.muted);
					}}
					onRateChange={(e) => setSpeed(e.currentTarget.playbackRate)}
					onEnded={() => {
						setEnded(true);
						setPlaying(false);
					}}
					onSeeking={() => setEnded(false)}
					onLoadedMetadata={(e) => {
						const video = e.currentTarget;
						onDuration(Number.isFinite(video.duration) ? video.duration : 0);
						const start = Number(new URLSearchParams(location.search).get("t"));
						if (Number.isFinite(start) && start > 0 && start < video.duration)
							video.currentTime = start;
						for (const track of Array.from(video.textTracks))
							track.mode =
								(video as FullscreenVideo).webkitDisplayingFullscreen && captions
									? "showing"
									: "hidden";
					}}
				>
					{data.segments.length > 0 && (
						<track
							kind="captions"
							src={`/vtt/${data.shareCode}`}
							srcLang="en"
							label="English"
						/>
					)}
				</video>
				{!playing && !error && !(ended && cta) && (
					<div className="video-play-overlay">
						<Button
							isIconOnly
							size="lg"
							className="video-play-button"
							aria-label={ended ? "Replay recording" : "Play recording"}
							onPress={() => void togglePlay()}
						>
							{ended ? (
								<ArrowCounterClockwiseIcon size={24} />
							) : (
								<PlayIcon size={24} weight="fill" />
							)}
						</Button>
					</div>
				)}
				{waiting && playing && (
					<div className="video-play-overlay">
						<Spinner aria-label="Buffering video" />
					</div>
				)}
				{error && (
					<div className="video-end-card">
						<p>We couldn’t load this video.</p>
						<Button
							variant="secondary"
							onPress={() => {
								setError(false);
								videoRef.current?.load();
							}}
						>
							Try again
						</Button>
					</div>
				)}
				{captions && caption && (
					<div className="video-caption">
						<span>
							{caption.speaker && `${caption.speaker}: `}
							{caption.text}
						</span>
					</div>
				)}
				<div className="timestamp-reactions" aria-hidden="true">
					{reactions
						.filter(
							(reaction) =>
								time >= reaction.timestamp && time < reaction.timestamp + 3,
						)
						.slice(-12)
						.map((reaction, index) => (
							<span
								className="timestamp-reaction"
								key={`${reaction.created_at}-${reaction.timestamp}-${index}`}
								style={{ left: `${15 + ((index * 19) % 70)}%` }}
							>
								{reaction.emoji}
							</span>
						))}
				</div>
				{ended && cta && (
					<div className="video-end-card">
						<Link
							className="button button--primary"
							href={cta}
							target="_blank"
							rel="noopener noreferrer"
						>
							{data.video.cta_text || "Learn more"}
						</Link>
						<Button
							variant="secondary"
							onPress={() => {
								seek(0);
								void togglePlay();
							}}
						>
							<ArrowCounterClockwiseIcon size={16} />
							Replay
						</Button>
					</div>
				)}
				<div className="video-toolbar" role="group" aria-label="Playback controls">
					<div
						ref={markers}
						className="timeline-markers"
						aria-label="Comments and reactions on the timeline"
					>
						{clusterTimeline(
							[
								...comments.map(
									(item): TimelineItem => ({
										timestamp: item.timestamp,
										kind: "comment",
										label: `${item.author_name}: ${item.text}`,
									}),
								),
								...reactions.map(
									(item): TimelineItem => ({
										timestamp: item.timestamp,
										kind: "reaction",
										emoji: item.emoji,
										label: `${item.emoji} reaction`,
									}),
								),
								...data.chapters.map(
									(item): TimelineItem => ({
										timestamp: item.timestamp,
										kind: "chapter",
										label: `Chapter: ${item.title}`,
									}),
								),
							],
							duration,
							trackWidth,
						).map((cluster, index) => (
							<Tooltip key={`timeline-${index}`}>
								<Button
									size="sm"
									variant={cluster.members.length > 1 ? "primary" : "ghost"}
									className="timeline-marker"
									style={{
										left: `${duration ? Math.max(2, Math.min(98, (cluster.time / duration) * 100)) : 2}%`,
									}}
									aria-label={`${cluster.members.length > 1 ? `${cluster.members.length} items` : cluster.members[0].label} at ${formatTimestamp(cluster.time)}`}
									onPress={() => seek(cluster.members[0].timestamp)}
								>
									{cluster.members.length > 1 ? (
										cluster.members.length
									) : cluster.members[0].kind === "reaction" ? (
										<span aria-hidden="true">{cluster.members[0].emoji}</span>
									) : cluster.members[0].kind === "comment" ? (
										<ChatCircleIcon size={12} />
									) : (
										"•"
									)}
								</Button>
								<Tooltip.Content>
									{cluster.members
										.map(
											(item) =>
												`${formatTimestamp(item.timestamp)} ${item.label}`,
										)
										.join(" · ")}
								</Tooltip.Content>
							</Tooltip>
						))}
					</div>
					<div className="video-progress">
						<ProgressBar
							aria-label="Video progress"
							value={Math.min(time, duration || 0)}
							minValue={0}
							maxValue={duration || 1}
							size="sm"
							valueLabel={`${formatTimestamp(time)} of ${formatTimestamp(duration)}`}
						>
							<ProgressBar.Track>
								<ProgressBar.Fill />
							</ProgressBar.Track>
						</ProgressBar>
						<input
							className="video-seek-input"
							type="range"
							aria-label="Seek video"
							aria-valuetext={`${formatTimestamp(time)} of ${formatTimestamp(duration)}`}
							min={0}
							max={duration || 1}
							step={0.1}
							value={Math.min(time, duration || 0)}
							disabled={!duration}
							onChange={(event) => seek(Number(event.currentTarget.value))}
						/>
					</div>
					<div className="video-controls">
						<Button
							isIconOnly
							size="sm"
							variant="ghost"
							aria-label={playing ? "Pause" : "Play"}
							onPress={() => void togglePlay()}
						>
							{playing ? (
								<PauseIcon size={18} weight="fill" />
							) : (
								<PlayIcon size={18} weight="fill" />
							)}
						</Button>
						<Button
							isIconOnly
							size="sm"
							variant="ghost"
							className="skip-control"
							aria-label="Back 5 seconds"
							onPress={() => seek(time - 5)}
						>
							<RewindIcon size={18} />
						</Button>
						<Button
							isIconOnly
							size="sm"
							variant="ghost"
							className="skip-control"
							aria-label="Forward 5 seconds"
							onPress={() => seek(time + 5)}
						>
							<FastForwardIcon size={18} />
						</Button>
						<Button
							isIconOnly
							size="sm"
							variant="ghost"
							aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
							onPress={toggleMute}
						>
							{muted || volume === 0 ? (
								<SpeakerSlashIcon size={18} />
							) : (
								<SpeakerHighIcon size={18} />
							)}
						</Button>
						<input
							className="volume-control"
							aria-label="Volume"
							type="range"
							min={0}
							max={1}
							step={0.05}
							value={muted ? 0 : volume}
							onChange={(event) => {
								const value = Number(event.currentTarget.value);
								if (videoRef.current) {
									videoRef.current.volume = value;
									videoRef.current.muted = value === 0;
									if (value) savedVolume.current = value;
								}
							}}
						/>
						<span className="video-time">
							{formatTimestamp(time)} / {formatTimestamp(duration)}
						</span>
						<span className="control-spacer" />
						{data.segments.length > 0 && (
							<Button
								isIconOnly
								size="sm"
								variant={captions ? "secondary" : "ghost"}
								aria-label="Captions"
								aria-pressed={captions}
								onPress={() => setCaptions(!captions)}
							>
								<ClosedCaptioningIcon size={18} />
							</Button>
						)}
						<Dropdown onOpenChange={setSpeedMenuOpen}>
							<Button
								size="sm"
								variant="ghost"
								aria-label={`Playback speed: ${speed}×`}
							>
								{speed}×
							</Button>
							<Dropdown.Popover
								UNSTABLE_portalContainer={
									isFullscreen ? (shell.current ?? undefined) : undefined
								}
							>
								<Dropdown.Menu
									aria-label="Playback speed"
									selectionMode="single"
									selectedKeys={new Set([String(speed)])}
									onAction={(key) => {
										if (videoRef.current)
											videoRef.current.playbackRate = Number(key);
									}}
								>
									{[0.5, 1, 1.25, 1.5, 2].map((rate) => (
										<Dropdown.Item
											key={rate}
											id={String(rate)}
											textValue={`${rate}×`}
										>
											<Label>{rate}×</Label>
											<Dropdown.ItemIndicator />
										</Dropdown.Item>
									))}
								</Dropdown.Menu>
							</Dropdown.Popover>
						</Dropdown>
						{pip && (
							<Button
								isIconOnly
								size="sm"
								variant="ghost"
								className="pip-control"
								aria-label="Picture in picture"
								onPress={() => void pictureInPicture()}
							>
								<PictureInPictureIcon size={18} />
							</Button>
						)}
						<Button
							isIconOnly
							size="sm"
							variant="ghost"
							aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
							onPress={() => void fullscreen()}
						>
							{isFullscreen ? (
								<ArrowsInIcon size={18} />
							) : (
								<ArrowsOutIcon size={18} />
							)}
						</Button>
					</div>
				</div>
			</div>
		</Card>
	);
}
