import macosClosedHandUrl from "../../../assets/cursors/macos/closedhand-1__50-50.svg";
import macosCrosshairUrl from "../../../assets/cursors/macos/crosshair-1__50-50.svg";
import macosTextUrl from "../../../assets/cursors/macos/ibeam-1__50-50.svg";
import macosNotAllowedUrl from "../../../assets/cursors/macos/notallowed-1__23-0.svg";
import macosOpenHandUrl from "../../../assets/cursors/macos/openhand-1__50-50.svg";
import macosArrowUrl from "../../../assets/cursors/macos/pointer-1__34-24.svg";
import macosPointerUrl from "../../../assets/cursors/macos/pointinghand-1__39-26.svg";
import macosResizeEwUrl from "../../../assets/cursors/macos/resizeeastwest-1__50-50.svg";
import macosResizeNsUrl from "../../../assets/cursors/macos/resizenorthsouth-1__50-50.svg";
import tahoeClosedHandUrl from "../../../assets/cursors/tahoe/closedhand-1__50-46.svg";
import tahoeCrosshairUrl from "../../../assets/cursors/tahoe/crosshair-1__50-50.svg";
import tahoeTextUrl from "../../../assets/cursors/tahoe/ibeam-1__50-44.svg";
import tahoeNotAllowedUrl from "../../../assets/cursors/tahoe/notallowed-1__23-0.svg";
import tahoeOpenHandUrl from "../../../assets/cursors/tahoe/openhand-1__55-57.svg";
import tahoeArrowUrl from "../../../assets/cursors/tahoe/pointer-1__14-6.svg";
import tahoePointerUrl from "../../../assets/cursors/tahoe/pointinghand-1__40-10.svg";
import tahoeResizeEwUrl from "../../../assets/cursors/tahoe/resizeeastwest-1__50-50.svg";
import tahoeResizeNsUrl from "../../../assets/cursors/tahoe/resizenorthsouth-1__50-49.svg";
import type { CursorStyle, CursorTelemetryPoint } from "../types";

type CursorAssetKey = NonNullable<CursorTelemetryPoint["cursorType"]>;
type CursorSetStyle = Extract<CursorStyle, "macos" | "tahoe" | "tahoe-inverted">;

export type UploadedCursorAsset = {
	url: string;
	fallbackAnchor: {
		x: number;
		y: number;
	};
};

function asset(url: string, hotspotX: number, hotspotY: number): UploadedCursorAsset {
	return {
		url,
		fallbackAnchor: {
			x: hotspotX / 100,
			y: hotspotY / 100,
		},
	};
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
	tahoe: {
		arrow: asset(tahoeArrowUrl, 14, 6),
		text: asset(tahoeTextUrl, 50, 44),
		pointer: asset(tahoePointerUrl, 40, 10),
		crosshair: asset(tahoeCrosshairUrl, 50, 50),
		"open-hand": asset(tahoeOpenHandUrl, 55, 57),
		"closed-hand": asset(tahoeClosedHandUrl, 50, 46),
		"resize-ew": asset(tahoeResizeEwUrl, 50, 50),
		"resize-ns": asset(tahoeResizeNsUrl, 50, 49),
		"not-allowed": asset(tahoeNotAllowedUrl, 23, 0),
	},
};

export const uploadedCursorAssets = cursorSetAssets.tahoe;
