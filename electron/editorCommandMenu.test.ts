import type { BrowserWindow, MenuItemConstructorOptions } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeT, setNativeLocale } from "./nativeI18n";
import { isInternalRendererTarget } from "./navigationPolicy";
import en from "../src/i18n/locales/en/native.json";
import itNative from "../src/i18n/locales/it/native.json";
import {
	captureEditorMenuTarget,
	createEditorCommandMenus,
	withHiddenDockEditorMenus,
} from "./editorCommandMenu";

const translate = nativeT;
afterEach(() => setNativeLocale("en"));
const click = (item: MenuItemConstructorOptions) => (item.click as () => void)();

function fixture() {
	const events: string[] = [];
	let alive = true;
	let contentsAlive = true;
	let focused = false;
	let contentsFocused = false;
	let url = "http://127.0.0.1:5173/?windowType=editor";
	const contents = {
		isDestroyed: () => !contentsAlive,
		getURL: () => url,
		focus: vi.fn(() => {
			events.push("contents-focus");
			contentsFocused = true;
		}),
		isFocused: () => contentsFocused,
		...Object.fromEntries(
			["undo", "redo", "cut", "copy", "paste", "selectAll"].map((action) => [
				action,
				vi.fn(() => events.push(action)),
			]),
		),
	};
	const window = {
		id: 1,
		isDestroyed: () => !alive,
		isMinimized: () => true,
		restore: vi.fn(() => events.push("restore")),
		show: vi.fn(() => events.push("show")),
		focus: vi.fn(() => {
			events.push("focus");
			focused = true;
		}),
		isFocused: () => focused,
		webContents: contents,
	} as unknown as BrowserWindow;
	const registry = new Map([[1, window]]);
	const ownsEditor = (candidate: BrowserWindow) =>
		!candidate.isDestroyed() &&
		registry.get(candidate.id) === candidate &&
		!candidate.webContents.isDestroyed() &&
		candidate.webContents.getURL().includes("windowType=editor") &&
		isInternalRendererTarget("http://127.0.0.1:5173/", candidate.webContents.getURL());
	const onProjectAction = vi.fn((action: string) => events.push(action));
	const target = captureEditorMenuTarget(window, ownsEditor);
	const menus = createEditorCommandMenus({ translate, target, onProjectAction });
	return {
		window,
		contents,
		registry,
		target,
		menus,
		onProjectAction,
		events,
		close: () => {
			alive = false;
		},
		destroyContents: () => {
			contentsAlive = false;
		},
		navigate: () => {
			url = "https://untrusted.invalid/?windowType=editor";
		},
	};
}

describe("hidden-Dock editor command access", () => {
	it.each([
		"darwin",
		"win32",
		"linux",
	] as const)("preserves ordinary %s tray contents", (platform) => {
		const items = [
			{ label: "Open", click: vi.fn() },
			{ label: "Quit", click: vi.fn() },
		];
		const result = withHiddenDockEditorMenus(items, {
			platform,
			dockVisible: platform === "darwin",
			translate,
			onProjectAction: vi.fn(),
			target: captureEditorMenuTarget(null, () => false),
		});
		expect(result).toBe(items);
	});

	it("adds commands alongside the same recording controls only for a hidden macOS Dock", () => {
		const f = fixture();
		const items = [
			{ label: "Show controls", click: vi.fn() },
			{ label: "Stop recording", click: vi.fn() },
		];
		const result = withHiddenDockEditorMenus(items, {
			platform: "darwin",
			dockVisible: false,
			translate,
			target: f.target,
			onProjectAction: f.onProjectAction,
		});
		expect(result.slice(0, 2)).toEqual(items);
		expect(result[0]).toBe(items[0]);
		expect(result[1]).toBe(items[1]);
		expect(result.slice(2).map((item) => item.type || item.label)).toEqual([
			"separator",
			en.file,
			en.edit,
		]);
		click(result[1]);
		expect(items[1].click).toHaveBeenCalledOnce();
		expect(f.onProjectAction).not.toHaveBeenCalled();
	});

	it("keeps the same project action channels, shortcuts and native Edit roles in the regular application menu", () => {
		const send = vi.fn();
		const [file, edit] = createEditorCommandMenus({ translate, onProjectAction: send });
		for (const item of file.submenu) click(item);
		expect(send.mock.calls).toEqual([
			["menu-load-project"],
			["menu-save-project"],
			["menu-save-project-as"],
		]);
		expect(file.submenu.map((item) => item.accelerator)).toEqual([
			"CmdOrCtrl+O",
			"CmdOrCtrl+S",
			"CmdOrCtrl+Shift+S",
		]);
		expect(
			edit.submenu.filter((item) => item.type !== "separator").map((item) => item.role),
		).toEqual(["undo", "redo", "cut", "copy", "paste", "selectAll"]);
	});

	it.each([
		[0, "menu-load-project"],
		[1, "menu-save-project"],
		[2, "menu-save-project-as"],
	] as const)("focuses the captured editor before File item %s sends its existing action", (index, channel) => {
		const f = fixture();
		click(f.menus[0].submenu[index]);
		expect(f.events).toEqual(["restore", "show", "focus", "contents-focus", channel]);
		expect(f.onProjectAction).toHaveBeenCalledExactlyOnceWith(channel, f.window);
	});

	it.each([
		"undo",
		"redo",
		"cut",
		"copy",
		"paste",
		"selectAll",
	])("targets the captured WebContents for %s after focus, without a global responder role", (action) => {
		const f = fixture();
		const item = f.menus[1].submenu.find(
			(item) => item.label === translate(action as keyof typeof en),
		)!;
		expect(item.role).toBeUndefined();
		click(item);
		expect(f.events).toEqual(["restore", "show", "focus", "contents-focus", action]);
		expect(f.onProjectAction).not.toHaveBeenCalled();
	});

	it("disables every command without an owned editor and does not dispatch even if a stale callback is invoked", () => {
		const send = vi.fn();
		const menus = createEditorCommandMenus({
			translate,
			onProjectAction: send,
			target: captureEditorMenuTarget(null, () => false),
		});
		for (const item of menus
			.flatMap((menu) => menu.submenu)
			.filter((item) => item.type !== "separator")) {
			expect(item.enabled).toBe(false);
			click(item);
		}
		expect(send).not.toHaveBeenCalled();
	});

	it.each([
		"closed",
		"contents-destroyed",
		"replaced-window",
		"navigation",
	])("does not retarget commands after %s", (change) => {
		const f = fixture();
		if (change === "closed") f.close();
		if (change === "contents-destroyed") f.destroyContents();
		if (change === "replaced-window") f.registry.set(1, {} as BrowserWindow);
		if (change === "navigation") f.navigate();
		click(f.menus[0].submenu[2]);
		click(f.menus[1].submenu[0]);
		expect(f.events).toEqual([]);
		expect(f.onProjectAction).not.toHaveBeenCalled();
	});

	it.each([
		"restore",
		"show",
		"focus",
	] as const)("revalidates if %s closes the target", (phase) => {
		const f = fixture();
		vi.mocked(f.window[phase]).mockImplementation(() => {
			f.events.push(phase);
			f.close();
		});
		click(f.menus[0].submenu[0]);
		expect(f.events.at(-1)).toBe(phase);
		expect(f.onProjectAction).not.toHaveBeenCalled();
	});

	it("does nothing if native window focus does not arrive", () => {
		const f = fixture();
		vi.mocked(f.window.focus).mockImplementation(() => f.events.push("focus-denied"));
		click(f.menus[1].submenu[4]);
		expect(f.events).toEqual(["restore", "show", "focus-denied"]);
	});

	it("does not focus or edit when the captured contents cannot receive focus", () => {
		const f = fixture();
		vi.mocked(f.window.webContents.focus).mockImplementation(() =>
			f.events.push("contents-focus-denied"),
		);
		click(f.menus[1].submenu[4]);
		expect(f.events).toEqual(["restore", "show", "focus", "contents-focus-denied"]);
	});

	it.each([
		"unowned",
		"untrusted-document",
	])("disables commands when the candidate is initially %s", (change) => {
		const f = fixture();
		if (change === "unowned") f.registry.clear();
		else f.navigate();
		const target = captureEditorMenuTarget(f.window, (window) => f.target.isValid(window));
		const menus = createEditorCommandMenus({
			translate,
			target,
			onProjectAction: f.onProjectAction,
		});
		for (const item of menus
			.flatMap((menu) => menu.submenu)
			.filter((item) => item.type !== "separator")) {
			expect(item.enabled).toBe(false);
			click(item);
		}
		expect(f.events).toEqual([]);
		expect(f.onProjectAction).not.toHaveBeenCalled();
	});

	it("uses the current existing native translations for both menus", () => {
		const send = vi.fn();
		setNativeLocale("it");
		const [file, edit] = createEditorCommandMenus({
			translate: nativeT,
			onProjectAction: send,
		});
		expect(file.label).toBe(itNative.file);
		expect(file.submenu.map((item) => item.label)).toEqual([
			itNative.openProjects,
			itNative.saveProject,
			itNative.saveProjectAs,
		]);
		expect(edit.label).toBe(itNative.edit);
		expect(
			edit.submenu.filter((item) => item.type !== "separator").map((item) => item.label),
		).toEqual([
			itNative.undo,
			itNative.redo,
			itNative.cut,
			itNative.copy,
			itNative.paste,
			itNative.selectAll,
		]);
	});
});
