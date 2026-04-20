import { Trash as Trash2 } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useScopedT } from "../../../contexts/I18nContext";
import { SectionLabel } from "../settingsPanelConstants";

interface ClipSectionProps {
	selectedClipId?: string | null;
	selectedClipSpeed?: number | null;
	selectedClipMuted?: boolean | null;
	onClipSpeedChange?: (speed: number) => void;
	onClipMutedChange?: (muted: boolean) => void;
	onClipDelete?: (id: string) => void;
}

const SPEED_OPTIONS = [
	{ speed: 0.25, label: "0.25×" },
	{ speed: 0.5, label: "0.5×" },
	{ speed: 0.75, label: "0.75×" },
	{ speed: 1, label: "1×" },
	{ speed: 1.25, label: "1.25×" },
	{ speed: 1.5, label: "1.5×" },
	{ speed: 2, label: "2×" },
	{ speed: 2.5, label: "2.5×" },
	{ speed: 3, label: "3×" },
	{ speed: 4, label: "4×" },
	{ speed: 5, label: "5×" },
	{ speed: 8, label: "8×" },
	{ speed: 10, label: "10×" },
	{ speed: 15, label: "15×" },
	{ speed: 20, label: "20×" },
	{ speed: 30, label: "30×" },
];

export function ClipSection({
	selectedClipId,
	selectedClipSpeed,
	selectedClipMuted,
	onClipSpeedChange,
	onClipMutedChange,
	onClipDelete,
}: ClipSectionProps) {
	const tSettings = useScopedT("settings");

	return (
		<section className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-3">
				<SectionLabel>{tSettings("clip.title", "Clip")}</SectionLabel>
				{selectedClipSpeed != null && selectedClipSpeed !== 1 && (
					<span className="rounded-full bg-[#06b6d4]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#06b6d4]">
						{selectedClipSpeed}×
					</span>
				)}
			</div>
			<div className="flex items-center justify-between rounded-lg bg-foreground/[0.03] px-2.5 py-1.5">
				<span className="text-[10px] text-muted-foreground">
					{tSettings("clip.muteAudio", "Mute Audio")}
				</span>
				<Switch checked={selectedClipMuted ?? false}
					onCheckedChange={(v) => onClipMutedChange?.(v)}
					className="data-[state=checked]:bg-[#06b6d4] scale-75" />
			</div>
			<div className="flex items-center gap-3">
				<SectionLabel>{tSettings("speed.label", "Speed")}</SectionLabel>
			</div>
			<div className="grid grid-cols-4 gap-1.5">
				{SPEED_OPTIONS.map((option) => {
					const isActive = selectedClipSpeed === option.speed;
					return (
						<Button key={option.speed} type="button"
							onClick={() => onClipSpeedChange?.(option.speed)}
							className={cn(
								"h-auto w-full rounded-lg border px-0.5 py-2 text-center shadow-sm transition-all duration-200 ease-out cursor-pointer",
								isActive
									? "border-[#06b6d4] bg-[#06b6d4] text-white"
									: "border-foreground/5 bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:border-foreground/10 hover:text-foreground",
							)}>
							<span className="text-[10px] font-semibold">{option.label}</span>
						</Button>
					);
				})}
			</div>
			{selectedClipId && (
				<Button onClick={() => { if (selectedClipId && onClipDelete) onClipDelete(selectedClipId); }}
					variant="destructive" size="sm"
					className="mt-1 h-8 w-full gap-2 border border-red-500/20 bg-red-500/10 text-xs text-red-400 transition-all hover:border-red-500/30 hover:bg-red-500/20">
					<Trash2 className="h-3 w-3" />
					{tSettings("clip.delete", "Delete Clip")}
				</Button>
			)}
		</section>
	);
}
