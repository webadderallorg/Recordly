import { describe, expect, it, vi } from "vitest";
import { createCssGradientBackground } from "./cssGradientBackground";

function context() {
	const gradient = { addColorStop: vi.fn() };
	const ctx = {
		createLinearGradient: vi.fn(() => gradient),
		createRadialGradient: vi.fn(() => gradient),
	} as unknown as CanvasRenderingContext2D;
	return { ctx, gradient };
}

describe("CSS export gradients", () => {
	it("keeps rgba components together and preserves percentages", () => {
		const { ctx, gradient } = context();
		expect(
			createCssGradientBackground(
				ctx,
				"linear-gradient(111.6deg, rgba(114,167,232,1) 9.4%, rgba(253,129,82,1) 43.9%, rgba(249,202,86,1) 86.3%)",
				200,
				100,
			),
		).toBe(gradient);
		expect(gradient.addColorStop.mock.calls).toEqual([
			[0.094, "rgba(114,167,232,1)"],
			[0.439, "rgba(253,129,82,1)"],
			[0.863, "rgba(249,202,86,1)"],
		]);
	});

	it("resolves omitted positions between explicit anchors", () => {
		const { ctx, gradient } = context();
		createCssGradientBackground(
			ctx,
			"linear-gradient(to right, red, #123456 20%, rgb(10, 20, 30), blue 80%, white)",
			200,
			100,
		);
		expect(gradient.addColorStop.mock.calls).toEqual([
			[0, "red"],
			[0.2, "#123456"],
			[0.5, "rgb(10, 20, 30)"],
			[0.8, "blue"],
			[1, "white"],
		]);
		const endpoints = vi.mocked(ctx.createLinearGradient).mock.calls[0];
		[0, 50, 200, 50].forEach((value, index) => expect(endpoints[index]).toBeCloseTo(value));
	});

	it("supports duplicate stops and CSS position fixup", () => {
		const { ctx, gradient } = context();
		createCssGradientBackground(ctx, "linear-gradient(red 20% 40%, blue 30%, white)", 200, 100);
		expect(gradient.addColorStop.mock.calls).toEqual([
			[0.2, "red"],
			[0.4, "red"],
			[0.4, "blue"],
			[1, "white"],
		]);
	});

	it("uses CSS magic corners for directional diagonals", () => {
		const { ctx } = context();
		createCssGradientBackground(ctx, "linear-gradient(to top right, red, blue)", 200, 100);
		const endpoints = vi.mocked(ctx.createLinearGradient).mock.calls[0];
		[60, 130, 140, -30].forEach((value, index) => expect(endpoints[index]).toBeCloseTo(value));
	});

	it("uses positioned farthest-corner circles and preserves a stop beyond 100%", () => {
		const { ctx, gradient } = context();
		createCssGradientBackground(
			ctx,
			"radial-gradient(circle farthest-corner at 10% 20%, rgba(2,37,78,1) 0%, rgba(85,245,221,1) 100.2%)",
			200,
			100,
		);
		const args = vi.mocked(ctx.createRadialGradient).mock.calls[0];
		expect(args.slice(0, 5)).toEqual([20, 20, 0, 20, 20]);
		expect(args[5]).toBeCloseTo(Math.hypot(180, 80) * 1.002);
		expect(gradient.addColorStop.mock.calls).toEqual([
			[0, "rgba(2,37,78,1)"],
			[1, "rgba(85,245,221,1)"],
		]);
	});

	it("supports centered and keyword-positioned circles", () => {
		const { ctx } = context();
		createCssGradientBackground(ctx, "radial-gradient(circle, red, blue)", 200, 100);
		expect(ctx.createRadialGradient).toHaveBeenLastCalledWith(
			100,
			50,
			0,
			100,
			50,
			Math.hypot(100, 50),
		);
		createCssGradientBackground(
			ctx,
			"radial-gradient(circle closest-side at top, red, blue)",
			200,
			100,
		);
		// A zero-radius closest-side circle is unsupported rather than throwing.
		expect(ctx.createRadialGradient).toHaveBeenCalledTimes(1);
		createCssGradientBackground(
			ctx,
			"radial-gradient(circle farthest-side at bottom left, red, blue)",
			200,
			100,
		);
		expect(ctx.createRadialGradient).toHaveBeenLastCalledWith(0, 100, 0, 0, 100, 200);
	});

	it.each([
		"linear-gradient(to left right, red, blue)",
		"linear-gradient(90deg, #invalid, blue)",
		"linear-gradient(90deg, rgb(1, 2, blue)",
		"linear-gradient(red)",
	])("rejects malformed gradients: %s", (css) => {
		const { ctx } = context();
		expect(createCssGradientBackground(ctx, css, 200, 100)).toBeNull();
	});

	it("matches CSS premultiplied interpolation when alpha changes", () => {
		const { ctx, gradient } = context();
		createCssGradientBackground(
			ctx,
			"linear-gradient(90deg, rgba(255,0,0,0.5), rgba(0,0,255,1))",
			200,
			100,
		);
		expect(gradient.addColorStop.mock.calls).toContainEqual([0.5, "rgba(85,0,170,0.75)"]);
		expect(gradient.addColorStop.mock.calls[0]).toEqual([0, "rgba(255,0,0,0.5)"]);
		expect(gradient.addColorStop.mock.calls.at(-1)).toEqual([1, "rgba(0,0,255,1)"]);
	});

	it("returns null when Canvas rejects an invalid color", () => {
		const { ctx, gradient } = context();
		gradient.addColorStop.mockImplementation(() => {
			throw new Error("invalid color");
		});
		expect(
			createCssGradientBackground(ctx, "linear-gradient(invalid, blue)", 200, 100),
		).toBeNull();
	});
});
