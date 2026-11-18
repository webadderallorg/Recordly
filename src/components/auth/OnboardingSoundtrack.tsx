import { Button } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { ONBOARDING_DEMO_URL } from "@/assets/onboarding/media";
import { SpeakerHigh, SpeakerX } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";

export function OnboardingSoundtrack() {
	const t = useScopedT("onboarding");
	const audioRef = useRef<HTMLAudioElement>(null);
	const toggleRef = useRef<() => void>(undefined);
	const [sound, setSound] = useState<"audible" | "muted" | null>(null);

	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;
		const waitForLogo =
			new URLSearchParams(window.location.search).get("welcomeSoundtrack") === "intro";
		let disposed = false;
		let playback: "idle" | "starting" | "blocked" | "playing" | "finished" = "idle";
		let unsubscribe: (() => void) | undefined;
		const finish = () => {
			playback = "finished";
			audio.pause();
			setSound(null);
		};
		const play = async () => {
			if (disposed || (playback !== "idle" && playback !== "blocked")) return;
			playback = "starting";
			try {
				await audio.play();
				if (disposed || playback !== "starting") return;
				playback = "playing";
				setSound("audible");
			} catch (error) {
				if (disposed || playback !== "starting") return;
				if (error instanceof DOMException && error.name === "NotAllowedError") {
					playback = "blocked";
					setSound("muted");
				} else finish();
			}
		};
		const retry = (event: Event) => {
			if (playback !== "blocked") return;
			if (event.target instanceof Element && event.target.closest("[data-welcome-music]"))
				return;
			void play();
		};
		toggleRef.current = () => {
			if (playback === "blocked") void play();
			if (playback !== "playing") return;
			audio.muted = !audio.muted;
			setSound(audio.muted ? "muted" : "audible");
		};
		const ready = () => {
			audio.removeEventListener("canplay", ready);
			if (disposed || unsubscribe) return;
			if (waitForLogo)
				unsubscribe = window.electronAPI?.onOnboardingSoundtrackStart?.(() => void play());
			if (!unsubscribe) void play();
		};
		const onError = () => {
			finish();
			ready();
		};
		const stopOnRecording = window.electronAPI?.onRecordingStateChanged?.(({ recording }) => {
			if (recording) finish();
		});
		audio.addEventListener("ended", finish);
		audio.addEventListener("error", onError);
		window.addEventListener("click", retry, true);
		window.addEventListener("keydown", retry, true);
		window.addEventListener("pagehide", finish);
		// Starting playback requires both the native cue and a playable soundtrack.
		queueMicrotask(() => {
			if (disposed) return;
			if (
				!waitForLogo ||
				audio.error ||
				audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
			)
				ready();
			else audio.addEventListener("canplay", ready, { once: true });
		});
		return () => {
			disposed = true;
			audio.pause();
			audio.removeEventListener("canplay", ready);
			audio.removeEventListener("ended", finish);
			audio.removeEventListener("error", onError);
			window.removeEventListener("click", retry, true);
			window.removeEventListener("keydown", retry, true);
			window.removeEventListener("pagehide", finish);
			unsubscribe?.();
			stopOnRecording?.();
			toggleRef.current = undefined;
		};
	}, []);

	const audible = sound === "audible";
	const label = t(audible ? "muteMusic" : "unmuteMusic");
	const SoundIcon = audible ? SpeakerHigh : SpeakerX;
	return (
		<>
			<audio ref={audioRef} src={ONBOARDING_DEMO_URL} preload="auto" />
			{sound && (
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
						className="text-foreground/65"
						onPress={() => toggleRef.current?.()}
					>
						<SoundIcon className="size-4" aria-hidden="true" />
					</Button>
				</div>
			)}
		</>
	);
}
