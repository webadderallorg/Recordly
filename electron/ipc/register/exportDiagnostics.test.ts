import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ handle: vi.fn(), directory: "" }));
vi.mock("electron", () => ({
	app: {
		getAppPath: () => "/recordly",
		getPath: () => state.directory,
		getVersion: () => "2.0.0-beta.1",
	},
	ipcMain: { handle: state.handle },
}));
vi.mock("../../rendererServer", () => ({
	getPackagedRendererBaseUrl: () => "http://127.0.0.1:43820/",
}));

import { collectExportRuntimeInfo, registerExportDiagnosticHandlers } from "./exportDiagnostics";

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
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	await fs.rm(state.directory, { recursive: true, force: true });
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
