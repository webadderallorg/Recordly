import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
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

	function handleSeekChange(e: React.ChangeEvent<HTMLInputElement>) {
		onSeek(parseFloat(e.target.value));
	}

	function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
		onVolumeChange(Number(e.target.value));
	}

	const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

	return (
		<div className="flex items-center gap-2 px-1.5 pr-3 py-0.5 rounded-full bg-black/75 backdrop-blur-md border border-white/10 transition-colors duration-300 hover:bg-black/80 hover:border-white/20">
			<Button
				onClick={onTogglePlayPause}
				size="icon"
				className={cn(
					"w-8 h-8 rounded-full transition-all duration-200 border border-white/10",
					isPlaying
						? "bg-white/10 text-white hover:bg-white/20"
						: "bg-white text-black hover:bg-white/90",
				)}
				aria-label={isPlaying ? t("playback.pause") : t("playback.play")}
			>
				{isPlaying ? (
					<Pause className="w-3.5 h-3.5 fill-current" />
				) : (
					<Play className="w-3.5 h-3.5 fill-current ml-0.5" />
				)}
			</Button>

			<span className="text-[9px] font-medium text-slate-300 tabular-nums w-[30px] text-right">
				{formatTime(currentTime)}
			</span>

			<div className="flex-1 relative h-6 flex items-center group">
				{/* Custom Track Background */}
				<div className="absolute left-0 right-0 h-0.5 bg-white/10 rounded-full overflow-hidden">
					<div className="h-full bg-[#2563EB] rounded-full" style={{ width: `${progress}%` }} />
				</div>

				{/* Interactive Input */}
				<input
					type="range"
					min="0"
					max={duration || 100}
					value={currentTime}
					onChange={handleSeekChange}
					step="0.01"
					className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
				/>

				{/* Custom Thumb (visual only, follows progress) */}
				<div
					className="absolute w-2.5 h-2.5 bg-white rounded-full pointer-events-none group-hover:scale-125 transition-transform duration-100"
					style={{
						left: `${progress}%`,
						transform: "translateX(-50%)",
					}}
				/>
			</div>

			<span className="text-[9px] font-medium text-slate-500 tabular-nums w-[30px]">
				{formatTime(duration)}
			</span>

			<div className="flex items-center gap-1.5 pl-1">
				{volume <= 0.001 ? (
					<VolumeX className="h-3.5 w-3.5 text-slate-400" />
				) : (
					<Volume2 className="h-3.5 w-3.5 text-slate-400" />
				)}
				<div className="group relative flex h-6 w-20 items-center">
					<div className="absolute left-0 right-0 h-0.5 rounded-full bg-white/10 overflow-hidden">
						<div className="h-full rounded-full bg-white/70" style={{ width: `${volume * 100}%` }} />
					</div>
					<input
						type="range"
						min="0"
						max="1"
						step="0.01"
						value={volume}
						onChange={handleVolumeChange}
						className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
					/>
					<div
						className="pointer-events-none absolute h-2.5 w-2.5 rounded-full bg-white transition-transform duration-100 group-hover:scale-125"
						style={{ left: `${volume * 100}%`, transform: "translateX(-50%)" }}
					/>
				</div>
			</div>
		</div>
	);
}
