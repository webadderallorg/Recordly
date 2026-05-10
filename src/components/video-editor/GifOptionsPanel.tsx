import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useScopedT } from "@/contexts/I18nContext";
import {
	GIF_FRAME_RATES,
	GIF_SIZE_PRESETS,
	type GifFrameRate,
	type GifSizePreset,
} from "@/lib/exporter/types";

interface GifOptionsPanelProps {
	frameRate: GifFrameRate;
	onFrameRateChange: (rate: GifFrameRate) => void;
	loop: boolean;
	onLoopChange: (loop: boolean) => void;
	sizePreset: GifSizePreset;
	onSizePresetChange: (preset: GifSizePreset) => void;
	outputDimensions: { width: number; height: number };
	disabled?: boolean;
}

export function GifOptionsPanel({
	frameRate,
	onFrameRateChange,
	loop,
	onLoopChange,
	sizePreset,
	onSizePresetChange,
	outputDimensions,
	disabled = false,
}: GifOptionsPanelProps) {
	const t = useScopedT("editor");
	const sizePresetOptions = Object.entries(GIF_SIZE_PRESETS).map(([key, value]) => ({
		value: key as GifSizePreset,
		label: value.label,
	}));

	return (
		<div className="space-y-4 animate-in slide-in-from-bottom-2 duration-200">
			{/* Frame Rate */}
			<div className="space-y-2">
				<label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
					{t("gifOptions.frameRate")}
				</label>
				<Select
					value={String(frameRate)}
					onValueChange={(value) => onFrameRateChange(Number(value) as GifFrameRate)}
					disabled={disabled}
				>
					<SelectTrigger className="w-full bg-foreground/5 border-foreground/10 text-foreground hover:bg-foreground/10">
						<SelectValue />
					</SelectTrigger>
					<SelectContent className="bg-editor-surface-alt border-foreground/10 z-[100]">
						{GIF_FRAME_RATES.map((rate) => (
							<SelectItem
								key={rate.value}
								value={String(rate.value)}
								className="text-foreground focus:bg-foreground/10 focus:text-foreground"
							>
								{rate.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{/* Size Preset */}
			<div className="space-y-2">
				<label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
					{t("gifOptions.outputSize")}
				</label>
				<Select
					value={sizePreset}
					onValueChange={(value) => onSizePresetChange(value as GifSizePreset)}
					disabled={disabled}
				>
					<SelectTrigger className="w-full bg-foreground/5 border-foreground/10 text-foreground hover:bg-foreground/10">
						<SelectValue />
					</SelectTrigger>
					<SelectContent className="bg-editor-surface-alt border-foreground/10 z-[100]">
						{sizePresetOptions.map((option) => (
							<SelectItem
								key={option.value}
								value={option.value}
								className="text-foreground focus:bg-foreground/10 focus:text-foreground"
							>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<div className="text-xs text-muted-foreground/70">
					{t("gifOptions.outputDimensions", undefined, {
						width: String(outputDimensions.width),
						height: String(outputDimensions.height),
					})}
				</div>
			</div>

			{/* Loop Toggle */}
			<div className="flex items-center justify-between py-2">
				<div>
					<label className="text-sm font-medium text-foreground">
						{t("gifOptions.loopAnimation")}
					</label>
					<p className="text-xs text-muted-foreground/70">
						{t("gifOptions.loopDescription")}
					</p>
				</div>
				<Switch checked={loop} onCheckedChange={onLoopChange} disabled={disabled} />
			</div>
		</div>
	);
}
