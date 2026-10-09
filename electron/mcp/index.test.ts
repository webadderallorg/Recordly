import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	renameFails: false,
	writeFails: false,
	startErrorCode: null as string | null,
	support: { supported: true } as { supported: boolean; reason?: string },
}));

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		renameSync: (from: string, to: string) => {
			if (mocks.renameFails) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
			return actual.renameSync(from, to);
		},
		writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
			if (mocks.writeFails) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
			return actual.writeFileSync(...args);
		},
	};
});
vi.mock("../appPaths", async () => {
	const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
	const os = await import("node:os");
	const nodePath = await import("node:path");
	return {
		USER_DATA_PATH: actualFs.mkdtempSync(nodePath.join(os.tmpdir(), "recordly-mcp-settings-")),
	};
});
vi.mock("electron", () => ({
	app: { getVersion: () => "1.0.0", on: vi.fn() },
	clipboard: { writeText: vi.fn() },
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(channel, handler),
	},
}));
vi.mock("./server", () => ({
	MCP_PATH: "/mcp",
	createMcpHttpServer: () => ({
		start: async () => {
			if (mocks.startErrorCode) {
				throw Object.assign(new Error(mocks.startErrorCode), {
					code: mocks.startErrorCode,
				});
			}
		},
		close: async () => undefined,
		isRunning: () => false,
	}),
}));
vi.mock("./agentControl", () => ({ createAgentControl: () => ({}) }));
vi.mock("./agentInput", () => ({ agentInput: { stop: vi.fn() } }));
vi.mock("./agentPlatform", () => ({ agentPlatform: { support: () => mocks.support } }));
vi.mock("./remoteEditor", () => ({
	createRemoteEditor: () => ({ requestEditor: async () => ({}) }),
	runFfmpegProcess: async () => Buffer.alloc(0),
}));
vi.mock("./thumbnail", () => ({ createThumbnail: () => async () => ({}) }));
vi.mock("./remoteExport", () => ({ createRemoteExport: () => ({}) }));
vi.mock("./reviewRecording", () => ({ createRemoteReview: () => ({}) }));
vi.mock("./tools", () => ({ buildRecordlyMcpServer: vi.fn() }));

import { USER_DATA_PATH } from "../appPaths";
import { setupMcpServer } from "./index";
import type { RemoteControl } from "./remoteControl";

const settingsFile = path.join(USER_DATA_PATH, "mcp-server.json");
const call = (channel: string, ...args: unknown[]) => mocks.handlers.get(channel)?.({}, ...args);
const saved = () => JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
const tempFiles = () => fs.readdirSync(USER_DATA_PATH).filter((name) => name.endsWith(".tmp"));
const start = () => setupMcpServer({ isDev: false, remote: {} as RemoteControl });

beforeEach(() => {
	fs.rmSync(settingsFile, { force: true });
	mocks.handlers.clear();
	mocks.renameFails = false;
	mocks.writeFails = false;
	mocks.startErrorCode = null;
	mocks.support = { supported: true };
});

describe("MCP settings", () => {
	it("writes directly when the rename fails, keeps the file private and leaves no temp file", async () => {
		start();
		mocks.renameFails = true;
		await call("mcp-server:set-enabled", true);
		expect(saved()).toMatchObject({ enabled: true, token: expect.stringMatching(/^.{20,}$/) });
		expect(tempFiles()).toEqual([]);
		if (process.platform !== "win32") {
			expect(fs.statSync(settingsFile).mode & 0o777).toBe(0o600);
		}
		mocks.renameFails = false;
		await call("mcp-server:set-control-enabled", true);
		expect(saved()).toMatchObject({ controlEnabled: true });
		expect(tempFiles()).toEqual([]);
	});

	it("never sends the token to the renderer", async () => {
		start();
		const states = [
			await call("mcp-server:set-enabled", true),
			await call("mcp-server:regenerate-token"),
			await call("mcp-server:get-state"),
		];
		const { token } = saved();
		for (const state of states) {
			expect(state).not.toHaveProperty("token");
			expect(JSON.stringify(state)).not.toContain(token);
		}
	});

	it.each([
		["EADDRINUSE", "port-in-use"],
		["EACCES", "port-unavailable"],
		["EADDRNOTAVAIL", "port-unavailable"],
		["EIO", "start-failed"],
	])("reports a %s listen failure as %s", async (code, error) => {
		start();
		mocks.startErrorCode = code;
		expect(await call("mcp-server:set-enabled", true)).toMatchObject({ error });
	});

	it("reports whether this system supports mouse and keyboard control, and why not", () => {
		start();
		expect(call("mcp-server:get-state")).toMatchObject({ controlSupported: true });
		mocks.support = { supported: false, reason: "Needs X11." };
		expect(call("mcp-server:get-state")).toMatchObject({
			controlSupported: false,
			controlUnsupportedReason: "Needs X11.",
		});
	});

	it("creates a token at startup when enabled without one, or starts disabled if it cannot", () => {
		fs.writeFileSync(settingsFile, JSON.stringify({ enabled: true, token: "" }));
		start();
		expect(saved().token).toMatch(/^.{20,}$/);

		fs.writeFileSync(settingsFile, JSON.stringify({ enabled: true, token: "" }));
		mocks.writeFails = true;
		start();
		expect(call("mcp-server:get-state")).toMatchObject({ enabled: false });
		expect(tempFiles()).toEqual([]);
	});
});
