import { expect, test } from "@playwright/test";
import type { checkEdges } from "./webcam-edge";

test("webcam edges, content and shadows align with blur enabled, settled and disabled", async ({
	page,
}, testInfo) => {
	test.setTimeout(60000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/tests/ui/webcam-edge.html");
	const results = await page.evaluate(() =>
		(window as unknown as { checkEdges: typeof checkEdges }).checkEdges(),
	);
	for (const result of results) {
		const [still, shrinking, growing, stopped, settled, disabled] = result.exporterDifferences;
		for (const corner of result.rectangleCorners) {
			expect(corner[3], "rectangle corners retain the webcam image").toBe(255);
			expect(corner[0]).toBeGreaterThan(170);
			expect(corner[0]).toBeLessThan(190);
		}
		expect(
			[still, stopped, settled, disabled],
			`${result.shape}, shadow ${result.shadow}, crop/mirror ${result.cropped}`,
		).toEqual([0, 0, 0, 0]);
		// Eight additive shutter samples can amplify a one-level VideoFrame/canvas
		// conversion difference. Stationary edges above must match exactly.
		expect(Math.max(shrinking, growing)).toBeLessThanOrEqual(8);
		expect(result.stationaryDifferences).toEqual([
			[0, 0, 0],
			[0, 0, 0],
		]);
	}
	expect(errors).toEqual([]);
	await page.screenshot({ path: testInfo.outputPath("webcam-edges.png"), fullPage: true });
});
