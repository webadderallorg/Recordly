import { expect, test } from "@playwright/test";
import type { ExportProgress } from "../../src/lib/exporter/types";

test("solid masks replace hidden pixels in every decoded frame of a real H.264 MP4", async ({
	page,
}) => {
	test.setTimeout(90_000);
	await page.route("**/tests/ui/wasm/web-demuxer.wasm", (route) =>
		route.fulfill({ path: "public/wasm/web-demuxer.wasm", contentType: "application/wasm" }),
	);
	await page.goto("/tests/ui/modern-video-export.html");
	await page.getByRole("button", { name: "Export solid mask MP4", exact: true }).click();
	await expect(page.locator("#result")).toHaveAttribute("data-state", "done", {
		timeout: 75_000,
	});
	const result = JSON.parse(await page.locator("#result").innerText());
	expect(result.error, JSON.stringify(result)).toBeUndefined();
	expect(result.success).toBe(true);
	expect(result.output).toMatchObject({ container: "mp4", codec: "avc", frameCount: 90 });
	expect(result.playback.advanced).toBe(true);
	expect(result.playback.centerMaximumRgb).toHaveLength(90);
	for (const maximum of result.playback.centerMaximumRgb) expect(maximum).toBeLessThanOrEqual(5);
});

test("real ModernVideoExporter produces a playable H.264 MP4 through WebCodecs", async ({
	page,
}, testInfo) => {
	test.setTimeout(90_000);
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await page.route("**/tests/ui/wasm/web-demuxer.wasm", (route) =>
		route.fulfill({ path: "public/wasm/web-demuxer.wasm", contentType: "application/wasm" }),
	);
	await page.goto("/tests/ui/modern-video-export.html");
	await page.getByRole("button", { name: "Export real MP4", exact: true }).click();
	await expect(page.locator("#result")).toHaveAttribute("data-state", "done", {
		timeout: 75_000,
	});
	const result = JSON.parse(await page.locator("#result").innerText());
	await testInfo.attach("export-report.json", {
		body: JSON.stringify(result, null, 2),
		contentType: "application/json",
	});
	// Unsupported codec environments must fail with their recorded reason, not silently skip.
	expect(result.error, JSON.stringify(result)).toBeUndefined();
	expect(result.success).toBe(true);
	expect(result.bytes).toBeGreaterThan(1_000);
	expect(result.mime).toBe("video/mp4");
	expect(result.source.duration).toBeCloseTo(6, 5);
	expect(result.source.audioTracks).toBe(0); // Both checked-in MP4 fixtures are silent.
	expect(result.output).toMatchObject({
		container: "mp4",
		codec: "avc",
		width: 320,
		height: 180,
		audioTracks: 0,
	});
	expect(result.output.codecParameter).toMatch(/^avc[13]\./);
	expect(Math.abs(result.output.duration - result.source.duration)).toBeLessThanOrEqual(1 / 15);
	expect(result.playback).toMatchObject({ width: 320, height: 180, advanced: true });
	expect(Math.abs(result.playback.duration - result.source.duration)).toBeLessThanOrEqual(1 / 15);
	expect(new Set(result.playback.hashes).size).toBe(2);
	expect(result.metrics).toMatchObject({
		encodeBackend: "webcodecs",
		frameCount: 90,
		effectiveDurationSec: 6,
	});
	expect(result.metrics.renderBackend).toMatch(/^(webgl|webgpu)$/);
	expect(result.metrics.diagnostics).toMatchObject({
		requestedBackend: "webcodecs",
		encoder: { api: "webcodecs" },
		muxer: "mediabunny",
	});
	const progress = result.progress as ExportProgress[];
	expect(
		progress.some((update) => update.phase === "extracting" && update.currentFrame > 0),
	).toBe(true);
	expect(progress[progress.length - 1]).toMatchObject({
		phase: "finalizing",
		currentFrame: 90,
		totalFrames: 90,
		encodeBackend: "webcodecs",
	});
	expect(
		progress.every(
			(update) =>
				Number.isFinite(update.percentage) &&
				update.percentage >= 0 &&
				update.percentage <= 100,
		),
	).toBe(true);
	// Rendering completion is separate from the finalization progress below 100%.
	const extracting = progress.filter((update) => update.phase === "extracting");
	expect(extracting[extracting.length - 1]?.percentage).toBe(100);
	expect(
		progress
			.filter((update) => update.phase === "finalizing")
			.every((update) => update.percentage < 100),
	).toBe(true);
	expect(pageErrors).toEqual([]);
});

for (const scenario of [
	{
		name: "clean",
		button: "Export clean with renderer recovery",
		annotationCount: 0,
		sampleTimes: [0.5, 5.5],
	},
	{
		name: "active blur",
		button: "Export with renderer recovery",
		annotationCount: 2,
		sampleTimes: [0.5, 2, 3.5, 5.5],
	},
]) {
	test(`a failed real Lightning renderer recovers once through a fresh compositor with ${scenario.name}`, async ({
		page,
	}, testInfo) => {
		test.setTimeout(120_000);
		const pageErrors: string[] = [];
		page.on("pageerror", (error) => pageErrors.push(error.message));
		await page.route("**/tests/ui/wasm/web-demuxer.wasm", (route) =>
			route.fulfill({
				path: "public/wasm/web-demuxer.wasm",
				contentType: "application/wasm",
			}),
		);
		await page.goto("/tests/ui/modern-video-export.html");
		await page.getByRole("button", { name: scenario.button, exact: true }).click();
		await expect(page.locator("#result")).toHaveAttribute("data-state", "done", {
			timeout: 105_000,
		});
		const result = JSON.parse(await page.locator("#result").innerText());
		await testInfo.attach("renderer-recovery-report.json", {
			body: JSON.stringify(result, null, 2),
			contentType: "application/json",
		});
		expect(result.error, JSON.stringify(result)).toBeUndefined();
		expect(result.success).toBe(true);
		expect(result.pipelineModel).toBe("legacy");
		expect(result.recovery).toMatchObject({ route: "compatibility" });
		expect(result.recovery.initialError).toContain("Injected compositor recovery test failure");
		expect(result.attempts).toEqual([
			{ route: "modern", success: false, failureStage: "renderer" },
			{ route: "compatibility", success: true },
		]);
		expect(result.factorySettings.map((settings: { route: string }) => settings.route)).toEqual(
			["modern", "compatibility"],
		);
		const { route: _primaryRoute, ...primarySettings } = result.factorySettings[0];
		const { route: _recoveryRoute, ...recoverySettings } = result.factorySettings[1];
		expect(recoverySettings).toEqual(primarySettings);
		expect(recoverySettings.annotationRegions ?? []).toHaveLength(scenario.annotationCount);
		expect(recoverySettings).toMatchObject({
			width: 320,
			height: 180,
			frameRate: 15,
			bitrate: 1_000_000,
		});
		if (scenario.annotationCount) expect(recoverySettings.zoomClassicMode).toBe(true);
		expect(result.bytes).toBeGreaterThan(1000);
		expect(result.output).toMatchObject({
			container: "mp4",
			codec: "avc",
			width: 320,
			height: 180,
			frameCount: 90,
		});
		expect(result.output.codecParameter).toMatch(/^avc[13]\./);
		expect(result.output.frameCount).toBeGreaterThan(64);
		expect(Math.abs(result.output.duration - 6)).toBeLessThanOrEqual(1 / 15);
		expect(result.playback).toMatchObject({
			width: 320,
			height: 180,
			advanced: true,
			sampleTimes: scenario.sampleTimes,
		});
		expect(result.playback.hashes).toHaveLength(scenario.sampleTimes.length);
		expect(Math.abs(result.playback.duration - 6)).toBeLessThanOrEqual(1 / 15);
		expect(new Set(result.playback.hashes).size).toBeGreaterThan(1);
		expect(result.metrics).toMatchObject({ frameCount: 90, effectiveDurationSec: 6 });
		expect(pageErrors).toEqual([]);
	});
}

test("cancelling as Lightning fails prevents creation of the recovery pipeline", async ({
	page,
}) => {
	test.setTimeout(90_000);
	await page.route("**/tests/ui/wasm/web-demuxer.wasm", (route) =>
		route.fulfill({ path: "public/wasm/web-demuxer.wasm", contentType: "application/wasm" }),
	);
	await page.goto("/tests/ui/modern-video-export.html");
	await page
		.getByRole("button", { name: "Cancel before renderer recovery", exact: true })
		.click();
	await expect(page.locator("#result")).toHaveAttribute("data-state", "done", {
		timeout: 75_000,
	});
	const result = JSON.parse(await page.locator("#result").innerText());
	expect(result.error, JSON.stringify(result)).toBeUndefined();
	expect(result.cancelled).toBe(true);
	expect(result.result).toMatchObject({ success: false, error: "Export cancelled" });
	expect(result.recovery).toBeNull();
	expect(result.factorySettings.map((settings: { route: string }) => settings.route)).toEqual([
		"modern",
	]);
	expect(result.attempts).toEqual([
		{ route: "modern", success: false, failureStage: "renderer" },
	]);
});

test("real MP4 export keeps every frame while active blur regions cross zoomed viewport edges", async ({
	page,
}, testInfo) => {
	test.setTimeout(90_000);
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await page.route("**/tests/ui/wasm/web-demuxer.wasm", (route) =>
		route.fulfill({ path: "public/wasm/web-demuxer.wasm", contentType: "application/wasm" }),
	);
	await page.goto("/tests/ui/modern-video-export.html");
	await page.getByRole("button", { name: "Export zoomed edge blur MP4", exact: true }).click();
	await expect(page.locator("#result")).toHaveAttribute("data-state", "done", {
		timeout: 75_000,
	});
	const result = JSON.parse(await page.locator("#result").innerText());
	await testInfo.attach("zoomed-edge-blur-export-report.json", {
		body: JSON.stringify(result, null, 2),
		contentType: "application/json",
	});
	expect(result.error, JSON.stringify(result)).toBeUndefined();
	expect(result.scenario).toBe("zoomed-edge-blur");
	expect(result.success).toBe(true);
	expect(result.bytes).toBeGreaterThan(1_000);
	expect(result.mime).toBe("video/mp4");
	expect(result.effects.annotationRegions).toHaveLength(2);
	expect(
		result.effects.annotationRegions.every(
			(annotation: { type: string; startMs: number; endMs: number }) =>
				annotation.type === "blur" && annotation.startMs === 0 && annotation.endMs === 6000,
		),
	).toBe(true);
	expect(result.effects.zoomRegions).toMatchObject([
		{ depth: 2, focus: { cx: 0.5, cy: 0.5 }, startMs: 1000, endMs: 4000 },
	]);
	expect(result.source.duration).toBeCloseTo(6, 5);
	expect(result.output).toMatchObject({
		container: "mp4",
		codec: "avc",
		width: 320,
		height: 180,
		frameCount: 90,
	});
	expect(result.output.codecParameter).toMatch(/^avc[13]\./);
	expect(result.output.frameCount).toBeGreaterThan(64);
	expect(Math.abs(result.output.duration - result.source.duration)).toBeLessThanOrEqual(1 / 15);
	expect(result.playback).toMatchObject({
		width: 320,
		height: 180,
		advanced: true,
		sampleTimes: [0.5, 2, 3.5, 5.5],
	});
	expect(Math.abs(result.playback.duration - result.source.duration)).toBeLessThanOrEqual(1 / 15);
	expect(result.playback.hashes).toHaveLength(4);
	expect(new Set(result.playback.hashes).size).toBeGreaterThan(1);
	expect(result.metrics).toMatchObject({
		encodeBackend: "webcodecs",
		frameCount: 90,
		effectiveDurationSec: 6,
	});
	const progress = result.progress as ExportProgress[];
	expect(progress[progress.length - 1]).toMatchObject({
		phase: "finalizing",
		currentFrame: 90,
		totalFrames: 90,
	});
	expect(pageErrors).toEqual([]);
});

test("a real WebCodecs encoder failure recovers with software H.264 or reports its actual unavailability", async ({
	page,
}, testInfo) => {
	test.setTimeout(120_000);
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await page.route("**/tests/ui/wasm/web-demuxer.wasm", (route) =>
		route.fulfill({ path: "public/wasm/web-demuxer.wasm", contentType: "application/wasm" }),
	);
	await page.goto("/tests/ui/modern-video-export.html");
	await page
		.getByRole("button", { name: "Export with software encoder recovery", exact: true })
		.click();
	await expect(page.locator("#result")).toHaveAttribute("data-state", "done", {
		timeout: 105_000,
	});
	const result = JSON.parse(await page.locator("#result").innerText());
	await testInfo.attach("software-encoder-recovery-report.json", {
		body: JSON.stringify(result, null, 2),
		contentType: "application/json",
	});
	// Headless/software-only browsers cannot exercise a real hardware encoder failure.
	// Keep the capability report and distinguish this prerequisite from a passing recovery.
	test.skip(
		typeof result.error === "string" && result.error.startsWith("[HARDWARE_H264_UNAVAILABLE]"),
		"Requires a configured hardware H.264 encoder; run this smoke on GPU-backed Chromium.",
	);
	expect(result.error, JSON.stringify(result)).toBeUndefined();
	expect(result.factories).toEqual(["modern", "software"]);
	expect(result.injectedFailures).toMatchObject([
		{ state: "configured", name: "InvalidStateError" },
	]);
	expect(result.attempts).toHaveLength(2);
	expect(result.attempts[0]).toMatchObject({
		route: "modern",
		result: {
			success: false,
			failureStage: "encoder",
			metrics: {
				diagnostics: {
					encoder: { api: "webcodecs", hardwareAcceleration: "prefer-hardware" },
				},
			},
		},
	});
	expect(result.recovery).toMatchObject({ route: "software" });
	expect(result.recovery.initialError).toContain(
		result.injectedFailures[0].message.replace(/^InvalidStateError: /, ""),
	);
	expect(result.pipelineModel).toBe("modern");
	if (result.capability.softwareH264) {
		expect(result.success, JSON.stringify(result)).toBe(true);
		expect(result.attempts[1]).toMatchObject({ route: "software", result: { success: true } });
		expect(result.metrics.diagnostics.encoder).toMatchObject({
			api: "webcodecs",
			hardwareAcceleration: "prefer-software",
		});
		expect(result.metrics).toMatchObject({
			encodeBackend: "webcodecs",
			frameCount: 90,
			effectiveDurationSec: 6,
		});
		expect(result.bytes).toBeGreaterThan(1000);
		expect(result.output).toMatchObject({
			container: "mp4",
			codec: "avc",
			width: 320,
			height: 180,
			frameCount: 90,
		});
		expect(result.output.codecParameter).toMatch(/^avc[13]\./);
		expect(Math.abs(result.output.duration - 6)).toBeLessThanOrEqual(1 / 15);
		expect(result.playback).toMatchObject({ width: 320, height: 180, advanced: true });
		expect(Math.abs(result.playback.duration - 6)).toBeLessThanOrEqual(1 / 15);
		expect(new Set(result.playback.hashes).size).toBe(2);
	} else {
		// This is an explicit unsupported-capability assertion, not a skipped test
		// or a claim that the browser produced a recovered MP4.
		testInfo.annotations.push({
			type: "software-h264-unavailable",
			description:
				"All real prefer-software H.264 probes were rejected; verified bounded failure with no output.",
		});
		expect(result.capability.softwareProbes.length).toBeGreaterThan(0);
		expect(
			result.capability.softwareProbes.every(
				(probe: { supported: boolean }) => !probe.supported,
			),
		).toBe(true);
		expect(result.success).toBe(false);
		expect(result.attempts[1]).toMatchObject({
			route: "software",
			result: { success: false, failureStage: "pipeline" },
		});
		expect(result.recoveryFailure).toContain("Software encoding retry failed");
		expect(result.noOutput).toBe(true);
		expect(result.bytes).toBeUndefined();
		expect(result.output).toBeUndefined();
	}
	expect(pageErrors).toEqual([]);
});
