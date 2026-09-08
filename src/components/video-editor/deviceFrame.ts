import type { Graphics } from "pixi.js";
import { drawSquircleOnGraphics } from "@/lib/geometry/squircle";

export type DeviceFrame = "none" | "iphone-black" | "iphone-silver";
export type DeviceFrameOrientation = "portrait" | "landscape";
export type DeviceFrameRect = { x: number; y: number; width: number; height: number };

/** The bundled photograph and its one-pixel screen bleed, in source pixels. */
export const IPHONE_FRAME = {
	width: 450,
	height: 920,
	screen: { x: 24, y: 23, width: 402, height: 874 },
	screenRadius: 60,
} as const;

export type DeviceFrameGeometry = {
	body: DeviceFrameRect;
	bounds: DeviceFrameRect;
	screen: DeviceFrameRect;
	buttons: DeviceFrameRect[];
	portrait: boolean;
	scale: number;
	bezel: number;
	radius: number;
	screenRadius: number;
};

export function hasDeviceFrame(frame: DeviceFrame | undefined): boolean {
	return frame === "iphone-black" || frame === "iphone-silver";
}

/** Fit the crop inside the fixed physical screen, without stretching either image. */
export function getDeviceFrameGeometry(
	frame: DeviceFrame | undefined,
	content: DeviceFrameRect,
	orientation?: DeviceFrameOrientation,
): DeviceFrameGeometry | null {
	if (!hasDeviceFrame(frame) || content.width <= 0 || content.height <= 0) return null;
	const portrait = orientation ? orientation === "portrait" : content.width <= content.height;
	const screenW = portrait ? IPHONE_FRAME.screen.width : IPHONE_FRAME.screen.height;
	const screenH = portrait ? IPHONE_FRAME.screen.height : IPHONE_FRAME.screen.width;
	const scale = Math.max(content.width / screenW, content.height / screenH);
	const screen = {
		x: content.x + (content.width - screenW * scale) / 2,
		y: content.y + (content.height - screenH * scale) / 2,
		width: screenW * scale,
		height: screenH * scale,
	};
	const bounds = {
		x: screen.x - (portrait ? IPHONE_FRAME.screen.x : IPHONE_FRAME.screen.y) * scale,
		y: screen.y - (portrait ? IPHONE_FRAME.screen.y : IPHONE_FRAME.screen.x) * scale,
		width: (portrait ? IPHONE_FRAME.width : IPHONE_FRAME.height) * scale,
		height: (portrait ? IPHONE_FRAME.height : IPHONE_FRAME.width) * scale,
	};
	const orient = (rect: DeviceFrameRect): DeviceFrameRect =>
		portrait
			? {
					x: bounds.x + rect.x * scale,
					y: bounds.y + rect.y * scale,
					width: rect.width * scale,
					height: rect.height * scale,
				}
			: {
					x: bounds.x + (IPHONE_FRAME.height - rect.y - rect.height) * scale,
					y: bounds.y + rect.x * scale,
					width: rect.height * scale,
					height: rect.width * scale,
				};
	return {
		bounds,
		screen,
		portrait,
		scale,
		body: orient({ x: 9, y: 8, width: 432, height: 904 }),
		buttons: [
			{ x: 6, y: 176, width: 3, height: 57 },
			{ x: 6, y: 261, width: 3, height: 57 },
			{ x: 6, y: 335, width: 3, height: 57 },
			{ x: 441, y: 290, width: 3, height: 109 },
		].map(orient),
		bezel: 16 * scale,
		radius: 79 * scale,
		screenRadius: IPHONE_FRAME.screenRadius * scale,
	};
}

/** Insets include letterboxing and the complete photograph, including side buttons. */
export function getDeviceFrameInsets(
	frame: DeviceFrame | undefined,
	width: number,
	height: number,
	orientation?: DeviceFrameOrientation,
) {
	const geometry = getDeviceFrameGeometry(frame, { x: 0, y: 0, width, height }, orientation);
	if (!geometry) return null;
	const horizontal = (geometry.bounds.width - width) / (2 * geometry.bounds.width);
	const vertical = (geometry.bounds.height - height) / (2 * geometry.bounds.height);
	return { left: horizontal, right: horizontal, top: vertical, bottom: vertical };
}

/** Clip the recording to both its crop and the physical screen's rounded aperture. */
function screenIntersection(content: DeviceFrameRect, geometry: DeviceFrameGeometry) {
	const { screen, screenRadius: r } = geometry;
	let points = [
		{ x: screen.x + screen.width - r, y: screen.y + r, angle: -Math.PI / 2 },
		{ x: screen.x + screen.width - r, y: screen.y + screen.height - r, angle: 0 },
		{ x: screen.x + r, y: screen.y + screen.height - r, angle: Math.PI / 2 },
		{ x: screen.x + r, y: screen.y + r, angle: Math.PI },
	].flatMap((corner) =>
		Array.from({ length: 25 }, (_, i) => ({
			x: corner.x + Math.cos(corner.angle + ((i / 24) * Math.PI) / 2) * r,
			y: corner.y + Math.sin(corner.angle + ((i / 24) * Math.PI) / 2) * r,
		})),
	);
	for (const [axis, edge, minimum] of [
		["x", content.x, true],
		["x", content.x + content.width, false],
		["y", content.y, true],
		["y", content.y + content.height, false],
	] as const) {
		const clipped: { x: number; y: number }[] = [];
		for (let i = 0; i < points.length; i++) {
			const previous = points[(i + points.length - 1) % points.length];
			const current = points[i];
			const previousInside = minimum ? previous[axis] >= edge : previous[axis] <= edge;
			const currentInside = minimum ? current[axis] >= edge : current[axis] <= edge;
			if (previousInside !== currentInside) {
				const t = (edge - previous[axis]) / (current[axis] - previous[axis]);
				clipped.push({
					x: previous.x + (current.x - previous.x) * t,
					y: previous.y + (current.y - previous.y) * t,
				});
			}
			if (currentInside) clipped.push(current);
		}
		points = clipped;
	}
	return points;
}

function drawPolygon(graphics: Graphics, points: { x: number; y: number }[]) {
	if (!points.length) return;
	graphics.moveTo(points[0].x, points[0].y);
	for (const point of points.slice(1)) graphics.lineTo(point.x, point.y);
	graphics.closePath();
}

/** Letterbox only the space outside the crop, clipped to the physical aperture. */
export function drawDeviceFrameLetterbox(
	graphics: Graphics,
	frame: DeviceFrame | undefined,
	content: DeviceFrameRect,
	orientation?: DeviceFrameOrientation,
) {
	graphics.clear();
	const geometry = getDeviceFrameGeometry(frame, content, orientation);
	if (!geometry) return;
	const screen = geometry.screen;
	const bars = [
		{ x: screen.x, y: screen.y, width: screen.width, height: content.y - screen.y },
		{
			x: screen.x,
			y: content.y + content.height,
			width: screen.width,
			height: screen.y + screen.height - content.y - content.height,
		},
		{ x: screen.x, y: content.y, width: content.x - screen.x, height: content.height },
		{
			x: content.x + content.width,
			y: content.y,
			width: screen.x + screen.width - content.x - content.width,
			height: content.height,
		},
	];
	for (const bar of bars) {
		if (bar.width <= 0.000001 || bar.height <= 0.000001) continue;
		drawPolygon(graphics, screenIntersection(bar, geometry));
		graphics.fill(0x000000);
	}
}

/** None retains the editor's existing corner behavior. */
export function drawVideoScreenMask(
	graphics: Graphics,
	frame: DeviceFrame | undefined,
	content: DeviceFrameRect,
	defaultRadius: number,
	orientation?: DeviceFrameOrientation,
): number {
	graphics.clear();
	const geometry = getDeviceFrameGeometry(frame, content, orientation);
	if (geometry) {
		drawPolygon(graphics, screenIntersection(content, geometry));
	} else drawSquircleOnGraphics(graphics, { ...content, radius: defaultRadius });
	graphics.fill({ color: 0xffffff });
	return geometry?.screenRadius ?? defaultRadius;
}
