import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	handle: vi.fn(),
	directory: "",
	gpuInfo: vi.fn(),
	screen: { getPrimaryDisplay: vi.fn(), getAllDisplays: vi.fn() },
}));
vi.mock("electron", () => ({
	app: {
		getAppPath: () => "/recordly",
		getPath: () => state.directory,
		getVersion: () => "2.0.0-beta.1",
		getGPUInfo: state.gpuInfo,
		getGPUFeatureStatus: () => ({ webgl: "enabled", webgpu: "disabled_software" }),
		runningUnderARM64Translation: true,
		on: vi.fn(),
	},
	ipcMain: { handle: state.handle },
	screen: state.screen,
}));
vi.mock("../../rendererServer", () => ({
	getPackagedRendererBaseUrl: () => "http://127.0.0.1:43820/",
}));

import {
	collectExportRuntimeInfo,
	drainAppProcessDiagnostics,
	installAppProcessDiagnostics,
	recordAppProcessDiagnostic,
	registerExportDiagnosticHandlers,
	startMainDiagnosticOperation,
} from "./exportDiagnostics";

const frame = { url: "http://127.0.0.1:43820/?windowType=editor" };
const event = { senderFrame: frame, sender: { mainFrame: frame } };
const handler = (name: string) =>
	state.handle.mock.calls.findLast(([channel]) => channel === name)![1];
beforeEach(async () => {
	state.directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-export-log-test-"));
	state.handle.mockClear();
	registerExportDiagnosticHandlers();
});
afterEach(async () => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	await fs.rm(state.directory, { recursive: true, force: true });
});

it("reports allowlisted device and display details to trusted windows", async () => {
	const display = {
		id: 991,
		label: "Private monitor label",
		internal: true,
		bounds: { x: 20, y: 40, width: 1512, height: 982 },
		scaleFactor: 2,
		displayFrequency: 120,
		colorDepth: 30,
		rotation: 0,
	};
	state.screen.getPrimaryDisplay.mockReturnValue(display);
	state.screen.getAllDisplays.mockReturnValue([
		display,
		{ ...display, id: 992, internal: false },
	]);
	state.gpuInfo.mockResolvedValueOnce({
		machineModelName: "MacBookPro",
		machineModelVersion: "18,2",
		serialNumber: "Private serial",
		auxAttributes: { driverVersion: "33.5.1" },
		gpuDevice: [{ active: true, vendorId: 0x106b, deviceId: 2345, deviceString: "Apple GPU" }],
	});
	const readDevice = handler("app-diagnostics:device");
	const outside = { url: "https://other.test/" };
	await expect(
		readDevice({ senderFrame: outside, sender: { mainFrame: outside } }),
	).resolves.toEqual({ success: false });
	const report = await readDevice(event);
	expect(report).toMatchObject({
		success: true,
		device: {
			machineModel: "MacBookPro 18,2",
			hostArchitecture: "arm64",
			runningUnderArm64Translation: true,
			memory: { totalMiB: expect.any(Number), freeMiB: expect.any(Number) },
			graphics: {
				probeStatus: "available",
				adapters: [
					{ name: "Apple GPU", vendor: "Apple", active: true, driverVersion: "33.5.1" },
				],
				features: { webgl: "enabled", webgpu: "disabled_software" },
			},
			displays: {
				count: 2,
				connected: [
					{
						primary: true,
						internal: true,
						widthDip: 1512,
						heightDip: 982,
						scaleFactor: 2,
						refreshHz: 120,
					},
					{ primary: false, internal: false },
				],
			},
		},
	});
	for (const field of [
		"Private monitor",
		"Private serial",
		"deviceId",
		"vendorId",
		'"id"',
		'"x"',
		'"y"',
	])
		expect(JSON.stringify(report)).not.toContain(field);
});

it("still includes host details when graphics diagnostics time out", async () => {
	vi.useFakeTimers();
	state.gpuInfo.mockReturnValueOnce(new Promise(() => {}));
	const pending = handler("app-diagnostics:device")(event);
	await vi.advanceTimersByTimeAsync(800);
	await expect(pending).resolves.toMatchObject({
		success: true,
		device: {
			cpu: { logicalProcessors: expect.any(Number) },
			memory: { totalMiB: expect.any(Number) },
			graphics: { probeStatus: "timed-out", adapters: [], features: { webgl: "enabled" } },
		},
	});
});

describe("persistent export diagnostics", () => {
	it("writes redacted events into the logs directory and reads them after registration restarts", async () => {
		expect(
			await handler("export-diagnostics:append")(
				event,
				"export failed /Users/private/movie.mp4 Bearer abc someone@example.com",
			),
		).toEqual({ success: true });
		const filename = path.join(state.directory, "export-diagnostics.json");
		const disk = await fs.readFile(filename, "utf8");
		expect(disk).toContain("export failed");
		for (const value of ["private", "movie.mp4", "abc", "someone@example.com"])
			expect(disk).not.toContain(value);
		registerExportDiagnosticHandlers();
		expect(await handler("export-diagnostics:read")(event)).toEqual({
			success: true,
			logs: JSON.parse(disk),
		});
	});
	it("serializes overlapping windows, bounds history, and tolerates corrupt files", async () => {
		await fs.writeFile(path.join(state.directory, "export-diagnostics.json"), "broken JSON");
		await Promise.all(
			Array.from({ length: 65 }, (_, i) =>
				handler("export-diagnostics:append")(event, `event ${i}`),
			),
		);
		const result = await handler("export-diagnostics:read")(event);
		expect(result.logs).toHaveLength(60);
		expect(result.logs[0]).toBe("event 5");
		expect(result.logs.at(-1)).toBe("event 64");
	});
	it("bounds escaped Unicode on disk and treats an unwritable logs path as best effort", async () => {
		await Promise.all(
			Array.from({ length: 60 }, () =>
				handler("export-diagnostics:append")(event, "\u0001".repeat(2000)),
			),
		);
		const filename = path.join(state.directory, "export-diagnostics.json");
		expect((await fs.stat(filename)).size).toBeLessThanOrEqual(120_000);
		await fs.rm(filename);
		await fs.rmdir(state.directory);
		await fs.writeFile(state.directory, "blocked");
		expect(await handler("export-diagnostics:append")(event, "export failed")).toEqual({
			success: false,
		});
	});

	it("rejects untrusted pages, subframes, and oversized inputs", async () => {
		const append = handler("export-diagnostics:append");
		const untrusted = { url: "https://other.test/" };
		for (const candidate of [
			{ senderFrame: untrusted, sender: { mainFrame: untrusted } },
			{ ...event, senderFrame: { ...frame } },
		]) {
			expect(await append(candidate, "export")).toEqual({ success: false });
			expect(await handler("export-diagnostics:read")(candidate)).toEqual({
				success: false,
				logs: [],
			});
		}
		expect(await append(event, "x".repeat(2201))).toEqual({ success: false });
		expect(await handler("export-diagnostics:read")(event)).toEqual({
			success: true,
			logs: [],
		});
	});
});

describe("native runtime diagnostics", () => {
	it("returns actual process versions and separates macOS product version from its kernel", async () => {
		vi.spyOn(os, "release").mockReturnValue("27.2.0");
		vi.stubGlobal("process", {
			...process,
			platform: "darwin",
			arch: "arm64",
			versions: { electron: "43.1.0", chrome: "152.0.7999.1", node: "24.15.0", v8: "15.2" },
			getSystemVersion: () => "27.2",
		});
		expect(await handler("export-diagnostics:runtime")(event)).toEqual({
			success: true,
			runtime: {
				appVersion: "2.0.0-beta.1",
				platform: "darwin",
				arch: "arm64",
				osVersion: "27.2",
				kernelRelease: "27.2.0",
				versions: {
					electron: "43.1.0",
					chromium: "152.0.7999.1",
					node: "24.15.0",
					v8: "15.2",
				},
			},
		});
	});
	it("does not invent product versions when the native version probe fails", async () => {
		vi.stubGlobal("process", {
			...process,
			getSystemVersion: () => {
				throw new Error("unavailable");
			},
		});
		const runtime = collectExportRuntimeInfo();
		expect(runtime.osVersion).toBeUndefined();
		expect(runtime.versions.node).toBe(process.versions.node);
		expect(runtime.arch).toBe(process.arch);
		const untrusted = { url: "https://other.test/" };
		expect(
			await handler("export-diagnostics:runtime")({
				senderFrame: untrusted,
				sender: { mainFrame: untrusted },
			}),
		).toEqual({ success: false });
	});
});

it("persists app events and native process exits across renderer instances", async () => {
	await fs.writeFile(
		path.join(state.directory, "app-diagnostics.json"),
		JSON.stringify(["2020-01-01T00:00:00.000Z error: stale failure"]),
	);
	const append = handler("app-diagnostics:append");
	const read = handler("app-diagnostics:read");
	const outside = { url: "https://other.test/" };
	const untrusted = { senderFrame: outside, sender: { mainFrame: outside } };
	expect(await append(untrusted, ["untrusted write"])).toEqual({ success: false });
	expect(await read(untrusted)).toEqual({ success: false, logs: [] });
	expect(await append(event, [42])).toEqual({ success: false });
	expect(await append(event, Array(31).fill("too many entries"))).toEqual({ success: false });

	const entry = `${new Date().toISOString()} diagnostic: [home] failed /Users/tester/private.txt`;
	const start = {
		timestamp: new Date().toISOString(),
		name: "home.open",
		source: "renderer",
		surface: "home",
		operationId: "1234567890abcdef",
		sequence: 0,
		phase: "start",
		input: "private-project.recordly",
	};
	const origin = { ...event, sender: { ...event.sender, id: 12 } };
	const operation = handler("app-diagnostics:operation");
	await operation(untrusted, { ...start, operationId: "bbbbbbbbbbbbbbbb" });
	await operation(origin, { ...start, stage: "/Users/tester/private.txt" });
	await operation(origin, start);
	await operation(origin, {
		...start,
		phase: "finish",
		outcome: "failed",
		sequence: 1,
		elapsedMs: 68,
	});
	await Promise.all([
		append(event, [entry]),
		recordAppProcessDiagnostic("error", "editor renderer exited reason=crashed exitCode=42"),
	]);
	const nextFrame = { ...frame };
	const reopened = { senderFrame: nextFrame, sender: { mainFrame: nextFrame, id: 13 } };
	const report = await read(reopened);
	expect(report).toMatchObject({
		success: true,
		windowId: 13,
		logs: [
			expect.stringContaining("[home] failed [local path]"),
			expect.stringContaining("[electron] editor renderer exited reason=crashed exitCode=42"),
		],
		operations: [
			{ phase: "start", name: "home.open", windowId: 12, appRunId: report.appRunId },
			{
				phase: "finish",
				operationId: start.operationId,
				outcome: "failed",
				elapsedMs: 68,
				windowId: 12,
			},
		],
	});
	expect(JSON.stringify(report.operations)).not.toContain("private");
	expect(await handler("export-diagnostics:read")(reopened)).toEqual({ success: true, logs: [] });
});

it("preserves redacted main-process exceptions for a subsequent report", async () => {
	const on = vi.spyOn(process, "on");
	installAppProcessDiagnostics();
	const monitor = on.mock.calls.find(
		([eventName]) => eventName === "uncaughtExceptionMonitor",
	)?.[1];
	if (!monitor) throw new Error("Missing fatal exception monitor");
	process.removeListener("uncaughtExceptionMonitor", monitor);
	const error = new Error('Could not open "/Users/tester/private.txt"');
	monitor(error, "uncaughtException");
	const result = await handler("app-diagnostics:read")(event);
	expect(result.logs).toEqual([
		expect.stringContaining(
			'[electron] uncaughtException\nError: Could not open "[local path]"',
		),
	]);
	expect(result.logs[0]).not.toContain("private.txt");
});

it("drains queued operations and already-started app log writes before quitting", async () => {
	const operation = startMainDiagnosticOperation("app.quit", "editor");
	operation.finish("succeeded");
	void recordAppProcessDiagnostic("info", "normal quit");
	const drain = drainAppProcessDiagnostics();
	expect(drain).toBeDefined();
	await drain;
	const report = await handler("app-diagnostics:read")(event);
	expect(report.logs).toEqual([expect.stringContaining("normal quit")]);
	expect(report.operations).toEqual([
		expect.objectContaining({ name: "app.quit", phase: "start" }),
		expect.objectContaining({ name: "app.quit", phase: "finish", outcome: "succeeded" }),
	]);
	expect(drainAppProcessDiagnostics()).toBeUndefined();
});
