import { describe, expect, it, vi } from "vitest";
import {
	createLinearGradientBackground,
	drawLinearGradientBackground,
} from "./linearGradientBackground";

function mockContext() {
	const gradient = { addColorStop: vi.fn() };
	const ctx = {
		createLinearGradient: vi.fn(() => gradient),
		fillRect: vi.fn(),
		fillStyle: "",
	} as unknown as CanvasRenderingContext2D;
	return { ctx, gradient };
}

describe("custom gradient export", () => {
	it.each([
		[0, [100, 100, 100, 0]],
		[90, [0, 50, 200, 50]],
		[180, [100, 0, 100, 100]],
		[270, [200, 50, 0, 50]],
	])("matches CSS direction at %ideg", (angle, endpoints) => {
		const { ctx } = mockContext();
		createLinearGradientBackground(
			ctx,
			`linear-gradient(${angle}deg, #ff0000 0%, #0000ff 100%)`,
			200,
			100,
		);
		const actual = vi.mocked(ctx.createLinearGradient).mock.calls[0];
		endpoints.forEach((value, index) => expect(actual[index]).toBeCloseTo(value));
	});

	it("uses CSS corner projection for a diagonal on a rectangular frame", () => {
		const { ctx } = mockContext();
		createLinearGradientBackground(
			ctx,
			"linear-gradient(135deg, #ff0000 0%, #0000ff 100%)",
			200,
			100,
		);
		const actual = vi.mocked(ctx.createLinearGradient).mock.calls[0];
		[25, -25, 175, 125].forEach((value, index) => expect(actual[index]).toBeCloseTo(value));
	});

	it("preserves explicit stop positions and fills the entire background", () => {
		const { ctx, gradient } = mockContext();
		expect(
			drawLinearGradientBackground(
				ctx,
				"linear-gradient(45deg, #123456 0%, #abcdef 20%, #987654 100%)",
				1920,
				1080,
			),
		).toBe(true);
		expect(gradient.addColorStop.mock.calls).toEqual([
			[0, "#123456"],
			[0.2, "#abcdef"],
			[1, "#987654"],
		]);
		expect(ctx.fillStyle).toBe(gradient);
		expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1920, 1080);
	});

	it.each([
		"radial-gradient(circle, #fff 0%, #000 100%)",
		"linear-gradient(90deg, #invalid 0%, #000 100%)",
	])("leaves unsupported or malformed backgrounds to existing fallback: %s", (css) => {
		const { ctx } = mockContext();
		expect(drawLinearGradientBackground(ctx, css, 200, 100)).toBe(false);
		expect(ctx.createLinearGradient).not.toHaveBeenCalled();
		expect(ctx.fillRect).not.toHaveBeenCalled();
	});
});
