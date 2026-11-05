import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import path from "node:path";
import { app, BrowserWindow, nativeImage, systemPreferences, type WebContents } from "electron";
import { getPackagedRendererBaseUrl } from "../../rendererServer";
import { ensurePermissionDragHelperBinary } from "../paths/binaries";

type Permission = "screen" | "accessibility";
let active:
	| { close: () => void; window: BrowserWindow; bundle: string; owner: BrowserWindow }
	| undefined;
let generation = 0;

/** Derive the dragged bundle in the main process; renderer paths are never accepted. */
export function runningApplicationBundle(executable: string): string | undefined {
	const bundle = path.dirname(path.dirname(path.dirname(executable)));
	return bundle.endsWith(".app") &&
		path.dirname(executable) === path.join(bundle, "Contents", "MacOS")
		? bundle
		: undefined;
}

function granted(permission: Permission): boolean {
	return permission === "screen"
		? systemPreferences.getMediaAccessStatus("screen") === "granted"
		: systemPreferences.isTrustedAccessibilityClient(false);
}

export function closePermissionAccessory() {
	generation++;
	active?.close();
}

/** Only the accessory may drag the main-process-derived running bundle. */
export function startPermissionAccessoryDrag(sender: WebContents) {
	if (!active || active.window.isDestroyed() || active.window.webContents !== sender)
		return { success: false };
	const assets = process.env.VITE_PUBLIC || path.join(app.getAppPath(), "dist");
	const icon = nativeImage.createFromPath(path.join(assets, "app-icons", "recordlymac-128.png"));
	if (icon.isEmpty()) return { success: false };
	sender.startDrag({ file: active.bundle, icon: icon.resize({ width: 64, height: 64 }) });
	return { success: true };
}

export function dismissPermissionAccessory(sender: WebContents) {
	if (!active || active.window.isDestroyed() || active.window.webContents !== sender)
		return { success: false };
	const owner = active.owner;
	closePermissionAccessory();
	if (!owner.isDestroyed()) {
		owner.show();
		owner.focus();
	}
	return { success: true };
}

// This helper must not request permission for itself. Electron remains the TCC
// authority and its running application bundle is the sole drag payload.
export async function showPermissionAccessory(
	permission: Permission,
	sender?: WebContents,
	preview = false,
) {
	if (process.platform !== "darwin" || !sender || sender.isDestroyed()) return;
	// A development preview opens real Settings and drags the real running app,
	// including when this Mac has already granted it access.
	const testSetup = preview === true && !app.isPackaged;
	const bundle = runningApplicationBundle(app.getPath("exe"));
	if (!bundle || (!testSetup && granted(permission))) return;
	closePermissionAccessory();
	const request = generation;
	const binary = await ensurePermissionDragHelperBinary();
	if (request !== generation || sender.isDestroyed() || (!testSetup && granted(permission)))
		return;
	const owner = BrowserWindow.fromWebContents(sender);
	if (!owner || owner.isDestroyed()) return;
	const rendererURL = process.env.VITE_DEV_SERVER_URL || getPackagedRendererBaseUrl();
	if (!rendererURL) return;
	const accessory = new BrowserWindow({
		width: 368,
		height: 264,
		show: false,
		frame: false,
		transparent: true,
		resizable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		focusable: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		type: "panel",
		webPreferences: {
			preload: path.join(app.getAppPath(), "dist-electron", "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	const url = new URL(rendererURL);
	url.search = new URLSearchParams({ windowType: "permission-accessory", permission }).toString();
	accessory.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	accessory.webContents.on("will-navigate", (event) => event.preventDefault());
	accessory.setVisibleOnAllWorkspaces(true, {
		visibleOnFullScreen: true,
		// Match the other panels: changing the entire app's process type here
		// races Dock visibility updates and can leave duplicate macOS Dock icons.
		skipTransformProcessType: true,
	});
	let loaded = false;
	let shouldShow = false;
	accessory.once("ready-to-show", () => {
		loaded = true;
		if (shouldShow) accessory.showInactive();
	});
	void accessory.loadURL(url.toString()).catch(() => accessory.destroy());
	const child = spawn(
		binary,
		["--app-bundle", bundle, "--permission", permission, "--parent-pid", String(process.pid)],
		{
			stdio: ["pipe", "pipe", "pipe"],
		},
	);
	await ownAccessory(child, permission, sender, owner, testSetup, accessory, bundle, (event) => {
		if (accessory.isDestroyed()) return;
		if (!event.visible) {
			shouldShow = false;
			accessory.hide();
			return;
		}
		if (
			![event.x, event.y, event.width, event.height].every(Number.isInteger) ||
			event.width !== 368 ||
			event.height !== 264
		)
			return;
		accessory.setBounds({ x: event.x!, y: event.y!, width: 368, height: 264 });
		shouldShow = true;
		if (loaded) accessory.showInactive();
	});
}

type AccessoryFrame = { visible: boolean; x?: number; y?: number; width?: number; height?: number };

function ownAccessory(
	child: ChildProcessWithoutNullStreams,
	permission: Permission,
	sender: WebContents,
	owner: BrowserWindow,
	testSetup: boolean,
	accessory: BrowserWindow,
	bundle: string,
	onFrame: (frame: AccessoryFrame) => void,
) {
	return new Promise<void>((resolve, reject) => {
		let ready = false;
		let finished = false;
		let closing = false;
		let stdout = "";
		let stderr = "";
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const returnToOwner = () => {
			if (!owner.isDestroyed()) {
				owner.show();
				owner.focus();
			}
		};
		const cleanup = () => {
			if (finished) return;
			finished = true;
			clearInterval(poll);
			clearTimeout(startup);
			clearTimeout(lifetime);
			if (killTimer) clearTimeout(killTimer);
			owner.removeListener("closed", close);
			sender.removeListener("destroyed", close);
			sender.removeListener("did-start-navigation", close);
			app.removeListener("before-quit", close);
			accessory.removeListener("closed", close);
			if (!accessory.isDestroyed()) accessory.destroy();
			if (active?.close === close) active = undefined;
		};
		const close = () => {
			if (finished || closing) return;
			closing = true;
			if (!accessory.isDestroyed()) accessory.hide();
			clearInterval(poll);
			clearTimeout(startup);
			clearTimeout(lifetime);
			child.stdin.end("close\n");
			killTimer = setTimeout(() => child.kill(), 1000);
			killTimer.unref();
		};
		const startup = setTimeout(() => {
			reject(new Error("Permission accessory did not start"));
			close();
		}, 5000);
		const lifetime = setTimeout(close, 5 * 60_000);
		const poll = setInterval(() => {
			try {
				if (testSetup || !granted(permission)) return;
				close();
				returnToOwner();
			} catch {
				close();
			}
		}, 500);
		poll.unref();
		lifetime.unref();
		startup.unref();
		active = { close, window: accessory, bundle, owner };
		accessory.once("closed", close);
		owner.once("closed", close);
		sender.once("destroyed", close);
		sender.once("did-start-navigation", close);
		app.once("before-quit", close);
		// The helper can exit while a grant is being checked; stop polling on EPIPE.
		child.stdin.on("error", close);
		child.stdout.on("data", (data: Buffer) => {
			stdout += data.toString();
			for (let newline = stdout.indexOf("\n"); newline >= 0; newline = stdout.indexOf("\n")) {
				const event = stdout.slice(0, newline).trim();
				stdout = stdout.slice(newline + 1);
				if (event === "ready" && !ready) {
					ready = true;
					clearTimeout(startup);
					resolve();
				}
				if (event === "back") returnToOwner();
				if (event.startsWith("{")) {
					try {
						onFrame(JSON.parse(event) as AccessoryFrame);
					} catch {
						/* Ignore malformed helper output. */
					}
				}
			}
		});
		child.stderr.on("data", (data: Buffer) => {
			stderr = (stderr + data.toString()).slice(-2048);
		});
		child.once("error", (error) => {
			cleanup();
			reject(error);
		});
		child.once("exit", (code) => {
			cleanup();
			if (!ready)
				reject(new Error(stderr || `Permission accessory exited before opening (${code})`));
		});
	});
}
