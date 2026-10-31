import { Pause, Play, SpeakerHigh as Volume2, SpeakerX as VolumeX } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import { Surface } from "@heroui/react";
import { Slider } from "@/components/ui/slider";
import { Button } from "../ui/button";

interface PlaybackControlsProps {
	isPlaying: boolean;
	currentTime: number;
	duration: number;
	onTogglePlayPause: () => void;
	onSeek: (time: number) => void;
	volume: number;
	onVolumeChange: (volume: number) => void;
}

export default function PlaybackControls({
	isPlaying,
	currentTime,
	duration,
	onTogglePlayPause,
	onSeek,
	volume,
	onVolumeChange,
}: PlaybackControlsProps) {
	const t = useScopedT("editor");
	function formatTime(seconds: number) {
		if (!isFinite(seconds) || isNaN(seconds) || seconds < 0) return "0:00";
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, "0")}`;
	}

	return (
		<Surface className="flex items-center gap-3 p-2">
			<Button
				onClick={onTogglePlayPause}
				size="icon"
				variant="ghost"
				aria-label={isPlaying ? t("playback.pause") : t("playback.play")}
			>
				{isPlaying ? <Pause weight="fill" /> : <Play weight="fill" />}
			</Button>
			<span className="text-xs tabular-nums text-muted">{formatTime(currentTime)}</span>
			<Slider
				aria-label={t("playback.seek", "Playback position")}
				min={0}
				max={duration || 100}
				step={0.01}
				value={[currentTime]}
				onValueChange={([time]) => onSeek(time)}
				className="flex-1"
			/>
			<span className="text-xs tabular-nums text-muted">{formatTime(duration)}</span>
			{volume <= 0.001 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
			<Slider
				aria-label={t("playback.volume", "Volume")}
				min={0}
				max={1}
				step={0.01}
				value={[volume]}
				onValueChange={([volume]) => onVolumeChange(volume)}
				className="w-20"
			/>
		</Surface>
	);
}
