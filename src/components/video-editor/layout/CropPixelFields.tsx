import { useEffect, useState } from "react";
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
				className="h-7 min-w-0 tabular-nums"
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
	videoElement,
	crop,
	lockedRatio,
	onCropChange,
}: {
	videoElement: HTMLVideoElement | null;
	crop: CropRegion;
	lockedRatio: number | null;
	onCropChange: (crop: CropRegion) => void;
}) {
	const { t } = useI18n();
	const [source, setSource] = useState(() => ({
		width: videoElement?.videoWidth ?? 0,
		height: videoElement?.videoHeight ?? 0,
	}));
	useEffect(() => {
		const updateSource = () => {
			setSource({
				width: videoElement?.videoWidth ?? 0,
				height: videoElement?.videoHeight ?? 0,
			});
		};
		updateSource();
		videoElement?.addEventListener("loadedmetadata", updateSource);
		videoElement?.addEventListener("resize", updateSource);
		return () => {
			videoElement?.removeEventListener("loadedmetadata", updateSource);
			videoElement?.removeEventListener("resize", updateSource);
		};
	}, [videoElement]);

	const fields = [
		{ key: "x", handle: "w", axis: "width", label: t("settings.crop.left", "Left"), min: 0 },
		{ key: "y", handle: "n", axis: "height", label: t("settings.crop.top", "Top"), min: 0 },
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
	] as const;

	return (
		<div className="mx-auto grid w-full max-w-md shrink-0 grid-cols-4 gap-2">
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
