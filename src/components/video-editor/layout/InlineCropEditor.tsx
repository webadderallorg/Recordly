import { LockKey } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowCounterClockwise, CaretDown, Check, Crop } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/contexts/I18nContext";
import { CropControl } from "../CropControl";
import { fitCropRatio } from "../cropGeometry";
import type { CropRegion } from "../types";
import { CropPixelFields } from "./CropPixelFields";
import "./InlineCropEditor.css";

const presets = [
	{ label: "1:1", value: 1 },
	{ label: "16:9", value: 16 / 9 },
	{ label: "9:16", value: 9 / 16 },
	{ label: "4:3", value: 4 / 3 },
];

type Props = {
	videoElement: HTMLVideoElement | null;
	cropRegion: CropRegion;
	onCropChange: (crop: CropRegion) => void;
	onCancel: () => void;
	onDone: () => void;
};

type RatioLock = (typeof presets)[number];

function parseCustomRatio(text: string): RatioLock | null {
	const match = text.trim().match(/^(\d+(?:[.,]\d+)?|[.,]\d+)\s*:\s*(\d+(?:[.,]\d+)?|[.,]\d+)$/);
	if (!match) return null;
	const width = Number(match[1].replace(",", "."));
	const height = Number(match[2].replace(",", "."));
	const value = width / height;
	return value >= 0.05 && value <= 20 ? { label: `${width}:${height}`, value } : null;
}

export function InlineCropEditor({
	videoElement,
	cropRegion,
	onCropChange,
	onCancel,
	onDone,
}: Props) {
	const { locale, t } = useI18n();
	const root = useRef<HTMLDivElement>(null);
	const cropBeforeRatioChange = useRef<CropRegion | null>(null);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [ratio, setRatio] = useState<RatioLock | null>(null);
	const [customText, setCustomText] = useState("");
	const [source, setSource] = useState(() => ({
		width: videoElement?.videoWidth ?? 0,
		height: videoElement?.videoHeight ?? 0,
	}));

	useEffect(() => {
		root.current?.focus();
	}, []);
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

	const sourceRatio = source.width && source.height ? source.width / source.height : 16 / 9;
	const cropRatio = (cropRegion.width * sourceRatio) / cropRegion.height;
	const formatRatio = (value: number) =>
		value.toLocaleString(locale, { maximumSignificantDigits: 3, useGrouping: false });
	const ratioLabel =
		ratio?.label ??
		presets.find(({ value }) => Math.abs(value - cropRatio) < 1e-6)?.label ??
		(cropRatio >= 1 ? `${formatRatio(cropRatio)}:1` : `1:${formatRatio(1 / cropRatio)}`);
	const dimensions =
		source.width && source.height
			? `${Math.round(cropRegion.width * source.width)} × ${Math.round(cropRegion.height * source.height)} px`
			: "—";
	const customRatio = parseCustomRatio(customText);
	const activePreset = ratio
		? presets.find(({ label }) => label === ratio.label)?.label
		: "freeform";
	const detailsLabel = t("settings.crop.details", "Crop details");
	const aspectRatioLabel = t("settings.crop.aspectRatio", "Aspect ratio");
	const customLabel = t("settings.crop.customRatio", "Custom");
	const freeformLabel = t("settings.crop.freeform", "Freeform");

	const editCrop = useCallback(
		(crop: CropRegion) => {
			cropBeforeRatioChange.current = null;
			onCropChange(crop);
		},
		[onCropChange],
	);

	function applyRatio(next: RatioLock | null) {
		setRatio(next);
		if (next) {
			// Fit each preset against the same crop until the user resizes or moves it manually.
			cropBeforeRatioChange.current ??= cropRegion;
			onCropChange(fitCropRatio(cropBeforeRatioChange.current, next.value, sourceRatio));
		} else {
			cropBeforeRatioChange.current = null;
		}
	}

	return (
		<div
			ref={root}
			tabIndex={-1}
			data-inline-crop
			role="group"
			aria-label={t("settings.crop.title")}
			className="inline-crop-editor absolute inset-0 z-30 flex flex-col bg-editor-bg outline-none"
			onKeyDown={(event) => {
				if (event.key === "Shift") return;
				event.stopPropagation();
				if (event.key === "Escape") {
					event.preventDefault();
					if (detailsOpen) setDetailsOpen(false);
					else onCancel();
				}
				if (event.key === "Enter" && event.target === event.currentTarget) {
					event.preventDefault();
					onDone();
				}
			}}
		>
			<div className="crop-toolbar">
				<div className="crop-toolbar__identity">
					<span className="crop-toolbar__title">
						<Crop
							className="size-4 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
						{t("settings.sections.crop", "Crop")}
					</span>
					<Popover open={detailsOpen} onOpenChange={setDetailsOpen} modal={false}>
						<Button
							size="sm"
							variant="ghost"
							className="crop-toolbar__dimensions"
							aria-label={`${detailsLabel} · ${dimensions} · ${ratioLabel} (${ratio ? aspectRatioLabel : freeformLabel})`}
						>
							<span>{dimensions}</span>
							<span className="flex items-center gap-1 text-muted-foreground">
								<span aria-hidden="true">·</span>
								{ratio && <LockKey className="size-3" aria-hidden="true" />}
								<span className="crop-toolbar__ratio">{ratioLabel}</span>
							</span>
							<CaretDown
								className="size-3 text-muted-foreground"
								aria-hidden="true"
							/>
						</Button>
						<PopoverContent
							side="left"
							align="start"
							className="w-72 rounded-xl p-3 [&_input]:border [&_input]:border-foreground/10"
							aria-label={detailsLabel}
						>
							<CropPixelFields
								source={source}
								crop={cropRegion}
								lockedRatio={ratio?.value ?? null}
								onCropChange={editCrop}
							/>
							<form
								className="mt-3 space-y-1.5 border-t border-border pt-3"
								onSubmit={(event) => {
									event.preventDefault();
									if (customRatio) applyRatio(customRatio);
								}}
							>
								<div className="flex items-end gap-2">
									<label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
										<span>{aspectRatioLabel}</span>
										<Input
											aria-label={`${customLabel} · ${aspectRatioLabel}`}
											className="h-8 min-w-0 flex-1 tabular-nums"
											placeholder="16:9"
											value={customText}
											onChange={(event) => setCustomText(event.target.value)}
										/>
									</label>
									<Button
										size="sm"
										variant="secondary"
										type="submit"
										disabled={!customRatio}
									>
										{t("common.actions.apply", "Apply")}
									</Button>
								</div>
								{customText.trim() && !customRatio && (
									<p className="text-xs text-muted-foreground">
										{t(
											"settings.crop.ratioHint",
											"Enter a ratio from 1:20 to 20:1, such as 16:9.",
										)}
									</p>
								)}
							</form>
						</PopoverContent>
					</Popover>
				</div>
				<ToggleGroup
					type="single"
					size="sm"
					aria-label={aspectRatioLabel}
					className="crop-toolbar__presets"
					value={activePreset ?? ""}
					disallowEmptySelection
					onValueChange={(choice) =>
						applyRatio(presets.find(({ label }) => label === choice) ?? null)
					}
				>
					<ToggleGroupItem value="freeform">{freeformLabel}</ToggleGroupItem>
					{presets.map(({ label }) => (
						<ToggleGroupItem key={label} value={label}>
							{label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
				<div className="crop-toolbar__actions">
					<Button
						size="sm"
						variant="ghost"
						isIconOnly
						title={t("common.actions.reset", "Reset")}
						className="size-8 min-w-0 px-0"
						onClick={() => {
							applyRatio(null);
							setCustomText("");
							editCrop({ x: 0, y: 0, width: 1, height: 1 });
						}}
					>
						<ArrowCounterClockwise className="size-4" aria-hidden="true" />
					</Button>
					<Button
						size="sm"
						variant="ghost"
						className="h-8 px-2.5 text-xs"
						onClick={onCancel}
					>
						{t("common.actions.cancel", "Cancel")}
					</Button>
					<Button size="sm" className="h-8 gap-1.5 px-2.5 text-xs" onClick={onDone}>
						<Check className="size-3.5" aria-hidden="true" />
						{t("common.actions.done", "Done")}
					</Button>
				</div>
			</div>
			<div className="crop-viewer">
				<CropControl
					videoElement={videoElement}
					cropRegion={cropRegion}
					onCropChange={editCrop}
					lockedRatio={ratio?.value ?? null}
				/>
			</div>
		</div>
	);
}
