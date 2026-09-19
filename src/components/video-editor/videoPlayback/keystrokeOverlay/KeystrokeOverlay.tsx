import { getSquircleSvgPath } from "@/lib/geometry/squircle";
import {
	CAPTION_FONT_WEIGHT,
	getCaptionPadding,
	getCaptionScaledFontSize,
	getCaptionScaledRadius,
} from "../../captionStyle";
import { getDefaultCaptionFontFamily } from "../../types";
import type { KeystrokeOverlaySettings, KeystrokeTelemetryPoint } from "./keystrokeTypes";
import { visibleKeycaps } from "./visibleKeycaps";

type KeystrokeOverlayProps = {
	samples: readonly KeystrokeTelemetryPoint[];
	settings: KeystrokeOverlaySettings;
	timeMs: number;
	overlayWidth: number;
	isGap: boolean;
};

function applyKeycapPillClip(element: HTMLDivElement | null, radius: number) {
	if (!element) {
		return;
	}
	const path = getSquircleSvgPath({
		x: 0,
		y: 0,
		width: element.offsetWidth,
		height: element.offsetHeight,
		radius,
	});
	if (!path) {
		return;
	}
	element.style.clipPath = `path('${path}')`;
	element.style.setProperty("-webkit-clip-path", `path('${path}')`);
}

export function KeystrokeOverlay({
	samples,
	settings,
	timeMs,
	overlayWidth,
	isGap,
}: KeystrokeOverlayProps) {
	const fontSize = Math.min(
		64,
		Math.max(10, getCaptionScaledFontSize(30 * settings.size, overlayWidth, 62)),
	);
	const padding = getCaptionPadding(fontSize);
	const radius = getCaptionScaledRadius(17.5, fontSize);
	const groups = isGap || !settings.enabled ? [] : visibleKeycaps(samples, timeMs, settings.mode);
	if (groups.length === 0) {
		return null;
	}

	const margin = fontSize * 1.1;
	const isTop = settings.position === "top-center";
	const isRight = settings.position === "bottom-right";
	const isLeft = settings.position === "bottom-left";

	return (
		<div
			style={{
				position: "absolute",
				pointerEvents: "none",
				display: "flex",
				flexDirection: isTop ? "column-reverse" : "column",
				alignItems: isLeft ? "flex-start" : isRight ? "flex-end" : "center",
				gap: fontSize * 0.35,
				...(isTop ? { top: margin } : { bottom: margin }),
				...(isLeft
					? { left: margin }
					: isRight
						? { right: margin }
						: { left: 0, right: 0 }),
			}}
		>
			{groups.map((group) => (
				<div
					key={group.id}
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						gap: fontSize * 0.22,
						opacity: group.opacity,
					}}
				>
					{group.labels.map((label, index) => (
						<div
							key={`${group.id}:${index}`}
							ref={(element) => applyKeycapPillClip(element, radius)}
							style={{
								background: "rgba(0,0,0,0.9)",
								boxSizing: "border-box",
								color: "#fff",
								fontFamily: getDefaultCaptionFontFamily(),
								fontSize,
								fontWeight: CAPTION_FONT_WEIGHT,
								lineHeight: 1,
								padding: `${padding.y}px ${padding.x}px`,
								whiteSpace: "nowrap",
							}}
						>
							{label}
						</div>
					))}
				</div>
			))}
		</div>
	);
}
