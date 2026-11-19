import beeArrowUrl from "@/assets/cursors/community/bee/arrow.svg";
import beeTextUrl from "@/assets/cursors/community/bee/text.svg";
import beePointerUrl from "@/assets/cursors/community/bee/pointer.svg";
import beeCrosshairUrl from "@/assets/cursors/community/bee/crosshair.svg";
import beeOpenHandUrl from "@/assets/cursors/community/bee/open-hand.svg";
import beeClosedHandUrl from "@/assets/cursors/community/bee/closed-hand.svg";
import beeResizeEwUrl from "@/assets/cursors/community/bee/resize-ew.svg";
import beeResizeNsUrl from "@/assets/cursors/community/bee/resize-ns.svg";
import beeNotAllowedUrl from "@/assets/cursors/community/bee/not-allowed.svg";
import pastelArrowUrl from "@/assets/cursors/community/catppuccin-pink/arrow.svg";
import pastelTextUrl from "@/assets/cursors/community/catppuccin-pink/text.svg";
import pastelPointerUrl from "@/assets/cursors/community/catppuccin-pink/pointer.svg";
import pastelCrosshairUrl from "@/assets/cursors/community/catppuccin-pink/crosshair.svg";
import pastelOpenHandUrl from "@/assets/cursors/community/catppuccin-pink/open-hand.svg";
import pastelClosedHandUrl from "@/assets/cursors/community/catppuccin-pink/closed-hand.svg";
import pastelResizeEwUrl from "@/assets/cursors/community/catppuccin-pink/resize-ew.svg";
import pastelResizeNsUrl from "@/assets/cursors/community/catppuccin-pink/resize-ns.svg";
import pastelNotAllowedUrl from "@/assets/cursors/community/catppuccin-pink/not-allowed.svg";
import linuxArrowUrl from "@/assets/cursors/community/breezex/arrow.svg";
import linuxTextUrl from "@/assets/cursors/community/breezex/text.svg";
import linuxPointerUrl from "@/assets/cursors/community/breezex/pointer.svg";
import linuxCrosshairUrl from "@/assets/cursors/community/breezex/crosshair.svg";
import linuxOpenHandUrl from "@/assets/cursors/community/breezex/open-hand.svg";
import linuxClosedHandUrl from "@/assets/cursors/community/breezex/closed-hand.svg";
import linuxResizeEwUrl from "@/assets/cursors/community/breezex/resize-ew.svg";
import linuxResizeNsUrl from "@/assets/cursors/community/breezex/resize-ns.svg";
import linuxNotAllowedUrl from "@/assets/cursors/community/breezex/not-allowed.svg";
import type { CursorTelemetryPoint } from "../types";
import type { UploadedCursorAsset } from "./uploadedCursorAssets";

// Hotspots are normalized from the upstream build configs and SVG hotspot markers.
export const communityCursorAssets = {
	bee: {
		arrow: { url: beeArrowUrl, fallbackAnchor: { x: 0.265, y: 0.18 } },
		text: { url: beeTextUrl, fallbackAnchor: { x: 0.5, y: 0.5 } },
		pointer: { url: beePointerUrl, fallbackAnchor: { x: 0.44, y: 0.16 } },
		crosshair: { url: beeCrosshairUrl, fallbackAnchor: { x: 0.49, y: 0.48 } },
		"open-hand": { url: beeOpenHandUrl, fallbackAnchor: { x: 0.565, y: 0.475 } },
		"closed-hand": { url: beeClosedHandUrl, fallbackAnchor: { x: 0.53, y: 0.395 } },
		"resize-ew": { url: beeResizeEwUrl, fallbackAnchor: { x: 0.5, y: 0.5 } },
		"resize-ns": { url: beeResizeNsUrl, fallbackAnchor: { x: 0.5, y: 0.5 } },
		"not-allowed": { url: beeNotAllowedUrl, fallbackAnchor: { x: 0.5, y: 0.5 } },
	},
	"catppuccin-pink": {
		arrow: { url: pastelArrowUrl, fallbackAnchor: { x: 0.0629375, y: 0.0625 } },
		text: { url: pastelTextUrl, fallbackAnchor: { x: 0.46875, y: 0.46875 } },
		pointer: { url: pastelPointerUrl, fallbackAnchor: { x: 0.41979921875, y: 0.23030261875 } },
		crosshair: { url: pastelCrosshairUrl, fallbackAnchor: { x: 0.46875, y: 0.46875 } },
		"open-hand": { url: pastelOpenHandUrl, fallbackAnchor: { x: 0.4687531875, y: 0.4843725 } },
		"closed-hand": { url: pastelClosedHandUrl, fallbackAnchor: { x: 0.46875, y: 0.46875 } },
		"resize-ew": { url: pastelResizeEwUrl, fallbackAnchor: { x: 0.46875, y: 0.46875 } },
		"resize-ns": { url: pastelResizeNsUrl, fallbackAnchor: { x: 0.46875, y: 0.5 } },
		"not-allowed": {
			url: pastelNotAllowedUrl,
			fallbackAnchor: { x: 0.4843563125, y: 0.4843794375 },
		},
	},
	breezex: {
		arrow: {
			url: linuxArrowUrl,
			fallbackAnchor: { x: 0.26848249027237353, y: 0.11673151750972763 },
		},
		text: {
			url: linuxTextUrl,
			fallbackAnchor: { x: 0.4980544747081712, y: 0.4980544747081712 },
		},
		pointer: {
			url: linuxPointerUrl,
			fallbackAnchor: { x: 0.45525291828793774, y: 0.14007782101167315 },
		},
		crosshair: {
			url: linuxCrosshairUrl,
			fallbackAnchor: { x: 0.4980544747081712, y: 0.4980544747081712 },
		},
		"open-hand": {
			url: linuxOpenHandUrl,
			fallbackAnchor: { x: 0.5603112840466926, y: 0.35019455252918286 },
		},
		"closed-hand": {
			url: linuxClosedHandUrl,
			fallbackAnchor: { x: 0.5486381322957199, y: 0.30739299610894943 },
		},
		"resize-ew": {
			url: linuxResizeEwUrl,
			fallbackAnchor: { x: 0.49416342412451364, y: 0.48638132295719844 },
		},
		"resize-ns": {
			url: linuxResizeNsUrl,
			fallbackAnchor: { x: 0.490272373540856, y: 0.48638132295719844 },
		},
		"not-allowed": {
			url: linuxNotAllowedUrl,
			fallbackAnchor: { x: 0.26848249027237353, y: 0.11673151750972763 },
		},
	},
} satisfies Record<
	string,
	Record<NonNullable<CursorTelemetryPoint["cursorType"]>, UploadedCursorAsset>
>;
