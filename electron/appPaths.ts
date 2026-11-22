import { mkdirSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { reserveInstanceSession, shareSafeStorageKeyWhenReady } from "./instanceSession";

if (process.env["VITE_DEV_SERVER_URL"]) {
	const devUserDataPath = path.join(app.getPath("appData"), "Recordly-dev");
	mkdirSync(path.join(devUserDataPath, "session"), { recursive: true });
	app.setPath("userData", devUserDataPath);
	app.setPath("sessionData", path.join(devUserDataPath, "session"));
}

let instanceSession: ReturnType<typeof reserveInstanceSession> | undefined;
let isPrimarySession = false;

/** True when this process owns the profile's primary Chromium storage and its secure-storage key. */
export function usesPrimaryInstanceSession(): boolean {
	return isPrimarySession;
}

// Reuse existing Chromium storage for the primary process and durable isolated
// slots for additional processes. Projects and account storage remain shared.
export function initializeInstanceSession() {
	if (instanceSession) return;
	const primarySessionPath = app.getPath("sessionData");
	const reservation = reserveInstanceSession(app.getPath("userData"), primarySessionPath);
	try {
		if (process.platform === "win32") {
			try {
				const shared = shareSafeStorageKeyWhenReady(
					primarySessionPath,
					reservation.sessionPath,
				);
				if (shared === "no-primary-key")
					console.warn(
						"[instance-session] The primary profile has no secure storage key yet; this " +
							"instance uses its own until a later launch shares it (the replaced key is kept).",
					);
			} catch (error) {
				console.warn("[instance-session] Could not share the secure storage key", error);
			}
		}
		app.setPath("sessionData", reservation.sessionPath);
	} catch (error) {
		reservation.release();
		throw error;
	}
	instanceSession = reservation;
	isPrimarySession = reservation.sessionPath === primarySessionPath;
	const release = () => reservation.release();
	app.once("will-quit", release);
	process.once("exit", release);
}

export const USER_DATA_PATH = app.getPath("userData");
// Keep Store-created videos/projects outside package state, which is removed on
// uninstall. A user's saved custom recording directory still takes precedence.
export const RECORDINGS_DIR = process.windowsStore
	? path.join(app.getPath("videos"), "Recordly")
	: path.join(USER_DATA_PATH, "recordings");
