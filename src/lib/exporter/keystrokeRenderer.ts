import {
	CAPTION_FONT_WEIGHT,
	getCaptionPadding,
	getCaptionScaledFontSize,
	getCaptionScaledRadius,
} from "@/components/video-editor/captionStyle";
import { getDefaultCaptionFontFamily } from "@/components/video-editor/types";
import type {
	KeycapGroup,
	KeystrokeOverlaySettings,
	KeystrokeTelemetryPoint,
} from "@/components/video-editor/videoPlayback/keystrokeOverlay/keystrokeTypes";
import { visibleKeycaps } from "@/components/video-editor/videoPlayback/keystrokeOverlay/visibleKeycaps";
import { drawSquircleOnCanvas } from "@/lib/geometry/squircle";

type MeasuredPill = {
	label: string;
	width: number;
};

type MeasuredGroup = {
	group: KeycapGroup;
	pills: MeasuredPill[];
	width: number;
};

function measureGroups(
	ctx: CanvasRenderingContext2D,
	groups: readonly KeycapGroup[],
	paddingX: number,
	pillGap: number,
): MeasuredGroup[] {
	return groups.map((group) => {
		const pills = group.labels.map((label) => ({
			label,
			width: ctx.measureText(label).width + paddingX * 2,
		}));
		const width = pills.reduce(
			(total, pill, index) => total + pill.width + (index > 0 ? pillGap : 0),
			0,
		);
		return { group, pills, width };
	});
}

function drawGroupRow(
	ctx: CanvasRenderingContext2D,
	row: MeasuredGroup,
	originX: number,
	originY: number,
	pillHeight: number,
	paddingX: number,
	radius: number,
	pillGap: number,
) {
	ctx.save();
	ctx.globalAlpha *= row.group.opacity;
	let x = originX;
	for (const pill of row.pills) {
		ctx.fillStyle = "rgba(0,0,0,0.9)";
		drawSquircleOnCanvas(ctx, {
			x,
			y: originY,
			width: pill.width,
			height: pillHeight,
			radius,
		});
		ctx.fill();
		ctx.fillStyle = "#fff";
		ctx.fillText(pill.label, x + paddingX, originY + pillHeight / 2);
		x += pill.width + pillGap;
	}
	ctx.restore();
}

export function renderKeystrokes(
	ctx: CanvasRenderingContext2D,
	samples: KeystrokeTelemetryPoint[],
	settings: KeystrokeOverlaySettings,
	width: number,
	height: number,
	timeMs: number,
): void {
	if (!settings.enabled || samples.length === 0) {
		return;
	}

	const groups = visibleKeycaps(samples, timeMs, settings.mode);
	if (groups.length === 0) {
		return;
	}

	const fontSize = Math.min(
		64,
		Math.max(10, getCaptionScaledFontSize(30 * settings.size, width, 62)),
	);
	const padding = getCaptionPadding(fontSize);
	const radius = getCaptionScaledRadius(17.5, fontSize);
	const margin = fontSize * 1.1;
	const groupGap = fontSize * 0.35;
	const pillGap = fontSize * 0.22;
	const pillHeight = fontSize + padding.y * 2;

	ctx.save();
	ctx.font = `${CAPTION_FONT_WEIGHT} ${fontSize}px ${getDefaultCaptionFontFamily()}`;
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";

	const newestFirst = measureGroups(ctx, groups, padding.x, pillGap).slice().reverse();
	const isTop = settings.position === "top-center";
	const isRight = settings.position === "bottom-right";
	const isLeft = settings.position === "bottom-left";

	if (isTop) {
		let y = margin;
		for (const row of newestFirst) {
			drawGroupRow(
				ctx,
				row,
				(width - row.width) / 2,
				y,
				pillHeight,
				padding.x,
				radius,
				pillGap,
			);
			y += pillHeight + groupGap;
		}
	} else {
		let y = height - margin;
		for (const row of newestFirst) {
			const x = isLeft
				? margin
				: isRight
					? width - margin - row.width
					: (width - row.width) / 2;
			drawGroupRow(ctx, row, x, y - pillHeight, pillHeight, padding.x, radius, pillGap);
			y -= pillHeight + groupGap;
		}
	}

	ctx.restore();
}
