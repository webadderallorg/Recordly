import {
	DEFAULT_KEYSTROKE_OVERLAY_SETTINGS,
	formatKeystrokeLabel,
	getKeystrokeOverlayOpacity,
	getVisibleKeystroke,
	type KeystrokeOverlaySettings,
	type KeystrokeSample,
} from "@/lib/keystrokeOverlay";

export function detectKeystrokeOverlayIsMac(
	platformHint =
		typeof navigator === "undefined" ? "" : `${navigator.platform} ${navigator.userAgent}`,
) {
	return /mac|iphone|ipad|ipod/i.test(platformHint);
}

export function renderKeystrokeOverlay(
	ctx: CanvasRenderingContext2D,
	samples: KeystrokeSample[],
	settings: KeystrokeOverlaySettings | undefined,
	width: number,
	height: number,
	timeMs: number,
	isMac = false,
) {
	const overlaySettings = settings ?? DEFAULT_KEYSTROKE_OVERLAY_SETTINGS;
	const visible = getVisibleKeystroke(samples, timeMs, overlaySettings);
	const opacity = getKeystrokeOverlayOpacity(visible, timeMs);
	if (!visible || opacity <= 0) {
		return;
	}

	const label = formatKeystrokeLabel(visible, isMac);
	const fontSize = Math.max(12, overlaySettings.fontSize * (width / 1920));
	ctx.save();
	ctx.globalAlpha = opacity;
	ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
	const paddingX = fontSize * 0.7;
	const paddingY = fontSize * 0.42;
	const metrics = ctx.measureText(label);
	const boxWidth = metrics.width + paddingX * 2;
	const boxHeight = fontSize + paddingY * 2;
	const centerX = width / 2;
	const offset = (overlaySettings.bottomOffset / 100) * height;
	const centerY =
		overlaySettings.position === "top" ? offset + boxHeight / 2 : height - offset - boxHeight / 2;

	ctx.fillStyle = "rgba(0, 0, 0, 0.82)";
	const x = centerX - boxWidth / 2;
	const y = centerY - boxHeight / 2;
	const radius = Math.min(12, boxHeight / 2);
	ctx.beginPath();
	ctx.moveTo(x + radius, y);
	ctx.arcTo(x + boxWidth, y, x + boxWidth, y + boxHeight, radius);
	ctx.arcTo(x + boxWidth, y + boxHeight, x, y + boxHeight, radius);
	ctx.arcTo(x, y + boxHeight, x, y, radius);
	ctx.arcTo(x, y, x + boxWidth, y, radius);
	ctx.closePath();
	ctx.fill();

	ctx.fillStyle = "#ffffff";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(label, centerX, centerY);
	ctx.restore();
}
