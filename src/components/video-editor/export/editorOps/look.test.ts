import { describe, expect, it } from "vitest";
import { DEFAULT_WEBCAM_OVERLAY, DEFAULT_ZOOM_MOTION_BLUR_TUNING } from "../../types";
import { lookOps } from "./look";
import type { EditorOpContext } from "./types";

function makeContext(webcam: object = {}, missingSetter?: string) {
	const state: Record<string, unknown> = {
		webcam: { ...DEFAULT_WEBCAM_OVERLAY, ...webcam },
		zoomMotionBlurTuning: DEFAULT_ZOOM_MOTION_BLUR_TUNING,
		zoomInDurationMs: 1500,
		zoomInOverlapMs: 500,
		padding: { top: 20, bottom: 20, left: 20, right: 20, linked: true },
		borderRadius: 12,
	};
	const calls: string[] = [];
	const appearance = new Proxy(state, {
		get(target, key: string) {
			if (key.startsWith("set")) {
				if (key === missingSetter) return undefined;
				return (value: unknown) => {
					const field = key[3].toLowerCase() + key.slice(4);
					calls.push(field);
					target[field] = value;
				};
			}
			return target[key];
		},
	});
	return { state, calls, context: { appearance } as unknown as EditorOpContext };
}

const set = (payload: unknown, context: EditorOpContext) =>
	lookOps["look.set"](payload, context) as Record<string, unknown>;
const motion = (payload: unknown, context: EditorOpContext) =>
	lookOps["look.motion"](payload, context) as Record<string, unknown>;
const preset = (payload: unknown, context: EditorOpContext) =>
	lookOps["look.preset"](payload, context) as Record<string, unknown>;

describe("look.set", () => {
	it("applies only the given fields and says it cannot be undone", () => {
		const { state, calls, context } = makeContext();
		const result = set({ borderRadius: 30, shadowIntensity: 0.5 }, context);
		expect(calls.sort()).toEqual(["borderRadius", "shadowIntensity"]);
		expect(state.borderRadius).toBe(30);
		expect(result).toMatchObject({
			applied: { borderRadius: 30, shadowIntensity: 0.5 },
			undoable: false,
		});
		expect(result.note).toMatch(/not part of the editor history/);
	});

	it("turns a single padding number into linked padding and a crop into cropRegion", () => {
		const { state, context } = makeContext();
		set({ padding: 40, crop: { x: 0.1, y: 0.1, width: 0.9, height: 0.9 } }, context);
		expect(state.padding).toEqual({ top: 40, bottom: 40, left: 40, right: 40, linked: true });
		expect(state.cropRegion).toEqual({ x: 0.1, y: 0.1, width: 0.9, height: 0.9 });
	});

	it("accepts the exact limits", () => {
		const { state, context } = makeContext();
		set(
			{
				padding: { top: 250, bottom: 0, left: 100, right: 0 },
				borderRadius: 50,
				shadowIntensity: 1,
				backgroundBlur: 8,
				crop: { x: 0, y: 0, width: 1, height: 1 },
			},
			context,
		);
		expect(state).toMatchObject({
			padding: { top: 250, bottom: 0, left: 100, right: 0, linked: false },
			borderRadius: 50,
			shadowIntensity: 1,
			backgroundBlur: 8,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		});
	});

	it("changes nothing when the editor has no setter for a field", () => {
		const { state, calls, context } = makeContext({}, "setShadowIntensity");
		expect(() => set({ borderRadius: 30, shadowIntensity: 0.5 }, context)).toThrow(
			/no control for shadowIntensity/,
		);
		expect(calls).toEqual([]);
		expect(state.borderRadius).toBe(12);
	});

	it("merges webcam fields into the current settings", () => {
		const { state, context } = makeContext({ sourcePath: "/tmp/cam.webm" });
		set({ webcam: { enabled: true, size: 60, corner: "top-left" } }, context);
		expect(state.webcam).toMatchObject({
			enabled: true,
			size: 60,
			corner: "top-left",
			sourcePath: "/tmp/cam.webm",
			mirror: true,
		});
	});

	it.each([
		[{}, /at least one field/],
		[{ glow: 1 }, /unknown field glow/],
		[{ wallpaper: "  " }, /wallpaper must be a non-empty string/],
		[{ wallpaper: 3 }, /wallpaper must be a non-empty string/],
		[{ padding: 101 }, /padding must be between 0 and 100/],
		[{ padding: { top: 251, bottom: 0, left: 0, right: 0 } }, /padding.top must be between/],
		[{ padding: { top: 1, bottom: 1, left: 1 } }, /padding.right must be a number/],
		[{ padding: { top: 1, bottom: 1, left: 1, right: 1, margin: 2 } }, /unknown field margin/],
		[
			{ padding: { top: 1, bottom: 1, left: 1, right: 1, linked: "yes" } },
			/padding.linked must be true or false/,
		],
		[
			{ padding: { top: 101, bottom: 0, left: 0, right: 0, linked: true } },
			/padding.top must be between 0 and 100/,
		],
		[
			{ padding: { top: 251, bottom: 0, left: 0, right: 0, linked: false } },
			/padding.top must be between 0 and 250/,
		],
		[
			{ padding: { top: 10, bottom: 20, left: 10, right: 10, linked: true } },
			/padding is linked/,
		],
		[
			{ padding: { top: 0, bottom: 0, left: 101, right: 0, linked: false } },
			/padding.left must be between 0 and 100/,
		],
		[
			{
				crop: { x: 0, y: 0, width: 1, height: 1 },
				cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			},
			/either crop or cropRegion/,
		],
		[{ cropRegion: { x: 0.5, y: 0, width: 0.6, height: 1 } }, /cropRegion: x \+ width/],
		[
			{ webcam: { visibleRanges: [{ startMs: 0, endMs: 5 }] } },
			/webcam.visibleRanges is read-only/,
		],
		[{ borderRadius: 51 }, /borderRadius must be between 0 and 50/],
		[{ borderRadius: Number.NaN }, /borderRadius must be a number/],
		[{ shadowIntensity: -0.1 }, /shadowIntensity must be between 0 and 1/],
		[{ backgroundBlur: 9 }, /backgroundBlur must be between 0 and 8/],
		[{ crop: { x: 0.5, y: 0, width: 0.6, height: 1 } }, /larger than the frame/],
		[{ crop: { x: 0, y: 0, width: 0, height: 1 } }, /above 0/],
		[{ crop: { x: -1, y: 0, width: 1, height: 1 } }, /crop.x must be between/],
		[{ crop: { x: 0, y: 0, width: 1, height: 1, z: 1 } }, /unknown field z/],
		[{ webcam: { size: 5 } }, /webcam.size must be between 10 and 100/],
		[{ webcam: { corner: "middle" } }, /webcam.corner must be one of/],
		[{ webcam: { sourcePath: "/etc/passwd" } }, /webcam.sourcePath is read-only/],
		[{ webcam: { enabled: true } }, /no webcam recording/],
		[{ webcam: { mirror: "yes" } }, /webcam.mirror must be true or false/],
	])("refuses %j and changes nothing", (payload, message) => {
		const { calls, context } = makeContext();
		expect(() => set(payload, context)).toThrow(message);
		expect(calls).toEqual([]);
	});

	it("applies nothing when a later field is bad", () => {
		const { calls, context } = makeContext();
		expect(() => set({ borderRadius: 10, shadowIntensity: 2 }, context)).toThrow();
		expect(calls).toEqual([]);
	});
});

describe("look.motion", () => {
	it("applies the given knobs and reports them", () => {
		const { state, context } = makeContext();
		const result = motion(
			{
				zoomInDurationMs: 800,
				zoomInEasing: "snappy",
				cursorStyle: "dot",
				cursorClickEffect: "ripple",
				zoomClassicMode: true,
				cameraSpringMassMultiplier: 2,
			},
			context,
		);
		expect(state).toMatchObject({
			zoomInDurationMs: 800,
			zoomInEasing: "snappy",
			cursorStyle: "dot",
			cursorClickEffect: "ripple",
			zoomClassicMode: true,
			cameraSpringMassMultiplier: 2,
		});
		expect(result).toMatchObject({ undoable: false });
		expect(result.note).toMatch(/not part of the editor history/);
		expect(Object.keys(result.applied as object)).toHaveLength(6);
	});

	it("merges partial blur tuning into the current tuning", () => {
		const { state, context } = makeContext();
		motion({ zoomMotionBlurTuning: { maxDirectionalBlurPx: 10 } }, context);
		expect(state.zoomMotionBlurTuning).toEqual({
			...DEFAULT_ZOOM_MOTION_BLUR_TUNING,
			maxDirectionalBlurPx: 10,
		});
	});

	it("accepts both ends of a range and an overlap equal to the duration", () => {
		const { state, context } = makeContext();
		motion(
			{ cursorSize: 0.5, cursorSway: 2, zoomInDurationMs: 600, zoomInOverlapMs: 600 },
			context,
		);
		expect(state).toMatchObject({
			cursorSize: 0.5,
			cursorSway: 2,
			zoomInDurationMs: 600,
			zoomInOverlapMs: 600,
		});
	});

	it("applies none of the 25 knobs when the last one is out of range", () => {
		const { state, calls, context } = makeContext();
		expect(() =>
			motion(
				{
					cursorSize: 2,
					zoomInEasing: "snappy",
					zoomClassicMode: true,
					cursorStyle: "dot",
					zoomMotionBlurTuning: { maxDirectionalBlurPx: 10 },
					cameraSpringMassMultiplier: 99,
				},
				context,
			),
		).toThrow(/cameraSpringMassMultiplier must be between 0.25 and 3/);
		expect(calls).toEqual([]);
		expect(state.zoomMotionBlurTuning).toEqual(DEFAULT_ZOOM_MOTION_BLUR_TUNING);
		expect(state.cursorSize).toBeUndefined();
	});

	it.each([
		[{}, /at least one field/],
		[{ cursorColour: 1 }, /unknown field cursorColour/],
		[{ zoomInDurationMs: 59 }, /zoomInDurationMs must be between 60 and 4000/],
		[{ connectedZoomGapMs: 5001 }, /connectedZoomGapMs must be between 0 and 5000/],
		[{ zoomSmoothness: 1.1 }, /zoomSmoothness must be between 0 and 1/],
		[{ cursorSpringMassMultiplier: 0.1 }, /between 0.25 and 3/],
		[{ cameraSpringStiffnessMultiplier: 4 }, /between 0.25 and 3/],
		[{ cursorSize: Number.POSITIVE_INFINITY }, /cursorSize must be a number/],
		[
			{ zoomOutEasing: "bounce" },
			/zoomOutEasing must be one of recordly, glide, smooth, snappy, linear/,
		],
		[{ cursorStyle: "arrow" }, /cursorStyle must be one of/],
		[{ cursorClickEffect: "boom" }, /cursorClickEffect must be one of/],
		[{ zoomClassicMode: "on" }, /zoomClassicMode must be true or false/],
		[
			{ zoomMotionBlurTuning: { panResponsePerSecond: 0 } },
			/panResponsePerSecond must be between 1 and 30/,
		],
		[{ zoomMotionBlurTuning: { speed: 1 } }, /unknown field speed/],
		[{ zoomInOverlapMs: 2000 }, /cannot be longer than zoomInDurationMs \(1500\)/],
		[
			{ zoomInDurationMs: 300 },
			/zoomInOverlapMs \(500\) cannot be longer than zoomInDurationMs \(300\)/,
		],
	])("refuses %j and changes nothing", (payload, message) => {
		const { calls, context } = makeContext();
		expect(() => motion(payload, context)).toThrow(message);
		expect(calls).toEqual([]);
	});
});

describe("look.preset", () => {
	it("applies clean preset: padding 4, borderRadius 12, shadowIntensity 0.35, backgroundBlur 0", () => {
		const { state, context } = makeContext();
		const result = preset({ name: "clean" }, context);
		expect(state).toMatchObject({
			padding: { top: 4, bottom: 4, left: 4, right: 4, linked: true },
			borderRadius: 12,
			shadowIntensity: 0.35,
			backgroundBlur: 0,
		});
		expect(result).toMatchObject({
			applied: {
				padding: { top: 4, bottom: 4, left: 4, right: 4, linked: true },
				borderRadius: 12,
				shadowIntensity: 0.35,
				backgroundBlur: 0,
			},
			undoable: false,
		});
		expect(result.note).toMatch(/not part of the editor history/);
	});

	it("applies dark preset: padding 4, borderRadius 12, shadowIntensity 0.5, backgroundBlur 2, wallpaper tahoe-dark", () => {
		const { state, context } = makeContext();
		const result = preset({ name: "dark" }, context);
		expect(state).toMatchObject({
			padding: { top: 4, bottom: 4, left: 4, right: 4, linked: true },
			borderRadius: 12,
			shadowIntensity: 0.5,
			backgroundBlur: 2,
			wallpaper: "/wallpapers/tahoe-dark.jpg",
		});
		expect(result.applied).toMatchObject({
			padding: { top: 4, bottom: 4, left: 4, right: 4, linked: true },
			borderRadius: 12,
			shadowIntensity: 0.5,
			backgroundBlur: 2,
			wallpaper: "/wallpapers/tahoe-dark.jpg",
		});
	});

	it("applies none preset: padding 0, borderRadius 0, shadowIntensity 0, backgroundBlur 0", () => {
		const { state, context } = makeContext();
		const result = preset({ name: "none" }, context);
		expect(state).toMatchObject({
			padding: { top: 0, bottom: 0, left: 0, right: 0, linked: true },
			borderRadius: 0,
			shadowIntensity: 0,
			backgroundBlur: 0,
		});
		expect(result.applied).toMatchObject({
			padding: { top: 0, bottom: 0, left: 0, right: 0, linked: true },
			borderRadius: 0,
			shadowIntensity: 0,
			backgroundBlur: 0,
		});
	});

	it("is idempotent when applied twice", () => {
		const { state, context } = makeContext();
		preset({ name: "clean" }, context);
		const firstState = JSON.stringify(state);
		preset({ name: "clean" }, context);
		const secondState = JSON.stringify(state);
		expect(firstState).toBe(secondState);
	});

	it.each([
		[{}, /name is required/],
		[{ name: undefined }, /name is required/],
		[{ name: "minimal" }, /name must be one of clean, dark, none/],
		[{ name: "CLEAN" }, /name must be one of clean, dark, none/],
		[{ name: 123 }, /name must be one of clean, dark, none/],
		[{ name: "clean", extra: true }, /unknown field extra/],
		[{ name: "dark", wallpaper: "#000" }, /unknown field wallpaper/],
	])("refuses %j and changes nothing", (payload, message) => {
		const { calls, context } = makeContext();
		expect(() => preset(payload, context)).toThrow(message);
		expect(calls).toEqual([]);
	});
});
