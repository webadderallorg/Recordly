import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SliderControl } from "../../SliderControl";

export function ClipSection({
	tSettings,
	t,
	selectedClipId,
	selectedClipSpeed,
	selectedClipMuted,
	selectedClipShowSourceAudio,
	hasClipSourceAudio,
	onClipSpeedChange,
	onClipMutedChange,
	onClipShowSourceAudioChange,
	sourceAudioTrackMeta,
	sourceAudioTrackSettings,
	onSourceAudioTrackVolumeChange,
	onSourceAudioTrackNormalizeChange,
	isInitialLoading = false,
}: {
	tSettings: (key: string, fallback?: string) => string;
	t: (key: string, fallback?: string) => string;
	selectedClipId?: string | null;
	selectedClipSpeed?: number | null;
	selectedClipMuted?: boolean | null;
	selectedClipShowSourceAudio?: boolean | null;
	hasClipSourceAudio?: boolean;
	onClipSpeedChange?: (speed: number) => void;
	onClipMutedChange?: (muted: boolean) => void;
	onClipShowSourceAudioChange?: (show: boolean) => void;
	sourceAudioTrackMeta: Array<{ id: string; label: string }>;
	sourceAudioTrackSettings: Record<string, { volume: number; normalize: boolean }>;
	onSourceAudioTrackVolumeChange?: (id: string, volume: number) => void;
	onSourceAudioTrackNormalizeChange?: (id: string, normalize: boolean) => void;
	isInitialLoading?: boolean;
}) {
	if (isInitialLoading) {
		return (
			<section className="flex flex-col gap-2 animate-in fade-in duration-200">
				<div className="flex items-center justify-between gap-3">
					<Skeleton className="h-3 w-12" variant="subtle" />
				</div>
				<Skeleton className="h-3 w-14" variant="subtle" />
				<div className="grid grid-cols-4 gap-1.5">
					{[...Array(8)].map((_, i) => (
						<Skeleton key={i} className="h-10 w-full rounded-lg" variant="subtle" animation="shimmer-premium" />
					))}
				</div>
				<div className="mt-2 flex flex-col gap-2 border-t border-foreground/5 pt-3">
					<Skeleton className="h-3 w-14" variant="subtle" />
					<Skeleton className="h-12 w-full rounded-lg" variant="subtle" animation="shimmer-premium" />
				</div>
			</section>
		);
	}

	return (
		<section className="flex flex-col gap-2 animate-in fade-in duration-300">
			<div className="flex items-center justify-between gap-3">
				<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{tSettings("clip.title", "Clip")}</p>
				{selectedClipSpeed != null && selectedClipSpeed !== 1 && <span className="rounded-full bg-[#06b6d4]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#06b6d4]">{selectedClipSpeed}×</span>}
			</div>
			<div className="flex items-center gap-3"><p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{tSettings("speed.label", "Speed")}</p></div>
			<div className="grid grid-cols-4 gap-1.5">
				{[{ speed: 0.25, label: "0.25×" },{ speed: 0.5, label: "0.5×" },{ speed: 0.75, label: "0.75×" },{ speed: 1, label: "1×" },{ speed: 1.25, label: "1.25×" },{ speed: 1.5, label: "1.5×" },{ speed: 2, label: "2×" },{ speed: 2.5, label: "2.5×" },{ speed: 3, label: "3×" },{ speed: 4, label: "4×" },{ speed: 5, label: "5×" },{ speed: 8, label: "8×" },{ speed: 10, label: "10×" },{ speed: 15, label: "15×" },{ speed: 20, label: "20×" },{ speed: 30, label: "30×" }].map((option) => {
					const isActive = selectedClipSpeed === option.speed;
					return <Button key={option.speed} type="button" onClick={() => onClipSpeedChange?.(option.speed)} className={cn("h-auto w-full rounded-lg border px-0.5 py-2 text-center shadow-sm transition-all duration-200 ease-out cursor-pointer", isActive ? "border-[#06b6d4] bg-[#06b6d4] text-white" : "border-foreground/5 bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:border-foreground/10 hover:text-foreground")}><span className="text-[10px] font-semibold">{option.label}</span></Button>;
				})}
			</div>
			<div className="mt-2 flex flex-col gap-2 border-t border-foreground/5 pt-3">
				<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{tSettings("audio.title", "Audio")}</p>
				<div className="flex items-center justify-between rounded-lg bg-foreground/[0.03] px-2.5 py-1.5"><div><span className="text-[10px] text-muted-foreground">{tSettings("clip.mute", "Mute")}</span><p className="text-[9px] text-muted-foreground/50 mt-0.5">{selectedClipMuted ? tSettings("clip.mutedState", "Audio is muted") : tSettings("clip.unmutedState", "Audio is playing")}</p></div><Switch checked={selectedClipMuted ?? false} onCheckedChange={(v) => onClipMutedChange?.(v)} className="data-[state=checked]:bg-[#06b6d4] scale-75" /></div>
				{hasClipSourceAudio && <div className="flex items-center justify-between rounded-lg bg-foreground/[0.03] px-2.5 py-1.5"><span className="text-[10px] text-muted-foreground">{tSettings("clip.separateClipFromAudio", "Separate clip from audio")}</span><Switch checked={selectedClipShowSourceAudio ?? false} onCheckedChange={(v) => onClipShowSourceAudioChange?.(v)} className="data-[state=checked]:bg-[#06b6d4] scale-75" /></div>}
			</div>
			{selectedClipId && hasClipSourceAudio && sourceAudioTrackMeta.length > 0 && <div className="mt-1 flex flex-col gap-3">{sourceAudioTrackMeta.map((track) => { const settings = sourceAudioTrackSettings[track.id] ?? { volume: 1, normalize: false }; return <div key={track.id} className="rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3 py-2"><div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-medium text-foreground">{track.label}</span><button type="button" onClick={() => { onSourceAudioTrackVolumeChange?.(track.id, 1); onSourceAudioTrackNormalizeChange?.(track.id, false); }} className="text-[10px] text-[#2563EB] transition-opacity hover:opacity-80">{t("common.actions.reset", "Reset")}</button></div><div className="mb-2 flex items-center justify-between rounded-lg bg-foreground/[0.03] px-2.5 py-1.5"><span className="text-[10px] text-muted-foreground">{tSettings("audio.normalize", "Normalize")}</span><Switch checked={settings.normalize} onCheckedChange={(v) => onSourceAudioTrackNormalizeChange?.(track.id, v)} className="data-[state=checked]:bg-[#06b6d4] scale-75" /></div><SliderControl label={tSettings("audio.volume", "Volume")} value={settings.volume} defaultValue={1} min={0} max={1} step={0.01} onChange={(v) => onSourceAudioTrackVolumeChange?.(track.id, v)} formatValue={(v) => `${Math.round(v * 100)}%`} parseInput={(text) => parseFloat(text.replace(/%$/, "")) / 100} /></div>; })}</div>}
		</section>
	);
}
