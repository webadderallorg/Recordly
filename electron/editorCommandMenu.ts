import type { BrowserWindow, MenuItemConstructorOptions } from "electron";
import type { nativeT } from "./nativeI18n";

export type ProjectMenuAction = "menu-load-project" | "menu-save-project" | "menu-save-project-as";
type EditAction = "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll";
type Submenu = MenuItemConstructorOptions & { submenu: MenuItemConstructorOptions[] };
type Target = {
	window: BrowserWindow | null;
	isValid: (window: BrowserWindow) => boolean;
};
type Options = {
	translate: typeof nativeT;
	onProjectAction: (action: ProjectMenuAction, target?: BrowserWindow) => void;
	target?: Target;
};

export function captureEditorMenuTarget(
	window: BrowserWindow | null,
	isOwnedEditor: (window: BrowserWindow) => boolean,
): Target {
	const contents = window && isOwnedEditor(window) ? window.webContents : null;
	const url = contents?.getURL();
	return {
		window: contents ? window : null,
		isValid: (candidate) =>
			candidate === window &&
			isOwnedEditor(candidate) &&
			candidate.webContents === contents &&
			contents?.getURL() === url,
	};
}

/** The tray captures one editor; never fall back to another window after it closes. */
function runOnTarget(target: Target, action: (window: BrowserWindow) => void) {
	const window = target.window;
	if (!window || !target.isValid(window)) return;
	if (window.isMinimized()) window.restore();
	if (!target.isValid(window)) return;
	window.show();
	if (!target.isValid(window)) return;
	window.focus();
	if (!target.isValid(window) || !window.isFocused()) return;
	window.webContents.focus();
	if (!target.isValid(window) || !window.isFocused() || !window.webContents.isFocused()) return;
	action(window);
}

/** Shared labels/actions; the ordinary application menu retains its native Edit roles. */
export function createEditorCommandMenus(options: Options): [Submenu, Submenu] {
	const { translate: t, target } = options;
	const enabled = !target || (!!target.window && target.isValid(target.window));
	const projectItem = (
		label: Parameters<typeof nativeT>[0],
		accelerator: string,
		action: ProjectMenuAction,
	): MenuItemConstructorOptions => ({
		label: t(label),
		accelerator,
		enabled,
		click: () => {
			if (target) runOnTarget(target, (window) => options.onProjectAction(action, window));
			else options.onProjectAction(action);
		},
	});
	const editItem = (action: EditAction): MenuItemConstructorOptions =>
		target
			? {
					label: t(action),
					enabled,
					// Target WebContents directly: a tray click must never edit another app.
					click: () => runOnTarget(target, (window) => window.webContents[action]()),
				}
			: { label: t(action), role: action };
	return [
		{
			label: t("file"),
			submenu: [
				projectItem("openProjects", "CmdOrCtrl+O", "menu-load-project"),
				projectItem("saveProject", "CmdOrCtrl+S", "menu-save-project"),
				projectItem("saveProjectAs", "CmdOrCtrl+Shift+S", "menu-save-project-as"),
			],
		},
		{
			label: t("edit"),
			submenu: [
				editItem("undo"),
				editItem("redo"),
				{ type: "separator" },
				editItem("cut"),
				editItem("copy"),
				editItem("paste"),
				editItem("selectAll"),
			],
		},
	];
}

export function withHiddenDockEditorMenus(
	items: MenuItemConstructorOptions[],
	options: Options & { target: Target; platform: NodeJS.Platform; dockVisible: boolean },
): MenuItemConstructorOptions[] {
	if (options.platform !== "darwin" || options.dockVisible) return items;
	return [...items, { type: "separator" }, ...createEditorCommandMenus(options)];
}
