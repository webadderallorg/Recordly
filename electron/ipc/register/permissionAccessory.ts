import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import path from "node:path";
import { app, BrowserWindow, nativeImage, systemPreferences, type WebContents } from "electron";
import { permissionAccessoryWindowOwners } from "../../permissionAccessoryWindowOwner";
import { getPackagedRendererBaseUrl } from "../../rendererServer";
import { ensurePermissionDragHelperBinary } from "../paths/binaries";

type Permission = "screen" | "accessibility";
type PreparedAccessory = ReturnType<typeof createAccessoryWindow> & {
	sender: WebContents;
	binary: Promise<string>;
	forget: () => void;
	dispose: () => void;
};
const prepared = new Map<Permission, PreparedAccessory>();
let resolvingHelper: Promise<string> | undefined;

function resolveHelper() {
	resolvingHelper ??= ensurePermissionDragHelperBinary().finally(() => {
		resolvingHelper = undefined;
	});
	return resolvingHelper;
}

let active:
	| {
			close: () => void;
			isClosing: () => boolean;
			window: BrowserWindow;
			bundle: string;
			owner: BrowserWindow;
			permission: Permission;
	  }
	| undefined;
/**
 * Clicks and drag starts can briefly change the frontmost app the helper reports.
 * Hide only once the panel has stayed hidden this long, so it never flashes.
 */
export const ACCESSORY_HIDE_DELAY_MS = 400;
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

export function preloadPermissionAccessories(sender: WebContents, permissions: Permission[]) {
	if (process.platform !== "darwin" || sender.isDestroyed()) return;
	const owner = BrowserWindow.fromWebContents(sender);
	const rendererURL = process.env.VITE_DEV_SERVER_URL || getPackagedRendererBaseUrl();
	if (!owner || owner.isDestroyed() || !rendererURL) return;

	for (const [permission, panel] of prepared) {
		if (panel.sender === sender && !permissions.includes(permission)) panel.dispose();
	}
	for (const permission of permissions) {
		const existing = prepared.get(permission);
		if (existing?.sender === sender && !existing.window.isDestroyed()) continue;
		if (active?.owner === owner && active.permission === permission && !active.isClosing())
			continue;
		existing?.dispose();
		const panel = createAccessoryWindow(permission, owner, rendererURL);
		const binary = resolveHelper();
		const forget = () => {
			sender.removeListener("destroyed", dispose);
			sender.removeListener("did-start-navigation", onNavigation);
			panel.window.removeListener("closed", forget);
			if (prepared.get(permission)?.forget === forget) prepared.delete(permission);
		};
		const dispose = () => {
			forget();
			if (!panel.window.isDestroyed()) panel.window.destroy();
		};
		const onNavigation = (
			event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
		) => {
			if (event.isMainFrame && !event.isSameDocument) dispose();
		};
		prepared.set(permission, { ...panel, sender, binary, forget, dispose });
		sender.once("destroyed", dispose);
		sender.on("did-start-navigation", onNavigation);
		panel.window.once("closed", forget);
		void binary.catch(dispose);
	}
}

export function preloadMissingPermissionAccessories(sender: WebContents) {
	if (process.platform !== "darwin") return;
	try {
		const permissions: Permission[] = ["screen", "accessibility"];
		preloadPermissionAccessories(
			sender,
			permissions.filter((permission) => !granted(permission)),
		);
	} catch (error) {
		console.warn("Could not preload the permission drag accessory:", error);
	}
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
	const owner = BrowserWindow.fromWebContents(sender);
	if (!owner || owner.isDestroyed()) return;
	// Asking again for the panel that is already open keeps it; rebuilding the
	// window would make it disappear and reappear.
	if (
		active &&
		!active.isClosing() &&
		active.permission === permission &&
		!active.window.isDestroyed() &&
		active.owner === owner
	)
		return;
	closePermissionAccessory();
	const request = generation;
	const warm = prepared.get(permission);
	const binary = await (warm?.sender === sender ? warm.binary : resolveHelper());
	if (
		request !== generation ||
		sender.isDestroyed() ||
		owner.isDestroyed() ||
		(!testSetup && granted(permission))
	)
		return;
	const rendererURL = process.env.VITE_DEV_SERVER_URL || getPackagedRendererBaseUrl();
	if (!rendererURL) return;
	const preload = prepared.get(permission);
	const panel =
		preload?.sender === sender && !preload.window.isDestroyed()
			? preload
			: createAccessoryWindow(permission, owner, rendererURL);
	if (panel === preload) preload.forget();
	const child = spawn(
		binary,
		["--app-bundle", bundle, "--permission", permission, "--parent-pid", String(process.pid)],
		{ stdio: ["pipe", "pipe", "pipe"] },
	);
	await ownAccessory(
		child,
		permission,
		sender,
		owner,
		testSetup,
		panel.window,
		bundle,
		panel.onFrame,
	);
}

function createAccessoryWindow(permission: Permission, owner: BrowserWindow, rendererURL: string) {
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
	permissionAccessoryWindowOwners.set(accessory, owner);
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
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	const cancelHide = () => {
		if (hideTimer) clearTimeout(hideTimer);
		hideTimer = undefined;
	};
	accessory.once("closed", cancelHide);
	accessory.once("ready-to-show", () => {
		loaded = true;
		if (shouldShow) accessory.showInactive();
	});
	void accessory.loadURL(url.toString()).catch(() => {
		if (!accessory.isDestroyed()) accessory.destroy();
	});
	const onFrame = (event: AccessoryFrame) => {
		if (accessory.isDestroyed()) return;
		if (!event.visible) {
			if (hideTimer) return;
			hideTimer = setTimeout(() => {
				hideTimer = undefined;
				shouldShow = false;
				if (!accessory.isDestroyed()) accessory.hide();
			}, ACCESSORY_HIDE_DELAY_MS);
			return;
		}
		cancelHide();
		if (
			![event.x, event.y, event.width, event.height].every(Number.isInteger) ||
			event.width !== 368 ||
			event.height !== 264
		)
			return;
		const bounds = { x: event.x!, y: event.y!, width: 368, height: 264 };
		const current = accessory.getBounds();
		if (current.x !== bounds.x || current.y !== bounds.y) accessory.setBounds(bounds);
		shouldShow = true;
		if (loaded && !accessory.isVisible()) accessory.showInactive();
	};
	return { window: accessory, onFrame };
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
		active = { close, isClosing: () => closing, window: accessory, bundle, owner, permission };
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
				if (!closing && event.startsWith("{")) {
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
