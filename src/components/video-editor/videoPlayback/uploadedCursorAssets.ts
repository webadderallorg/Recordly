import macosClosedHandUrl from "../../../assets/cursors/macos/closedhand-1__50-50.svg";
import macosCrosshairUrl from "../../../assets/cursors/macos/crosshair-1__50-50.svg";
import macosTextUrl from "../../../assets/cursors/macos/ibeamstroke-1__50-50.svg";
import macosNotAllowedUrl from "../../../assets/cursors/macos/notallowed-1__23-0.svg";
import macosOpenHandUrl from "../../../assets/cursors/macos/openhand-1__50-50.svg";
import macosArrowUrl from "../../../assets/cursors/macos/pointer-1__34-24.svg";
import macosPointerUrl from "../../../assets/cursors/macos/pointinghand-1__39-26.svg";
import macosResizeEwUrl from "../../../assets/cursors/macos/resizeeastwest-1__50-50.svg";
import macosResizeNsUrl from "../../../assets/cursors/macos/resizenorthsouth-1__50-50.svg";
import tahoeClosedHandUrl from "../../../assets/cursors/golden-gate/closedhand.svg";
import tahoeCrosshairUrl from "../../../assets/cursors/tahoe/crosshair-1__50-50.svg";
import tahoeTextUrl from "../../../assets/cursors/tahoe/ibeam-1__50-44.svg";
import tahoeNotAllowedUrl from "../../../assets/cursors/tahoe/notallowed-1__23-0.svg";
import tahoeOpenHandUrl from "../../../assets/cursors/golden-gate/openhand.svg";
import tahoeArrowUrl from "../../../assets/cursors/tahoe/pointer-1__14-6.svg";
import tahoePointerUrl from "../../../assets/cursors/golden-gate/pointinghand.svg";
import tahoeResizeEwUrl from "../../../assets/cursors/tahoe/resizeeastwest-1__50-50.svg";
import tahoeResizeNsUrl from "../../../assets/cursors/tahoe/resizenorthsouth-1__50-49.svg";
import windows11ArrowUrl from "../../../assets/cursors/windows11/arrow__31-22.svg";
import windows11NotAllowedUrl from "../../../assets/cursors/windows11/block__50-50.svg";
import windows11CrosshairUrl from "../../../assets/cursors/windows11/cross__50-50.svg";
import windows11OpenHandUrl from "../../../assets/cursors/windows11/grab__50-50.svg";
import windows11ClosedHandUrl from "../../../assets/cursors/windows11/grabbing__50-50.svg";
import windows11PointerUrl from "../../../assets/cursors/windows11/pointer__54-35.svg";
import windows11ResizeEwUrl from "../../../assets/cursors/windows11/resize-horizontal__51-49.svg";
import windows11ResizeNsUrl from "../../../assets/cursors/windows11/resize-vertical__48-50.svg";
import windows11TextUrl from "../../../assets/cursors/windows11/text__50-50.svg";
import type { CursorStyle, CursorTelemetryPoint } from "../types";

type CursorAssetKey = NonNullable<CursorTelemetryPoint["cursorType"]>;
type CursorSetStyle = Extract<CursorStyle, "macos" | "tahoe" | "tahoe-inverted" | "windows11">;

const MACOS_POINTER_ASSET_HEIGHT = 746;
const MACOS_POINTER_CONTENT_HEIGHT = 386;
const TAHOE_POINTER_ASSET_HEIGHT = 958;
const TAHOE_POINTER_CONTENT_HEIGHT = 851;
const WINDOWS11_CURSOR_VIEWBOX_HEIGHT = 32;
// Alpha bounds measured after correcting the bottom-up Windows system SVG coordinates.
const WINDOWS11_ARROW_CONTENT_HEIGHT = 19.0625;

// Measured from the raw pointer assets using the non-shadow pixel bounds.
const MACOS_CURSOR_STYLE_SIZE_MULTIPLIER =
	TAHOE_POINTER_CONTENT_HEIGHT /
	TAHOE_POINTER_ASSET_HEIGHT /
	(MACOS_POINTER_CONTENT_HEIGHT / MACOS_POINTER_ASSET_HEIGHT);

export type UploadedCursorAsset = {
	url: string;
	fallbackAnchor: {
		x: number;
		y: number;
	};
	preserveCanvas?: boolean;
};

function asset(
	url: string,
	hotspotX: number,
	hotspotY: number,
	options: Pick<UploadedCursorAsset, "preserveCanvas"> = {},
): UploadedCursorAsset {
	return {
		url,
		fallbackAnchor: {
			x: hotspotX / 100,
			y: hotspotY / 100,
		},
		...options,
	};
}

function windowsSystemAsset(url: string, hotspotX: number, hotspotY: number) {
	return asset(
		url,
		(hotspotX / WINDOWS11_CURSOR_VIEWBOX_HEIGHT) * 100,
		(hotspotY / WINDOWS11_CURSOR_VIEWBOX_HEIGHT) * 100,
		{ preserveCanvas: true },
	);
}

export const cursorSetAssets: Record<
	Exclude<CursorSetStyle, "tahoe-inverted">,
	Record<CursorAssetKey, UploadedCursorAsset>
> = {
	macos: {
		arrow: asset(macosArrowUrl, 34, 24),
		text: asset(macosTextUrl, 50, 50),
		pointer: asset(macosPointerUrl, 39, 26),
		crosshair: asset(macosCrosshairUrl, 50, 50),
		"open-hand": asset(macosOpenHandUrl, 50, 50),
		"closed-hand": asset(macosClosedHandUrl, 50, 50),
		"resize-ew": asset(macosResizeEwUrl, 50, 50),
		"resize-ns": asset(macosResizeNsUrl, 50, 50),
		"not-allowed": asset(macosNotAllowedUrl, 23, 0),
	},
	// Keep the legacy style ID so saved projects use the updated Golden Gate pack.
	tahoe: {
		arrow: asset(tahoeArrowUrl, 14, 6),
		text: asset(tahoeTextUrl, 50, 44),
		pointer: asset(tahoePointerUrl, 37.5, 25),
		crosshair: asset(tahoeCrosshairUrl, 50, 50),
		"open-hand": asset(tahoeOpenHandUrl, 46.875, 50),
		"closed-hand": asset(tahoeClosedHandUrl, 46.875, 50),
		"resize-ew": asset(tahoeResizeEwUrl, 50, 50),
		"resize-ns": asset(tahoeResizeNsUrl, 50, 49),
		"not-allowed": asset(tahoeNotAllowedUrl, 23, 0),
	},
	windows11: {
		// Hotspots are from the 32px frames embedded in the matching Windows .cur files.
		arrow: windowsSystemAsset(windows11ArrowUrl, 0, 0),
		text: windowsSystemAsset(windows11TextUrl, 16, 16),
		pointer: windowsSystemAsset(windows11PointerUrl, 6, 0),
		crosshair: windowsSystemAsset(windows11CrosshairUrl, 16, 16),
		"open-hand": windowsSystemAsset(windows11OpenHandUrl, 16, 16),
		"closed-hand": windowsSystemAsset(windows11ClosedHandUrl, 16, 16),
		"resize-ew": windowsSystemAsset(windows11ResizeEwUrl, 11, 4),
		"resize-ns": windowsSystemAsset(windows11ResizeNsUrl, 4, 11),
		"not-allowed": windowsSystemAsset(windows11NotAllowedUrl, 8, 8),
	},
};

export const cursorStyleSizeMultipliers: Record<CursorSetStyle, number> = {
	macos: MACOS_CURSOR_STYLE_SIZE_MULTIPLIER,
	tahoe: 1,
	"tahoe-inverted": 1,
	windows11: WINDOWS11_CURSOR_VIEWBOX_HEIGHT / WINDOWS11_ARROW_CONTENT_HEIGHT,
};

export function getCursorStyleSizeMultiplier(style: CursorStyle) {
	return style in cursorStyleSizeMultipliers
		? cursorStyleSizeMultipliers[style as CursorSetStyle]
		: 1;
}

export const uploadedCursorAssets = cursorSetAssets.tahoe;
