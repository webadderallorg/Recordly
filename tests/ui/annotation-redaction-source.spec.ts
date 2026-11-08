import { expect, test } from "@playwright/test";

test("solid redaction output is independent of hidden content in both moving export renderers", async ({
	page,
}) => {
	test.setTimeout(60_000);
	await page.goto("/tests/ui/annotation-redaction-source.html");
	await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
	const result = await page.evaluate(() =>
		(
			window as unknown as {
				solidMaskChecks(): Promise<{
					controlDifferent: boolean;
					results: { kind: string; frames: number; differingBytes: number }[];
				}>;
			}
		).solidMaskChecks(),
	);
	expect(result.controlDifferent).toBe(true);
	expect(result.results).toHaveLength(2);
	for (const row of result.results) {
		expect(row.frames).toBe(8);
		expect(row.differingBytes, `${row.kind} must not retain hidden source information`).toBe(0);
	}
});

test("source redaction preserves crop, edge, alpha and overlap coverage in real canvas pixels", async ({
	page,
}) => {
	await page.goto("/tests/ui/annotation-redaction-source.html");
	await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
	const result = await page.evaluate(() =>
		(
			window as unknown as {
				sourceChecks(): Promise<{
					results: {
						blurColor: string;
						contrast: number;
						center: number[];
						unchanged: number[];
					}[];
					originalContrast: number;
					croppedInside: number[];
					croppedOutside: number[];
					sameCanvas: boolean;
					edge: number[];
					overlap: number[];
					retainedDimensions: number[];
				}>;
			}
		).sourceChecks(),
	);
	expect(result.originalContrast).toBe(255);
	for (const sample of result.results) {
		expect(sample.contrast, sample.blurColor).toBeLessThanOrEqual(8);
		expect(sample.unchanged).toEqual([128, 128, 128, 255]);
		if (sample.blurColor === "#000000") expect(sample.center).toEqual([0, 0, 0, 255]);
	}
	expect(result.croppedInside).toEqual([0, 0, 0, 255]);
	expect(result.croppedOutside).toEqual([128, 128, 128, 255]);
	expect(result.sameCanvas).toBe(true);
	expect(result.edge.slice(0, 3)).toEqual([128, 128, 128]);
	expect(result.edge[3]).toBeGreaterThanOrEqual(254);
	expect(result.overlap).toEqual([255, 255, 255, 255]);
	expect(result.retainedDimensions).toEqual([320, 180]);
});

test("pre-redaction removes private high-frequency detail from moving export filter trails", async ({
	page,
}) => {
	test.setTimeout(60_000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/tests/ui/annotation-redaction-source.html");
	await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
	const result = await page.evaluate(() =>
		(
			window as unknown as {
				movingChecks(): Promise<
					{ kind: string; mode: string; frames: number; maximumTrailContrast: number }[]
				>;
			}
		).movingChecks(),
	);
	for (const kind of ["modern", "legacy"]) {
		const sourceFirst = result.find((row) => row.kind === kind && row.mode === "source-first")!;
		const control = result.find(
			(row) => row.kind === kind && row.mode === "post-only-control",
		)!;
		expect(sourceFirst.frames).toBe(17);
		expect(
			control.maximumTrailContrast,
			`${kind} must expose the pre-fix control leak`,
		).toBeGreaterThan(20);
		expect(
			sourceFirst.maximumTrailContrast,
			`${kind} private detail outside the current mask`,
		).toBeLessThanOrEqual(8);
	}
	expect(errors).toEqual([]);
});
