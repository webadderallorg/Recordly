import { useEffect, useMemo } from "react";
import { buildActiveCaptionLayout } from "../captionLayout";
import {
	CAPTION_FONT_WEIGHT,
	getCaptionScaledFontSize,
	getCaptionScaledRadius,
	getCaptionTextMaxWidth,
} from "../captionStyle";
import { getSquircleSvgPath } from "@/lib/geometry/squircle";
import { getDefaultCaptionFontFamily, type AutoCaptionSettings, type CaptionCue } from "../types";

interface UseCaptionLayoutParams {
	autoCaptionSettings?: AutoCaptionSettings;
	autoCaptions: CaptionCue[];
	currentTime: number;
	overlayRef: React.RefObject<HTMLDivElement | null>;
	captionBoxRef: React.RefObject<HTMLDivElement | null>;
}

export function useCaptionLayout({
	autoCaptionSettings,
	autoCaptions,
	currentTime,
	overlayRef,
	captionBoxRef,
}: UseCaptionLayoutParams) {
	const activeCaptionLayout = useMemo(() => {
		if (
			!autoCaptionSettings?.enabled ||
			autoCaptions.length === 0 ||
			typeof document === "undefined"
		) {
			return null;
		}

		const overlayWidth = overlayRef.current?.clientWidth || 960;
		const fontSize = getCaptionScaledFontSize(
			autoCaptionSettings.fontSize,
			overlayWidth,
			autoCaptionSettings.maxWidth,
		);
		const maxTextWidthPx = getCaptionTextMaxWidth(
			overlayWidth,
			autoCaptionSettings.maxWidth,
			fontSize,
		);
		const measurementCanvas = document.createElement("canvas");
		const measurementContext = measurementCanvas.getContext("2d");
		if (!measurementContext) {
			return null;
		}

		measurementContext.font = `${CAPTION_FONT_WEIGHT} ${fontSize}px ${getDefaultCaptionFontFamily()}`;

		return buildActiveCaptionLayout({
			cues: autoCaptions,
			timeMs: Math.round(currentTime * 1000),
			settings: autoCaptionSettings,
			maxWidthPx: maxTextWidthPx,
			measureText: (text) => measurementContext.measureText(text).width,
		});
	}, [autoCaptionSettings, autoCaptions, currentTime, overlayRef]);

	useEffect(() => {
		const captionBox = captionBoxRef.current;
		if (!captionBox || !activeCaptionLayout || !autoCaptionSettings) {
			if (captionBox) {
				captionBox.style.clipPath = "";
				captionBox.style.removeProperty("-webkit-clip-path");
			}
			return;
		}

		const frame = requestAnimationFrame(() => {
			const width = captionBox.offsetWidth;
			const height = captionBox.offsetHeight;
			if (width <= 0 || height <= 0) {
				return;
			}

			const fontSize = getCaptionScaledFontSize(
				autoCaptionSettings.fontSize,
				overlayRef.current?.clientWidth || 960,
				autoCaptionSettings.maxWidth,
			);

			const squirclePath = getSquircleSvgPath({
				x: 0,
				y: 0,
				width,
				height,
				radius: getCaptionScaledRadius(autoCaptionSettings.boxRadius, fontSize),
			});
			captionBox.style.clipPath = `path('${squirclePath}')`;
			captionBox.style.setProperty("-webkit-clip-path", `path('${squirclePath}')`);
		});

		return () => cancelAnimationFrame(frame);
	}, [activeCaptionLayout, autoCaptionSettings, captionBoxRef, overlayRef]);

	return activeCaptionLayout;
}