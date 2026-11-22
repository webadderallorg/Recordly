import { expect, it } from "vitest";
import { annotationPlacement } from "./annotationPlacement";

it("places new annotations in the camera viewport rather than an offscreen source center", () => {
	const viewport = { width: 1000, height: 600 };
	const recording = { x: 0, y: 0, width: 1000, height: 600 };
	const transform = { scale: 5, x: -3500, y: -2000 };
	const result = annotationPlacement(viewport, recording, transform)!;
	const x = (result.position.x / 100) * recording.width * transform.scale + transform.x;
	const y = (result.position.y / 100) * recording.height * transform.scale + transform.y;
	expect(x).toBeCloseTo(350);
	expect(y).toBeCloseTo(240);
	expect((result.size.width / 100) * recording.width * transform.scale).toBeCloseTo(300);
	expect((result.size.height / 100) * recording.height * transform.scale).toBeCloseTo(120);
});

it("keeps new annotations inside visible padded recording content", () => {
	const result = annotationPlacement(
		{ width: 1000, height: 600 },
		{ x: 100, y: 100, width: 800, height: 400 },
		{ scale: 1, x: 0, y: 0 },
	)!;
	expect(result.position).toEqual({ x: 35, y: 40 });
	expect(result.size).toEqual({ width: 30, height: 20 });
});

it("defers placement when the scene is not ready", () => {
	expect(
		annotationPlacement(
			{ width: 0, height: 0 },
			{ x: 0, y: 0, width: 0, height: 0 },
			{ scale: 1, x: 0, y: 0 },
		),
	).toBeNull();
});
