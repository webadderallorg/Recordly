import { Label } from "@heroui/react";
import { ChoiceGroup, ChoiceItem } from "@/components/ui/choice-group";
import { cn } from "@/lib/utils";
import {
	type CursorClickEffectStyle,
	type CursorStyle,
	DEFAULT_CURSOR_CLICK_EFFECT_COLOR,
} from "../types";
import type { CursorStylePreviewAsset } from "../videoPlayback/cursorRenderer";
import { getCursorStyleSizeMultiplier } from "../videoPlayback/uploadedCursorAssets";

const BUILTIN_CURSOR_PREVIEW_SIZE = 28;
const BUILTIN_CURSOR_PREVIEW_FRAME_SIZE = 48;

const CURSOR_CLICK_EFFECT_OPTIONS: Array<{
	id: CursorClickEffectStyle;
	label: string;
	description: string;
}> = [
	{
		id: "spotlight",
		label: "Spotlight",
		description: "A soft pulse that blooms behind the cursor on click.",
	},
	{
		id: "ripple",
		label: "Ripple",
		description: "A filled circle expands from the click point and gently fades away.",
	},
	{
		id: "echo",
		label: "Echo",
		description: "A pair of soft rings that spread outward with a cleaner pulse.",
	},
	{
		id: "burst",
		label: "Burst",
		description: "Short rays pop outward around the click point.",
	},
];

function CursorClickEffectPreview({ effect }: { effect: CursorClickEffectStyle }) {
	return (
		<div
			className="relative flex items-center justify-center"
			style={{
				color: DEFAULT_CURSOR_CLICK_EFFECT_COLOR,
				width: `${BUILTIN_CURSOR_PREVIEW_FRAME_SIZE}px`,
				height: `${BUILTIN_CURSOR_PREVIEW_FRAME_SIZE}px`,
			}}
		>
			{effect === "burst" ? (
				<svg className="absolute h-12 w-12" viewBox="0 0 48 48" aria-hidden="true">
					<g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
						{Array.from({ length: 10 }, (_, index) => (
							<path
								key={index}
								d="M24 10V15"
								transform={`rotate(${index * 36} 24 24)`}
							/>
						))}
					</g>
				</svg>
			) : null}
			{effect === "ripple" ? (
				<svg className="absolute h-12 w-12" viewBox="0 0 48 48" aria-hidden="true">
					<circle cx="24" cy="24" r="13" fill="currentColor" opacity="0.35" />
				</svg>
			) : null}
			{effect === "spotlight" ? (
				<svg className="absolute h-12 w-12" viewBox="0 0 48 48" aria-hidden="true">
					<g fill="none" stroke="currentColor">
						<circle cx="24" cy="24" r="13.5" strokeWidth="1.5" opacity="0.3" />
						<circle cx="24" cy="24" r="9.75" strokeWidth="1.7" opacity="0.56" />
					</g>
				</svg>
			) : null}
			{effect === "echo" ? (
				<svg className="absolute h-12 w-12" viewBox="0 0 48 48" aria-hidden="true">
					<g fill="none" stroke="currentColor">
						<circle cx="24" cy="24" r="9" strokeWidth="1.8" opacity="0.72" />
						<circle cx="24" cy="24" r="14.5" strokeWidth="1.5" opacity="0.4" />
						<circle
							cx="24"
							cy="24"
							r="4.25"
							fill="currentColor"
							opacity="0.22"
							stroke="none"
						/>
					</g>
				</svg>
			) : null}
		</div>
	);
}

export function CursorClickEffectCards({
	title,
	activeEffectId,
	onApply,
	tSettings,
}: {
	title: string;
	activeEffectId: CursorClickEffectStyle;
	onApply: (effectId: CursorClickEffectStyle) => void;
	tSettings: (key: string, fallback?: string) => string;
}) {
	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<Label>{title}</Label>
			</div>
			<ChoiceGroup
				type="single"
				allowDeselect
				value={activeEffectId === "none" ? "" : activeEffectId}
				onValueChange={(value) => {
					onApply((value || "none") as CursorClickEffectStyle);
				}}
				className="grid grid-cols-4 gap-2"
				aria-label={title}
			>
				{CURSOR_CLICK_EFFECT_OPTIONS.map((effect) => {
					const label = tSettings(
						`effects.cursorClickEffects.${effect.id}.label`,
						effect.label,
					);
					const description = tSettings(
						`effects.cursorClickEffects.${effect.id}.description`,
						effect.description,
					);

					return (
						<ChoiceItem
							key={effect.id}
							value={effect.id}
							aria-label={label}
							title={`${label} - ${description}`}
							className={cn("group aspect-square h-auto min-w-0 p-3 text-left")}
						>
							<div className="flex h-full flex-col items-center justify-between gap-3">
								<div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[8px] px-2 py-1.5">
									<CursorClickEffectPreview effect={effect.id} />
								</div>
							</div>
						</ChoiceItem>
					);
				})}
			</ChoiceGroup>
		</div>
	);
}

export function CursorStylePreview({
	style,
	previewUrls,
	frameSize = BUILTIN_CURSOR_PREVIEW_FRAME_SIZE,
	previewSize = BUILTIN_CURSOR_PREVIEW_SIZE,
}: {
	style: CursorStyle;
	previewUrls: Partial<Record<string, CursorStylePreviewAsset>>;
	frameSize?: number;
	previewSize?: number;
}) {
	return (
		<div
			className="flex items-center justify-center"
			style={{ width: frameSize, height: frameSize }}
		>
			{previewUrls[style] && (
				<img
					src={previewUrls[style].url}
					alt=""
					draggable={false}
					className="max-w-none"
					style={{
						height: previewSize * getCursorStyleSizeMultiplier(style),
						transform: `translate(${previewUrls[style].offsetX * previewSize * getCursorStyleSizeMultiplier(style)}px, ${previewUrls[style].offsetY * previewSize * getCursorStyleSizeMultiplier(style)}px)`,
						width: "auto",
						imageRendering: style === "pixel-hand" ? "pixelated" : "auto",
					}}
				/>
			)}
		</div>
	);
}
