import { Volume2, VolumeX, Trash2, Music } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { generateWaveform } from "@/utils/audioWaveform";
import { useEffect, useState } from "react";
import type { AudioRegion } from "./types";

interface AudioSettingsPanelProps {
  audio: AudioRegion;
  onVolumeChange: (volume: number) => void;
  onMutedChange: (muted: boolean) => void;
  onSoloedChange: (soloed: boolean) => void;
  onFadeInMsChange: (ms: number) => void;
  onFadeOutMsChange: (ms: number) => void;
  onDelete: () => void;
}

function formatFadeTime(ms: number): string {
  if (ms === 0) return "Off";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function AudioSettingsPanel({
  audio,
  onVolumeChange,
  onMutedChange,
  onSoloedChange,
  onFadeInMsChange,
  onFadeOutMsChange,
  onDelete,
}: AudioSettingsPanelProps) {
  const [waveform, setWaveform] = useState<number[] | null>(null);

  useEffect(() => {
    let active = true;
    if (audio.audioPath) {
      generateWaveform(audio.audioPath, 120).then(result => {
        if (active) setWaveform(result);
      });
    }
    return () => { active = false; };
  }, [audio.audioPath]);

  const clipDurationMs = audio.endMs - audio.startMs;
  const maxFadeMs = Math.max(0, Math.floor(clipDurationMs / 2));
  const volumePct = Math.round(audio.volume * 100);
  const isMaster = audio.id === "master";

  // Mute and Solo are mutually exclusive
  const handleMuteToggle = () => {
    const nextMuted = !audio.muted;
    onMutedChange(nextMuted);
    if (nextMuted && audio.soloed) onSoloedChange(false);
  };

  const handleSoloToggle = () => {
    const nextSoloed = !audio.soloed;
    onSoloedChange(nextSoloed);
    if (nextSoloed && audio.muted) onMutedChange(false);
  };

  return (
    <section className="flex flex-col gap-3 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-1">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400 shrink-0">
            <Music className="w-3.5 h-3.5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-100 leading-none">
              {isMaster ? "Original Audio" : "Audio Region"}
            </p>
            {!isMaster && (
              <p className="text-[10px] text-slate-500 mt-0.5 truncate max-w-[160px]">
                {audio.audioPath.split(/[\\/]/).pop()}
              </p>
            )}
            {isMaster && (
              <p className="text-[10px] text-slate-500 mt-0.5">
                Adjust the volume of the video's audio
              </p>
            )}
          </div>
        </div>
        <span className="text-[9px] uppercase tracking-widest font-semibold text-[#2563EB] bg-[#2563EB]/10 px-2 py-1 rounded-full shrink-0">
          Active
        </span>
      </div>

      {/* Waveform — only for audio regions with a dedicated audio path */}
      {waveform && !isMaster && (
        <div className="h-10 bg-white/[0.03] rounded-xl border border-white/5 flex items-center overflow-hidden relative">
          <div className="absolute inset-0 flex items-center pointer-events-none px-2">
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${waveform.length} 100`}
              preserveAspectRatio="none"
              className="text-purple-400 opacity-50"
            >
              {waveform.map((peak, i) => (
                <rect
                  key={i}
                  x={i}
                  y={50 - peak * 50}
                  width={0.8}
                  height={peak * 100}
                  fill="currentColor"
                  rx={0.2}
                />
              ))}
            </svg>
          </div>
        </div>
      )}

      {/* Mute / Solo — only for audio regions, not master */}
      {!isMaster && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleMuteToggle}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all",
              audio.muted
                ? "bg-red-500/15 border-red-500/30 text-red-400"
                : "bg-white/[0.03] border-white/[0.08] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
            )}
          >
            <VolumeX className="w-3.5 h-3.5 shrink-0" />
            <span>Mute</span>
          </button>
          <button
            type="button"
            onClick={handleSoloToggle}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all",
              audio.soloed
                ? "bg-amber-500/15 border-amber-500/30 text-amber-400"
                : "bg-white/[0.03] border-white/[0.08] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
            )}
          >
            <span className="text-[11px] font-bold w-3.5 text-center shrink-0">S</span>
            <span>Solo</span>
          </button>
        </div>
      )}

      {/* Volume */}
      <div className="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2.5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-xs font-medium text-slate-300">Volume</span>
          </div>
          <span
            className={cn(
              "text-[11px] tabular-nums font-semibold px-1.5 py-0.5 rounded-md",
              volumePct > 100
                ? "text-amber-400 bg-amber-500/10"
                : "text-[#2563EB] bg-[#2563EB]/10"
            )}
          >
            {volumePct}%
          </span>
        </div>
        <Slider
          value={[audio.volume * 100]}
          onValueChange={([value]) => onVolumeChange(value / 100)}
          min={0}
          max={200}
          step={1}
        />
        {volumePct > 100 && (
          <p className="text-[10px] text-amber-500/70 leading-snug">
            Amplifying above 100% may clip the audio.
          </p>
        )}
      </div>

      {/* Fades — only for audio regions */}
      {!isMaster && (
        <div className="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2.5 space-y-3">
          <span className="text-xs font-medium text-slate-300">Fades</span>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Fade In</span>
                <span className="text-[10px] tabular-nums text-slate-400 font-medium">{formatFadeTime(audio.fadeInMs || 0)}</span>
              </div>
              <Slider value={[audio.fadeInMs || 0]} onValueChange={([v]) => onFadeInMsChange(v)} min={0} max={maxFadeMs} step={50} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Fade Out</span>
                <span className="text-[10px] tabular-nums text-slate-400 font-medium">{formatFadeTime(audio.fadeOutMs || 0)}</span>
              </div>
              <Slider value={[audio.fadeOutMs || 0]} onValueChange={([v]) => onFadeOutMsChange(v)} min={0} max={maxFadeMs} step={50} />
            </div>
          </div>
        </div>
      )}

      {/* Delete — only for audio regions */}
      {!isMaster && (
        <Button
          onClick={onDelete}
          variant="ghost"
          size="sm"
          className="w-full gap-2 text-red-400/70 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all mt-1"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Remove Audio Region
        </Button>
      )}
    </section>
  );
}
