import { Button } from "@heroui/react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { SpeakerHigh, SpeakerX } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";

const MUSIC_VOLUME = 0.25;
const FADE_IN_MS = 2000;
type PlaybackState = "idle" | "starting" | "playing" | "blocked" | "paused" | "finished";
let state: PlaybackState = "idle";
let audio: HTMLAudioElement | undefined;
const listeners = new Set<() => void>();
let owners = 0;
let playbackRequest = 0;
let volumeFrame: number | undefined;
const getPlaybackState = () => state;

function cancelVolumeFade() {
	if (volumeFrame !== undefined) cancelAnimationFrame(volumeFrame);
	volumeFrame = undefined;
}

function fadeInMusic(track: HTMLAudioElement, request: number) {
	const start = performance.now();
	const step = (now: number) => {
		if (request !== playbackRequest) return;
		const progress = Math.min(Math.max((now - start) / FADE_IN_MS, 0), 1);
		track.volume = MUSIC_VOLUME * progress;
		volumeFrame = progress < 1 ? requestAnimationFrame(step) : undefined;
	};
	volumeFrame = requestAnimationFrame(step);
}

function updateState(next: PlaybackState) {
	state = next;
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function stopMusic() {
	playbackRequest += 1;
	cancelVolumeFade();
	audio?.pause();
	updateState("finished");
}

function pauseMusic() {
	playbackRequest += 1;
	cancelVolumeFade();
	audio?.pause();
	updateState("paused");
}

function getAudio() {
	if (!audio) {
		audio = new Audio(new URL("./audio/first-boot.m4a", window.location.href).href);
		audio.volume = 0;
		audio.addEventListener("ended", () => {
			cancelVolumeFade();
			updateState("finished");
		});
		audio.addEventListener("error", stopMusic);
	}
	return audio;
}

async function playMusic() {
	const track = getAudio();
	const request = ++playbackRequest;
	cancelVolumeFade();
	track.volume = 0;
	if (track.ended) track.currentTime = 0;
	updateState("starting");
	try {
		await track.play();
		if (request !== playbackRequest) {
			if (getPlaybackState() !== "playing" && getPlaybackState() !== "starting")
				track.pause();
			return;
		}
		fadeInMusic(track, request);
		updateState("playing");
	} catch (error) {
		if (request !== playbackRequest) return;
		updateState(
			error instanceof DOMException && error.name === "NotAllowedError"
				? "blocked"
				: "finished",
		);
	}
}

function startOnboardingMusic() {
	if (owners > 1) return;
	playbackRequest += 1;
	cancelVolumeFade();
	audio?.pause();
	if (audio) audio.currentTime = 0;
	void playMusic();
}

/** Each onboarding opening owns its welcome audio, including production. */
export function FirstBootMusic() {
	const t = useScopedT("onboarding");
	const playback = useSyncExternalStore(subscribe, getPlaybackState);
	const started = useRef(false);
	useEffect(() => {
		owners += 1;
		if (!started.current) {
			started.current = true;
			startOnboardingMusic();
		}
		const removeRecordingListener = window.electronAPI?.onRecordingStateChanged?.(
			({ recording }) => {
				if (recording) stopMusic();
			},
		);
		window.addEventListener("pagehide", stopMusic);
		return () => {
			owners -= 1;
			// StrictMode reattaches effects synchronously; stop only on a real unmount.
			queueMicrotask(() => {
				if (owners === 0) stopMusic();
			});
			removeRecordingListener?.();
			window.removeEventListener("pagehide", stopMusic);
		};
	}, []);

	useEffect(() => {
		if (playback !== "blocked") return;
		const retry = (event: Event) => {
			// The sound button already starts playback from its own user gesture.
			if (event.target instanceof Element && event.target.closest("[data-welcome-music]"))
				return;
			if (getPlaybackState() === "blocked") void playMusic();
		};
		window.addEventListener("pointerdown", retry);
		window.addEventListener("keydown", retry);
		return () => {
			window.removeEventListener("pointerdown", retry);
			window.removeEventListener("keydown", retry);
		};
	}, [playback]);

	if (playback === "idle" || playback === "starting" || playback === "finished") return null;
	const isPlaying = playback === "playing";
	const label = isPlaying ? t("muteMusic") : t("unmuteMusic");
	const SoundIcon = isPlaying ? SpeakerHigh : SpeakerX;
	return (
		<div
			data-welcome-music
			className="fixed top-4 left-4 z-[1100] flex items-center gap-2 rounded-xl border border-border/30 bg-background/50 p-1 shadow-sm backdrop-blur-md [-webkit-app-region:no-drag]"
			title={label}
		>
			<Button
				isIconOnly
				size="sm"
				variant="ghost"
				aria-label={label}
				aria-pressed={isPlaying}
				className="text-foreground/65"
				onPress={isPlaying ? pauseMusic : () => void playMusic()}
			>
				<SoundIcon className="size-4" aria-hidden="true" />
			</Button>
		</div>
	);
}
