import arrowUrl from "@/assets/cursors/pixel-glove/arrow.png";
import textUrl from "@/assets/cursors/pixel-glove/text.png";
import pointerUrl from "@/assets/cursors/pixel-glove/pointer.png";
import crosshairUrl from "@/assets/cursors/pixel-glove/crosshair.png";
import openHandUrl from "@/assets/cursors/pixel-glove/open-hand.png";
import closedHandUrl from "@/assets/cursors/pixel-glove/closed-hand.png";
import resizeEwUrl from "@/assets/cursors/pixel-glove/resize-ew.png";
import resizeNsUrl from "@/assets/cursors/pixel-glove/resize-ns.png";
import notAllowedUrl from "@/assets/cursors/pixel-glove/not-allowed.png";
import type { CursorTelemetryPoint } from "../types";
import type { UploadedCursorAsset } from "./uploadedCursorAssets";

export const pixelGloveAssets = {
	arrow: { url: arrowUrl, fallbackAnchor: { x: 0.352, y: 0.13 }, preserveCanvas: true },
	text: { url: textUrl, fallbackAnchor: { x: 0.5, y: 0.4 }, preserveCanvas: true },
	pointer: { url: pointerUrl, fallbackAnchor: { x: 0.352, y: 0.13 }, preserveCanvas: true },
	crosshair: { url: crosshairUrl, fallbackAnchor: { x: 0.5, y: 0.404 }, preserveCanvas: true },
	"open-hand": { url: openHandUrl, fallbackAnchor: { x: 0.38, y: 0.18 }, preserveCanvas: true },
	"closed-hand": {
		url: closedHandUrl,
		fallbackAnchor: { x: 0.39, y: 0.33 },
		preserveCanvas: true,
	},
	"resize-ew": { url: resizeEwUrl, fallbackAnchor: { x: 0.5, y: 0.428 }, preserveCanvas: true },
	"resize-ns": { url: resizeNsUrl, fallbackAnchor: { x: 0.5, y: 0.428 }, preserveCanvas: true },
	"not-allowed": {
		url: notAllowedUrl,
		fallbackAnchor: { x: 0.5, y: 0.348 },
		preserveCanvas: true,
	},
} satisfies Record<NonNullable<CursorTelemetryPoint["cursorType"]>, UploadedCursorAsset>;
