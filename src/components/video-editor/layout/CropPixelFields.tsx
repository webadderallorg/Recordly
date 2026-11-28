import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/contexts/I18nContext";
import { dragCrop } from "../cropGeometry";
import type { CropRegion } from "../types";

function CropPixelInput({
	label,
	value,
	dimension,
	minimum,
	onCommit,
}: {
	label: string;
	value: number;
	dimension: number;
	minimum: number;
	onCommit: (value: number) => void;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	return (
		<label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
			{label}
			<Input
				className="h-8 min-w-0 tabular-nums"
				type="number"
				inputMode="numeric"
				step={1}
				min={minimum}
				max={dimension}
				disabled={!dimension}
				value={draft ?? (dimension ? String(value) : "")}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={(event) => {
					const next = event.currentTarget.valueAsNumber;
					if (draft !== null && Number.isFinite(next) && next !== value)
						onCommit(Math.round(next));
					setDraft(null);
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.nativeEvent.isComposing) {
						event.preventDefault();
						event.currentTarget.blur();
					}
				}}
			/>
		</label>
	);
}

export function CropPixelFields({
	source,
	crop,
	lockedRatio,
	onCropChange,
}: {
	source: { width: number; height: number };
	crop: CropRegion;
	lockedRatio: number | null;
	onCropChange: (crop: CropRegion) => void;
}) {
	const { t } = useI18n();

	const fields = [
		{
			key: "width",
			handle: "e",
			axis: "width",
			label: t("settings.crop.ratioWidth", "Width"),
			min: 1,
		},
		{
			key: "height",
			handle: "s",
			axis: "height",
			label: t("settings.crop.ratioHeight", "Height"),
			min: 1,
		},
		{ key: "x", handle: "w", axis: "width", label: t("settings.crop.left", "Left"), min: 0 },
		{ key: "y", handle: "n", axis: "height", label: t("settings.crop.top", "Top"), min: 0 },
	] as const;

	return (
		<div
			role="group"
			aria-label={t("settings.crop.pixelFields", "Pixels")}
			className="grid grid-cols-2 gap-2"
		>
			{fields.map(({ key, handle, axis, label, min }) => (
				<CropPixelInput
					key={`${key}-${source.width}-${source.height}`}
					label={`${label} (px)`}
					value={Math.round(crop[key] * source[axis])}
					dimension={source.width && source.height ? source[axis] : 0}
					minimum={min}
					onCommit={(pixels) => {
						const delta = pixels / source[axis] - crop[key];
						onCropChange(
							dragCrop(
								crop,
								handle,
								axis === "width" ? delta : 0,
								axis === "height" ? delta : 0,
								lockedRatio,
								source.width / source.height,
							),
						);
					}}
				/>
			))}
		</div>
	);
}
