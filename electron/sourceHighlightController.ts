import { Buffer } from "node:buffer";
import type { WindowBounds } from "./ipc/types";

const SOURCE_HIGHLIGHT_PAD = 6;
const SOURCE_HIGHLIGHT_COLOR = "#00d166";
const SOURCE_HIGHLIGHT_INSET = 3;
const SOURCE_HIGHLIGHT_RADIUS = 22;

type SourceHighlightAlwaysOnTopLevel =
	| "normal"
	| "status"
	| "floating"
	| "torn-off-menu"
	| "modal-panel"
	| "main-menu"
	| "pop-up-menu"
	| "screen-saver"
	| "dock";

export type SourceHighlightWindowBoundsOptions = {
	isMacScreen?: boolean;
};

export interface SourceHighlightWindowLike {
	close: () => void;
	isDestroyed: () => boolean;
	loadURL: (url: string) => Promise<unknown>;
	moveTop?: () => void;
	on?: (event: "closed", listener: () => void) => void;
	setAlwaysOnTop?: (flag: boolean, level?: SourceHighlightAlwaysOnTopLevel) => void;
	setBounds: (bounds: WindowBounds, animate?: boolean) => void;
	setContentProtection?: (enable: boolean) => void;
	setIgnoreMouseEvents?: (ignore: boolean) => void;
	setVisibleOnAllWorkspaces?: (
		visible: boolean,
		options?: { visibleOnFullScreen?: boolean },
	) => void;
	showInactive?: () => void;
}

export type SourceHighlightControllerDependencies = {
	createWindow: (bounds: WindowBounds) => SourceHighlightWindowLike;
	reassertHudOverlayMousePassthrough: () => void;
};

export type SourceHighlightController = {
	clear: () => void;
	show: (bounds: WindowBounds, options?: SourceHighlightWindowBoundsOptions) => Promise<boolean>;
};

export function getSourceHighlightWindowBounds(
	bounds: WindowBounds,
	options: SourceHighlightWindowBoundsOptions = {},
): WindowBounds {
	const pad = options.isMacScreen ? 0 : SOURCE_HIGHLIGHT_PAD;

	return {
		x: Math.round(bounds.x - pad),
		y: Math.round(bounds.y - pad),
		width: Math.round(bounds.width + pad * 2),
		height: Math.round(bounds.height + pad * 2),
	};
}

export function createSourceHighlightHtml(): string {
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
.source-highlight{
	position:fixed;
	inset:${SOURCE_HIGHLIGHT_INSET}px;
	border:4px solid ${SOURCE_HIGHLIGHT_COLOR};
	border-radius:${SOURCE_HIGHLIGHT_RADIUS}px;
	box-shadow:0 0 0 1px rgba(0,0,0,.3),0 0 18px rgba(0,209,102,.45);
	background:transparent;
}
</style>
</head>
<body>
<div class="source-highlight"></div>
</body>
</html>`;
}

function createDataUrl(html: string): string {
	return `data:text/html;charset=utf-8;base64,${Buffer.from(html, "utf8").toString("base64")}`;
}

function isUsableBounds(bounds: WindowBounds): boolean {
	return (
		Number.isFinite(bounds.x) &&
		Number.isFinite(bounds.y) &&
		Number.isFinite(bounds.width) &&
		Number.isFinite(bounds.height) &&
		bounds.width > 0 &&
		bounds.height > 0
	);
}

export function createSourceHighlightController({
	createWindow,
	reassertHudOverlayMousePassthrough,
}: SourceHighlightControllerDependencies): SourceHighlightController {
	let highlightWindow: SourceHighlightWindowLike | null = null;

	const getActiveWindow = () => {
		if (highlightWindow && !highlightWindow.isDestroyed()) {
			return highlightWindow;
		}
		highlightWindow = null;
		return null;
	};

	const clear = () => {
		const window = getActiveWindow();
		highlightWindow = null;
		if (window) {
			window.close();
			reassertHudOverlayMousePassthrough();
		}
	};

	const show = async (
		targetBounds: WindowBounds,
		options: SourceHighlightWindowBoundsOptions = {},
	) => {
		if (!isUsableBounds(targetBounds)) {
			clear();
			return false;
		}

		const windowBounds = getSourceHighlightWindowBounds(targetBounds, options);
		const activeWindow = getActiveWindow();
		if (activeWindow) {
			activeWindow.setBounds(windowBounds, false);
			activeWindow.showInactive?.();
			activeWindow.moveTop?.();
			reassertHudOverlayMousePassthrough();
			return true;
		}

		const window = createWindow(windowBounds);
		highlightWindow = window;
		window.setContentProtection?.(true);
		window.setIgnoreMouseEvents?.(true);
		window.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
		window.setAlwaysOnTop?.(true, "screen-saver");
		window.on?.("closed", () => {
			if (highlightWindow === window) {
				highlightWindow = null;
			}
			reassertHudOverlayMousePassthrough();
		});

		try {
			await window.loadURL(createDataUrl(createSourceHighlightHtml()));
		} catch (error) {
			if (highlightWindow !== window) {
				return false;
			}
			if (!window.isDestroyed()) {
				window.close();
			}
			throw error;
		}

		window.showInactive?.();
		window.moveTop?.();
		reassertHudOverlayMousePassthrough();
		return true;
	};

	return { clear, show };
}
