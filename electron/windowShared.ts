import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, type BrowserWindow } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);

const APP_ROOT = path.join(__dirname, "..");

export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const RENDERER_DIST = path.join(APP_ROOT, "dist");
export const PRELOAD_PATH = path.join(__dirname, "preload.mjs");
export const WINDOW_ICON_PATH = path.join(
	process.env.VITE_PUBLIC || RENDERER_DIST,
	"app-icons",
	"recordly-512.png",
);

export function getScreen() {
	if (!app.isReady()) {
		throw new Error(
			"getScreen() called before app is ready. Ensure all screen access happens after app.whenReady().",
		);
	}

	return nodeRequire("electron").screen as typeof import("electron").screen;
}

export function loadRendererWindow(
	window: BrowserWindow,
	windowType: string,
	query: Record<string, string> = {},
) {
	const fullQuery = { windowType, ...query };

	if (VITE_DEV_SERVER_URL) {
		const searchParams = new URLSearchParams(fullQuery);
		void window.loadURL(`${VITE_DEV_SERVER_URL}?${searchParams.toString()}`);
		return;
	}

	void window.loadFile(path.join(RENDERER_DIST, "index.html"), {
		query: fullQuery,
	});
}