import { describe, expect, it } from "vitest";
import {
	createAreaSource,
	createWindowSource,
	getSourceArea,
	normalizeCapturePick,
} from "./sourceArea";

const displays = [
	{ id: 1, bounds: { x: 0, y: 0, width: 1728, height: 1117 } },
	{ id: 2, bounds: { x: 1728, y: -200, width: 2560, height: 1440 } },
];
const windows = [
	{
		id: "window:42:0",
		appName: "Safari",
		title: "Docs",
		display_id: "1",
		x: 10,
		y: 40,
		width: 1200,
		height: 800,
	},
];

describe("normalizeCapturePick", () => {
	it("keeps an area that lies on its display", () => {
		expect(
			normalizeCapturePick(
				{
					kind: "area",
					x: 100.4,
					y: 50,
					width: 1280,
					height: 720,
					displayId: 1,
					record: true,
				},
				displays,
				windows,
			),
		).toEqual({
			kind: "area",
			x: 100,
			y: 50,
			width: 1280,
			height: 720,
			displayId: 1,
			record: true,
		});
	});

	it("clips an area to its display, including displays left of or above the origin", () => {
		expect(
			normalizeCapturePick(
				{ kind: "area", x: 1700, y: -300, width: 400, height: 400, displayId: 2 },
				displays,
				windows,
			),
		).toEqual({
			kind: "area",
			x: 1728,
			y: -200,
			width: 372,
			height: 300,
			displayId: 2,
			record: false,
		});
	});

	it("trims an area to an even size so it maps onto whole screen pixels", () => {
		expect(
			normalizeCapturePick(
				{ kind: "area", x: 10, y: 20, width: 401, height: 301, displayId: 1 },
				displays,
				windows,
			),
		).toMatchObject({ x: 10, y: 20, width: 400, height: 300 });
	});

	it("rejects areas that are too small, unknown displays and malformed input", () => {
		const area = { kind: "area", x: 0, y: 0, width: 20, height: 400, displayId: 1 };
		expect(normalizeCapturePick(area, displays, windows)).toBeNull();
		expect(
			normalizeCapturePick({ ...area, width: 400, displayId: 9 }, displays, windows),
		).toBeNull();
		expect(normalizeCapturePick({ ...area, width: "400" }, displays, windows)).toBeNull();
		expect(normalizeCapturePick({ ...area, kind: "region" }, displays, windows)).toBeNull();
		expect(normalizeCapturePick(null, displays, windows)).toBeNull();
	});

	it("accepts only windows the picker offered", () => {
		expect(
			normalizeCapturePick(
				{ kind: "window", windowId: "window:42:0", displayId: 1, record: true },
				displays,
				windows,
			),
		).toEqual({ kind: "window", windowId: "window:42:0", displayId: 1, record: true });
		expect(
			normalizeCapturePick(
				{ kind: "window", windowId: "window:7:0", displayId: 1 },
				displays,
				windows,
			),
		).toBeNull();
	});

	it("accepts a connected screen", () => {
		expect(normalizeCapturePick({ kind: "screen", displayId: 2 }, displays, windows)).toEqual({
			kind: "screen",
			displayId: 2,
			record: false,
		});
	});
});

describe("picked sources", () => {
	it("round-trips an area's rectangle", () => {
		const source = createAreaSource({
			kind: "area",
			x: 10,
			y: 20,
			width: 640,
			height: 480,
			displayId: 1,
			record: false,
		});
		expect(source).toMatchObject({ id: "area:1", name: "Area 640×480", display_id: "1" });
		expect(getSourceArea(source)).toEqual({ x: 10, y: 20, width: 640, height: 480 });
	});

	it("builds the same window source the window list offers", () => {
		expect(createWindowSource(windows[0])).toEqual({
			id: "window:42:0",
			name: "Docs",
			display_id: "1",
			sourceType: "window",
			appName: "Safari",
			windowTitle: "Docs",
		});
	});

	it("ignores sources that are not areas", () => {
		expect(getSourceArea({ id: "screen:1:0", name: "Screen" })).toBeNull();
		expect(getSourceArea(null)).toBeNull();
	});
});
