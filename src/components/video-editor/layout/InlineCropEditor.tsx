import { useI18n as useUiLocale } from "@/contexts/I18nContext";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/contexts/I18nContext";
import { CropControl } from "../CropControl";
import { fitCropRatio } from "../cropGeometry";
import type { CropRegion } from "../types";

type Props = {
	videoElement: HTMLVideoElement | null;
	cropRegion: CropRegion;
	onCropChange: (crop: CropRegion) => void;
	onCancel: () => void;
	onDone: () => void;
};

export function InlineCropEditor({
	videoElement,
	cropRegion,
	onCropChange,
	onCancel,
	onDone,
}: Props) {
	useUiLocale();
	const { t } = useI18n();
	const root = useRef<HTMLDivElement>(null);
	const [ratioOpen, setRatioOpen] = useState(false);
	const [ratio, setRatio] = useState<number | null>(null);
	const [ratioLabel, setRatioLabel] = useState("");
	const [ratioWidth, setRatioWidth] = useState("16");
	const [ratioHeight, setRatioHeight] = useState("9");
	const width = Number(ratioWidth),
		height = Number(ratioHeight);
	const validRatio =
		Number.isFinite(width / height) &&
		width > 0 &&
		height > 0 &&
		width / height >= 0.05 &&
		width / height <= 20;
	useEffect(() => {
		root.current?.focus();
	}, []);
	const applyRatio = (next: number | null) => {
		setRatio(next);
		if (next) setRatioLabel(`${ratioWidth}:${ratioHeight}`);
		if (next)
			onCropChange(
				fitCropRatio(
					cropRegion,
					next,
					(videoElement?.videoWidth || 1920) / (videoElement?.videoHeight || 1080),
				),
			);
		setRatioOpen(false);
	};
	return (
		<div
			ref={root}
			tabIndex={-1}
			data-inline-crop
			role="group"
			aria-label={t("settings.crop.title")}
			className="absolute inset-0 z-30 flex flex-col gap-3 bg-editor-bg p-3 outline-none"
			onKeyDown={(event) => {
				if (ratioOpen || event.key === "Shift") return;
				event.stopPropagation();
				if (event.key === "Escape") {
					event.preventDefault();
					onCancel();
				}
				if (event.key === "Enter" && event.target === event.currentTarget) {
					event.preventDefault();
					onDone();
				}
			}}
		>
			<div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs">
				<span className="text-muted-foreground">
					{t(
						"settings.crop.inlineHint",
						"Drag edges or corners · Hold Shift for a square",
					)}
				</span>
				<div className="flex items-center gap-1">
					<Button size="sm" variant="ghost" onClick={() => setRatioOpen(true)}>
						{t("settings.crop.aspectRatio", "Aspect ratio")}
						{ratio ? ` · ${ratioLabel}` : ""}
					</Button>
					<Button
						size="sm"
						variant="ghost"
						onClick={() => {
							setRatio(null);
							onCropChange({ x: 0, y: 0, width: 1, height: 1 });
						}}
					>
						{t("common.actions.reset", "Reset")}
					</Button>
					<Button size="sm" variant="ghost" onClick={onCancel}>
						{t("common.actions.cancel", "Cancel")}
					</Button>
					<Button size="sm" onClick={onDone}>
						{t("common.actions.done", "Done")}
					</Button>
				</div>
			</div>
			<div
				className="flex min-h-0 flex-1 items-center justify-center p-2"
				style={{ containerType: "size" }}
			>
				<CropControl
					videoElement={videoElement}
					cropRegion={cropRegion}
					onCropChange={onCropChange}
					lockedRatio={ratio}
				/>
			</div>
			<Dialog open={ratioOpen} onOpenChange={setRatioOpen}>
				<DialogContent className="max-w-sm">
					<DialogTitle>{t("settings.crop.aspectRatio", "Aspect ratio")}</DialogTitle>
					<form
						className="flex flex-col gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							if (validRatio) applyRatio(width / height);
						}}
					>
						<div className="flex gap-2">
							{[
								["1", "1"],
								["16", "9"],
								["9", "16"],
								["4", "3"],
							].map(([w, h]) => (
								<Button
									key={w + h}
									type="button"
									size="sm"
									variant="ghost"
									onClick={() => {
										setRatioWidth(w);
										setRatioHeight(h);
									}}
								>
									{w}
									{":"}
									{h}
								</Button>
							))}
						</div>
						<div className="flex items-center gap-3">
							<label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
								{t("settings.crop.ratioWidth", "Width")}
								<Input
									type="number"
									min="0.01"
									step="any"
									required
									value={ratioWidth}
									onChange={(event) => setRatioWidth(event.target.value)}
								/>
							</label>
							<span className="pt-4">{":"}</span>
							<label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
								{t("settings.crop.ratioHeight", "Height")}
								<Input
									type="number"
									min="0.01"
									step="any"
									required
									value={ratioHeight}
									onChange={(event) => setRatioHeight(event.target.value)}
								/>
							</label>
						</div>
						<p className="text-xs text-muted-foreground">
							{t(
								"settings.crop.ratioHint",
								"Choose a preset or enter your own ratio (1:20 to 20:1).",
							)}
						</p>
						<div className="flex justify-end gap-2">
							<Button type="button" variant="ghost" onClick={() => applyRatio(null)}>
								{t("settings.crop.freeform", "Freeform")}
							</Button>
							<Button type="submit" disabled={!validRatio}>
								{t("common.actions.apply", "Apply")}
							</Button>
						</div>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
