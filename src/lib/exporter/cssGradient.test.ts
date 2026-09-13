import { describe, expect, it, vi } from "vitest";
import {
	createCanvasGradientFromCss,
	getLinearGradientGeometry,
	getRadialGradientGeometry,
	resolveColorStops,
	splitCssGradientArguments,
} from "./cssGradient";

function createMockContext() {
	const gradient = { addColorStop: vi.fn() };
	const ctx = {
		createLinearGradient: vi.fn(() => gradient),
		createRadialGradient: vi.fn(() => gradient),
	};
	return { ctx, gradient, typedCtx: ctx as unknown as CanvasRenderingContext2D };
}

describe("splitCssGradientArguments", () => {
	it("keeps commas inside rgba() intact", () => {
		expect(splitCssGradientArguments("90deg, rgba(1, 2, 3, 0.5) 10%, #fff")).toEqual([
			"90deg",
			"rgba(1, 2, 3, 0.5) 10%",
			"#fff",
		]);
	});
});

describe("resolveColorStops", () => {
	it("uses explicit percentage positions", () => {
		expect(resolveColorStops(["rgba(1,2,3,1) 9.4%", "#fff 86.3%"], 100)).toEqual([
			{ color: "rgba(1,2,3,1)", offset: 0.094 },
			{ color: "#fff", offset: 0.863 },
		]);
	});

	it("interpolates missing positions between known stops", () => {
		expect(resolveColorStops(["red", "green", "blue"], 100)).toEqual([
			{ color: "red", offset: 0 },
			{ color: "green", offset: 0.5 },
			{ color: "blue", offset: 1 },
		]);
	});

	it("clamps positions beyond 100% and keeps offsets non-decreasing", () => {
		expect(resolveColorStops(["red 50%", "blue 20%", "green 100.2%"], 100)).toEqual([
			{ color: "red", offset: 0.5 },
			{ color: "blue", offset: 0.5 },
			{ color: "green", offset: 1 },
		]);
	});
});

describe("getLinearGradientGeometry", () => {
	it("maps 90deg to a left-to-right line across the width", () => {
		expect(getLinearGradientGeometry(90, 200, 100)).toMatchObject({
			x0: 0,
			x1: 200,
		});
	});

	it("maps 180deg to a top-to-bottom line across the height", () => {
		const geometry = getLinearGradientGeometry(180, 200, 100);
		expect(geometry.y0).toBeCloseTo(0);
		expect(geometry.y1).toBeCloseTo(100);
	});
});

describe("getRadialGradientGeometry", () => {
	it("positions a farthest-corner circle at the given percentages", () => {
		const geometry = getRadialGradientGeometry("circle farthest-corner at 10% 20%", 1000, 500);
		expect(geometry.cx).toBeCloseTo(100);
		expect(geometry.cy).toBeCloseTo(100);
		expect(geometry.radius).toBeCloseTo(Math.hypot(900, 400));
	});

	it("defaults to a centered farthest-corner gradient", () => {
		const geometry = getRadialGradientGeometry("", 200, 100);
		expect(geometry).toMatchObject({ cx: 100, cy: 50 });
		expect(geometry.radius).toBeCloseTo(Math.hypot(100, 50));
	});
});

describe("createCanvasGradientFromCss", () => {
	it("does not treat radial shape keywords as colors", () => {
		const { gradient, typedCtx } = createMockContext();

		const result = createCanvasGradientFromCss(
			typedCtx,
			"radial-gradient( circle farthest-corner at 3.2% 49.6%,  rgba(80,12,139,0.87) 0%, rgba(161,10,144,0.72) 83.6% )",
			{ width: 1000, height: 500 },
		);

		expect(result).toBe(gradient);
		expect(gradient.addColorStop).toHaveBeenCalledTimes(2);
		expect(gradient.addColorStop).toHaveBeenNthCalledWith(1, 0, "rgba(80,12,139,0.87)");
		expect(gradient.addColorStop).toHaveBeenNthCalledWith(2, 0.836, "rgba(161,10,144,0.72)");
	});

	it("builds a horizontal linear gradient for `to right`", () => {
		const { ctx, typedCtx } = createMockContext();

		createCanvasGradientFromCss(
			typedCtx,
			"linear-gradient(to right, #4facfe 0%, #00f2fe 100%)",
			{
				width: 200,
				height: 100,
			},
		);

		const [x0, y0, x1, y1] = ctx.createLinearGradient.mock.calls[0] as unknown as number[];
		expect([x0, y0, x1, y1].map((value) => Math.round(value))).toEqual([0, 50, 200, 50]);
	});

	it("skips invalid colors instead of throwing", () => {
		const { gradient, typedCtx } = createMockContext();
		gradient.addColorStop.mockImplementation((_offset: number, color: string) => {
			if (color === "notacolor") throw new SyntaxError("invalid color");
		});
		vi.spyOn(console, "warn").mockImplementation(() => {});

		expect(() =>
			createCanvasGradientFromCss(typedCtx, "linear-gradient(notacolor, #fff)", {
				width: 100,
				height: 100,
			}),
		).not.toThrow();
	});

	it("returns null for non-gradient values", () => {
		const { typedCtx } = createMockContext();
		expect(
			createCanvasGradientFromCss(typedCtx, "#ffffff", { width: 1, height: 1 }),
		).toBeNull();
	});
});
