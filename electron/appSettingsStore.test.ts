import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { beforeEach, expect, it, vi } from "vitest";

const files = vi.hoisted(() => ({
	read: vi.fn(),
	write: vi.fn(),
	open: vi.fn(),
	sync: vi.fn(),
	close: vi.fn(),
	rename: vi.fn(),
	unlink: vi.fn(),
}));
vi.mock("node:fs", () => ({
	readFileSync: files.read,
	writeFileSync: files.write,
	openSync: files.open,
	fsyncSync: files.sync,
	closeSync: files.close,
	renameSync: files.rename,
	unlinkSync: files.unlink,
}));
vi.mock("./ipc/constants", () => ({ APP_SETTINGS_FILE: "/test/app-settings.json" }));
vi.mock("./ipc/utils", () => ({ parseJsonWithByteOrderMark: JSON.parse }));

import {
	readAppSetting,
	readAppSettingsStore,
	readAppSettingsStoreWithStatus,
	writeAppSetting,
} from "./appSettingsStore";

beforeEach(() => {
	vi.clearAllMocks();
	files.open.mockReturnValue(42);
});

it("treats a missing settings file as a valid first-run empty store", () => {
	files.read.mockImplementation(() => {
		throw Object.assign(new Error("missing"), { code: "ENOENT" });
	});
	expect(readAppSettingsStoreWithStatus()).toEqual({ success: true, store: {} });
});

it.each(["EACCES", "EIO", "EISDIR"])("reports unreadable settings as unavailable: %s", (code) => {
	files.read.mockImplementation(() => {
		throw Object.assign(new Error("unavailable"), { code });
	});
	expect(readAppSettingsStoreWithStatus()).toEqual({ success: false });
	// Normal preference callers retain their previous resilient fallback.
	expect(readAppSettingsStore()).toEqual({});
	expect(readAppSetting("theme")).toBeNull();
});

it.each([
	"{broken",
	"[]",
	"null",
	"3",
])("does not report malformed settings as empty: %s", (content) => {
	files.read.mockReturnValue(content);
	expect(readAppSettingsStoreWithStatus()).toEqual({ success: false });
	expect(readAppSettingsStore()).toEqual({});
});

it("retains a valid history and distinguishes a missing key", () => {
	files.read.mockReturnValue('{"history":{"project:old":123}}');
	expect(readAppSettingsStoreWithStatus()).toEqual({
		success: true,
		store: { history: { "project:old": 123 } },
	});
	expect(readAppSetting("history")).toEqual({ "project:old": 123 });
	expect(readAppSetting("missing")).toBeNull();
});

it.each([
	"{broken",
	"[]",
	"null",
	"3",
])("never overwrites malformed settings through a preference writer: %s", (content) => {
	files.read.mockReturnValue(content);
	expect(() => writeAppSetting("theme", "dark")).toThrow(
		"Could not read app settings before saving",
	);
	expect(files.write).not.toHaveBeenCalled();
});

it.each([
	"EACCES",
	"EBUSY",
	"EIO",
])("never overwrites settings when the preference writer cannot read: %s", (code) => {
	files.read.mockImplementation(() => {
		throw Object.assign(new Error("unavailable"), { code });
	});
	expect(() => writeAppSetting("theme", "dark")).toThrow(
		"Could not read app settings before saving",
	);
	expect(files.write).not.toHaveBeenCalled();
});

it("creates a first-run setting when the file is confirmed missing", () => {
	files.read.mockImplementation(() => {
		throw Object.assign(new Error("missing"), { code: "ENOENT" });
	});
	writeAppSetting("theme", "dark");
	expect(files.write).toHaveBeenCalledExactlyOnceWith(
		42,
		JSON.stringify({ theme: "dark" }, null, 2),
		"utf-8",
	);
	expect(files.rename).toHaveBeenCalledWith(expect.any(String), "/test/app-settings.json");
});

it("preserves unrelated settings when a preference writer updates a valid file", () => {
	files.read.mockReturnValue('{"history":{"project:old":123}}');
	writeAppSetting("theme", "dark");
	expect(files.write).toHaveBeenCalledExactlyOnceWith(
		42,
		JSON.stringify({ history: { "project:old": 123 }, theme: "dark" }, null, 2),
		"utf-8",
	);
	expect(files.rename).toHaveBeenCalledWith(expect.any(String), "/test/app-settings.json");
});

const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const require = createRequire(import.meta.url);
const productionProgram = ts.transpileModule(
	realFs.readFileSync(new URL("./appSettingsStore.ts", import.meta.url), "utf8"),
	{ compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function realStore(file: string, overrides: Partial<typeof realFs> = {}) {
	const exports: Record<string, (...args: unknown[]) => unknown> = {};
	runInNewContext(productionProgram, {
		exports,
		process,
		require(name: string) {
			if (name === "node:fs") return { ...realFs, ...overrides };
			if (name === "./ipc/constants") return { APP_SETTINGS_FILE: file };
			if (name === "./ipc/utils") return { parseJsonWithByteOrderMark: JSON.parse };
			return require(name);
		},
	});
	return exports;
}

it.each([
	"write",
	"sync",
	"rename",
] as const)("retains existing settings bytes and permits retry after an interrupted atomic %s", (stage) => {
	const directory = realFs.mkdtempSync(path.join(os.tmpdir(), "recordly-settings-"));
	const file = path.join(directory, "app-settings.json");
	const old = '{"history":{"project:old":123},"theme":"light"}\n';
	try {
		realFs.writeFileSync(file, old);
		let fail = true;
		const store = realStore(file, {
			writeFileSync(target, ...args) {
				if (fail && stage === "write") {
					realFs.writeFileSync(target, '{"partial":');
					throw new Error("injected write interruption");
				}
				return realFs.writeFileSync(target, ...args);
			},
			fsyncSync(fd) {
				if (fail && stage === "sync") throw new Error("injected sync interruption");
				return realFs.fsyncSync(fd);
			},
			renameSync(from, to) {
				if (fail && stage === "rename") throw new Error("injected rename interruption");
				return realFs.renameSync(from, to);
			},
		});
		expect(() => store.writeAppSetting("theme", "dark")).toThrow(
			`injected ${stage} interruption`,
		);
		expect(realFs.readFileSync(file, "utf8")).toBe(old);
		expect(realFs.readdirSync(directory)).toEqual(["app-settings.json"]);
		fail = false;
		store.writeAppSetting("theme", "dark");
		expect(JSON.parse(realFs.readFileSync(file, "utf8"))).toEqual({
			history: { "project:old": 123 },
			theme: "dark",
		});
	} finally {
		realFs.rmSync(directory, { recursive: true, force: true });
	}
});

it("preserves recoverable corrupt bytes and refuses to reset history through an ordinary setting write", () => {
	const directory = realFs.mkdtempSync(path.join(os.tmpdir(), "recordly-settings-"));
	const file = path.join(directory, "app-settings.json");
	const raw = '{"history":{"project:old":123},"recordly.project-share-links.v1":';
	try {
		realFs.writeFileSync(file, raw);
		const store = realStore(file);
		expect(() => store.writeAppSetting("theme", "dark")).toThrow(
			"Could not read app settings before saving",
		);
		expect(realFs.readFileSync(file, "utf8")).toBe(raw);
		expect(realFs.readdirSync(directory)).toEqual(["app-settings.json"]);
	} finally {
		realFs.rmSync(directory, { recursive: true, force: true });
	}
});
