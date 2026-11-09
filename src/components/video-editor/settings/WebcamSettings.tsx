import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceGroup, ChoiceItem } from "@/components/ui/choice-group";
import { FolderSimple, UploadSimple as Upload, VideoCamera } from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { SliderControl } from "../SliderControl";
import {
	DEFAULT_CROP_REGION,
	DEFAULT_WEBCAM_MARGIN,
	DEFAULT_WEBCAM_POSITION_PRESET,
	DEFAULT_WEBCAM_POSITION_X,
	DEFAULT_WEBCAM_POSITION_Y,
	DEFAULT_WEBCAM_REACT_TO_ZOOM,
	DEFAULT_WEBCAM_ROUNDNESS,
	DEFAULT_WEBCAM_SHADOW,
	DEFAULT_WEBCAM_SIZE,
	type WebcamOverlaySettings,
	type WebcamPositionPreset,
	type WebcamShape,
} from "../types";
import { WebcamCropControl } from "../WebcamCropControl";
import {
	getCropMatchedWebcamHeightPercent,
	getWebcamPositionForPreset,
	normalizeWebcamCropRegion,
	resolveWebcamCorner,
} from "../webcamOverlay";

interface WebcamSettingsProps {
	advanced: boolean;
	webcam?: WebcamOverlaySettings;
	webcamPreviewSrc: string | null;
	webcamPreviewCurrentTime: number;
	webcamPreviewPlaying: boolean;
	onWebcamChange?: (webcam: WebcamOverlaySettings) => void;
	onUploadWebcam?: () => void;
}

const WEBCAM_POSITION_PRESETS: Array<{
	preset: Exclude<WebcamPositionPreset, "custom">;
	label: string;
}> = [
	{ preset: "top-left", label: "Top left" },
	{ preset: "top-center", label: "Top center" },
	{ preset: "top-right", label: "Top right" },
	{ preset: "center-left", label: "Center left" },
	{ preset: "center", label: "Center" },
	{ preset: "center-right", label: "Center right" },
	{ preset: "bottom-left", label: "Bottom left" },
	{ preset: "bottom-center", label: "Bottom center" },
	{ preset: "bottom-right", label: "Bottom right" },
];

function WebcamShapePreview({ shape }: { shape: WebcamShape }) {
	const clipId = useId();
	const frame =
		shape === "circle" ? (
			<circle cx="32" cy="24" r="15" />
		) : shape === "squircle" ? (
			<rect x="17" y="9" width="30" height="30" rx="6" />
		) : (
			<rect x="8" y="10.5" width="48" height="27" rx="5.4" />
		);
	return (
		<svg viewBox="0 0 64 48" className="h-12 w-16" aria-hidden="true">
			<defs>
				<clipPath id={clipId}>{frame}</clipPath>
			</defs>
			<g fill="currentColor" fillOpacity="0.1">
				{frame}
			</g>
			<g clipPath={`url(#${clipId})`} fill="currentColor" opacity="0.55">
				<circle cx="32" cy="20" r="5.8" />
				<path d="M17 43v-4c0-7.8 6.7-12 15-12s15 4.2 15 12v4Z" />
			</g>
		</svg>
	);
}

function WebcamSourceButton({
	sourcePath,
	onChangeSource,
}: {
	sourcePath: string;
	onChangeSource?: () => void;
}) {
	const tSettings = useScopedT("settings");
	const [sourceOpen, setSourceOpen] = useState(false);
	const webcamFileName = sourcePath.split(/[\\/]/).pop();
	return (
		<Popover open={sourceOpen} onOpenChange={setSourceOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="secondary"
					size="icon"
					className="size-9 shrink-0 rounded-xl"
					aria-label={tSettings("effects.webcamSource", "Webcam source")}
					title={tSettings("effects.webcamSource", "Webcam source")}
				>
					<FolderSimple weight="fill" className="size-4" aria-hidden="true" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-72 space-y-3"
				aria-label={tSettings("effects.webcamSource", "Webcam source")}
			>
				<div className="space-y-1.5">
					<p className="break-all text-xs font-medium">{webcamFileName}</p>
					<p className="select-text break-all text-xs leading-relaxed text-muted-foreground">
						{sourcePath}
					</p>
				</div>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					className="w-full gap-2"
					disabled={!onChangeSource}
					onPress={() => {
						setSourceOpen(false);
						onChangeSource?.();
					}}
				>
					<Upload className="size-3.5" aria-hidden="true" />
					{tSettings("effects.changeWebcamSource", "Change source")}
				</Button>
			</PopoverContent>
		</Popover>
	);
}

export function WebcamSettings({
	advanced,
	webcam,
	webcamPreviewSrc,
	webcamPreviewCurrentTime,
	webcamPreviewPlaying,
	onWebcamChange,
	onUploadWebcam,
}: WebcamSettingsProps) {
	const tSettings = useScopedT("settings");
	const { t } = useI18n();
	const webcamFileName = webcam?.sourcePath?.split(/[\\/]/).pop() ?? null;
	const webcamPositionPreset = webcam?.positionPreset ?? DEFAULT_WEBCAM_POSITION_PRESET;
	const webcamPositionX = webcam?.positionX ?? DEFAULT_WEBCAM_POSITION_X;
	const webcamPositionY = webcam?.positionY ?? DEFAULT_WEBCAM_POSITION_Y;
	const webcamWidth = webcam?.width ?? webcam?.size ?? DEFAULT_WEBCAM_SIZE;
	const webcamHeight = webcam?.height ?? webcam?.size ?? DEFAULT_WEBCAM_SIZE;
	const webcamCrop = normalizeWebcamCropRegion(webcam?.cropRegion);

	const updateWebcam = (patch: Partial<WebcamOverlaySettings>) => {
		if (!webcam || !onWebcamChange) return;
		onWebcamChange({ ...webcam, ...patch });
	};

	const applyWebcamPositionPreset = (preset: WebcamPositionPreset) => {
		if (!webcam) return;

		if (preset === "custom") {
			updateWebcam({ positionPreset: "custom" });
			return;
		}

		const position = getWebcamPositionForPreset(preset);
		updateWebcam({
			positionPreset: preset,
			positionX: position.x,
			positionY: position.y,
			corner: resolveWebcamCorner(preset, webcam.corner),
		});
	};

	if (!webcam?.sourcePath) {
		return (
			<section className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-default/40 px-5 py-6 text-center">
				<div className="flex size-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
					<VideoCamera className="size-5" aria-hidden="true" />
				</div>
				<p className="text-sm font-medium">
					{tSettings("effects.addWebcamVideo", "Add a webcam video")}
				</p>
				<p className="text-xs leading-relaxed text-muted-foreground">
					{tSettings(
						"effects.webcamVideoHint",
						"Use your recorded camera or add a video to appear alongside your screen.",
					)}
				</p>
				<Button
					type="button"
					variant="outline"
					onClick={onUploadWebcam}
					disabled={!onUploadWebcam}
					className="w-full gap-2"
				>
					<Upload className="size-4" aria-hidden="true" />
					{tSettings("effects.uploadWebcamFootage")}
				</Button>
			</section>
		);
	}

	return (
		<section className="flex flex-col gap-5" data-webcam-settings>
			{advanced && (
				<div className="flex min-w-0 items-center gap-2.5" data-webcam-source>
					<WebcamSourceButton
						sourcePath={webcam.sourcePath}
						onChangeSource={onUploadWebcam}
					/>
					<p
						className="min-w-0 flex-1 truncate text-xs font-medium"
						title={webcamFileName ?? undefined}
					>
						{webcamFileName}
					</p>
					<Switch
						aria-label={tSettings("effects.show", "Show")}
						checked={webcam.enabled}
						onCheckedChange={(enabled) => updateWebcam({ enabled })}
					/>
				</div>
			)}
			<div className="flex flex-col gap-3">
				{advanced && (
					<>
						<div className="flex items-center justify-between py-2">
							<span className="text-xs text-muted-foreground">
								{tSettings("effects.webcamReactToZoom")}
							</span>
							<Switch
								aria-label={tSettings("effects.webcamReactToZoom")}
								checked={webcam?.reactToZoom ?? DEFAULT_WEBCAM_REACT_TO_ZOOM}
								onCheckedChange={(reactToZoom) => updateWebcam({ reactToZoom })}
							/>
						</div>
						<div className="flex items-center justify-between py-2">
							<span className="text-xs text-muted-foreground">
								{tSettings("effects.webcamMirror", "Mirror webcam")}
							</span>
							<Switch
								aria-label={tSettings("effects.webcamMirror", "Mirror webcam")}
								checked={webcam?.mirror ?? true}
								onCheckedChange={(mirror) => updateWebcam({ mirror })}
							/>
						</div>
					</>
				)}
				<div className="w-full py-1">
					<ChoiceGroup
						aria-label={tSettings("effects.webcamPosition", "Position")}
						value={webcamPositionPreset}
						onValueChange={(value) =>
							applyWebcamPositionPreset(value as WebcamPositionPreset)
						}
						className="grid w-full grid-cols-3 gap-1 rounded-xl border border-border bg-default/50 p-1.5"
					>
						{WEBCAM_POSITION_PRESETS.map((option) => (
							<ChoiceItem
								key={option.preset}
								value={option.preset}
								aria-label={tSettings(
									`effects.webcamPositions.${option.preset}`,
									option.label,
								)}
								textValue={tSettings(
									`effects.webcamPositions.${option.preset}`,
									option.label,
								)}
								className="!h-6 !min-h-0 !rounded-md !border-0 !p-0"
							>
								<span
									aria-hidden="true"
									className={`size-2 rounded-full ${webcamPositionPreset === option.preset ? "bg-accent" : "bg-foreground/25"}`}
								/>
							</ChoiceItem>
						))}
					</ChoiceGroup>
				</div>

				{advanced ? (
					<>
						<SliderControl
							label={tSettings("effects.webcamHorizontal", "Horizontal")}
							value={webcamPositionX * 100}
							min={0}
							max={100}
							step={1}
							onChange={(v) =>
								updateWebcam({
									positionPreset: "custom",
									positionX: v / 100,
								})
							}
							formatValue={(v) => `${Math.round(v)}%`}
						/>
						<SliderControl
							label={tSettings("effects.webcamVertical", "Vertical")}
							value={webcamPositionY * 100}
							min={0}
							max={100}
							step={1}
							onChange={(v) =>
								updateWebcam({
									positionPreset: "custom",
									positionY: v / 100,
								})
							}
							formatValue={(v) => `${Math.round(v)}%`}
						/>
					</>
				) : null}
				<div className="flex flex-col gap-2">
					<ChoiceGroup
						type="single"
						aria-label={tSettings("effects.webcamShape", "Shape")}
						value={webcam?.shape ?? "squircle"}
						className="grid grid-cols-3 gap-2"
						onValueChange={(shape) => {
							if (shape === "circle" || shape === "squircle" || shape === "rectangle")
								updateWebcam({
									shape,
									width:
										shape === "rectangle"
											? DEFAULT_WEBCAM_SIZE * (16 / 9)
											: DEFAULT_WEBCAM_SIZE,
									size:
										shape === "rectangle"
											? DEFAULT_WEBCAM_SIZE * (16 / 9)
											: DEFAULT_WEBCAM_SIZE,
									height: DEFAULT_WEBCAM_SIZE,
								});
						}}
					>
						{(
							[
								["circle", "webcamCircle", "Circle"],
								["squircle", "webcamSquircle", "Square"],
								["rectangle", "webcamRectangle", "Rectangle"],
							] as const
						).map(([shape, key, label]) => (
							<ChoiceItem
								key={shape}
								value={shape}
								aria-label={tSettings(`effects.${key}`, label)}
								title={tSettings(`effects.${key}`, label)}
								className="!h-16 !p-0 !rounded-xl"
							>
								<WebcamShapePreview shape={shape} />
							</ChoiceItem>
						))}
					</ChoiceGroup>
				</div>
				{advanced && (
					<SliderControl
						label={tSettings("effects.webcamWidth", "Webcam Width")}
						value={webcamWidth}
						min={10}
						max={100}
						step={1}
						onChange={(v) =>
							updateWebcam({
								width: v,
								size: v,
								...(webcam?.shape === "squircle" ? { height: v } : {}),
							})
						}
						formatValue={(v) => `${Math.round(v)}%`}
					/>
				)}
				{advanced && webcam?.shape !== "circle" && (
					<SliderControl
						label={tSettings("effects.webcamHeight", "Webcam Height")}
						value={webcamHeight}
						min={10}
						max={100}
						step={1}
						onChange={(v) => updateWebcam({ height: v })}
						formatValue={(v) => `${Math.round(v)}%`}
					/>
				)}
				{advanced && (
					<div className="py-2">
						<div className="mb-2 flex items-center justify-between gap-2">
							<div className="text-xs text-muted-foreground">
								{tSettings("effects.webcamCrop", "Crop")}
							</div>
							<Button
								className="text-xs text-muted"
								size="sm"
								variant="ghost"
								type="button"
								onClick={() => updateWebcam({ cropRegion: DEFAULT_CROP_REGION })}
							>
								{t("common.actions.reset", "Reset")}
							</Button>
						</div>
						<div className="mx-auto w-full max-w-56">
							<WebcamCropControl
								cropRegion={webcamCrop}
								mirrored={webcam?.mirror ?? true}
								previewSrc={webcamPreviewSrc}
								previewCurrentTime={webcamPreviewCurrentTime}
								previewPlaying={webcamPreviewPlaying}
								previewTimeOffsetMs={webcam?.timeOffsetMs}
								onCropChange={(cropRegion, previewFrame) =>
									updateWebcam({
										cropRegion,
										height: previewFrame
											? getCropMatchedWebcamHeightPercent(
													webcamWidth,
													webcamHeight,
													previewFrame.width,
													previewFrame.height,
													cropRegion,
													webcam?.shape,
												)
											: webcamHeight,
									})
								}
							/>
						</div>
					</div>
				)}
				{advanced && (
					<SliderControl
						label={tSettings("effects.webcamMargin", "Margin")}
						value={webcam?.margin ?? DEFAULT_WEBCAM_MARGIN}
						min={0}
						max={96}
						step={1}
						onChange={(v) => updateWebcam({ margin: v })}
						formatValue={(v) => `${Math.round(v)}px`}
					/>
				)}
				{advanced && webcam?.shape !== "circle" && (
					<SliderControl
						label={tSettings("effects.webcamRoundness")}
						value={webcam?.roundness ?? DEFAULT_WEBCAM_ROUNDNESS}
						min={0}
						max={100}
						step={1}
						onChange={(v) => updateWebcam({ roundness: v })}
						formatValue={(v) => `${Math.round(v)}%`}
					/>
				)}
				{advanced && (
					<SliderControl
						label={tSettings("effects.webcamShadow")}
						value={webcam?.shadow ?? DEFAULT_WEBCAM_SHADOW}
						min={0}
						max={1}
						step={0.01}
						onChange={(v) => updateWebcam({ shadow: v })}
						formatValue={(v) => `${Math.round(v * 100)}%`}
					/>
				)}
			</div>
		</section>
	);
}
