import path from "node:path";
import { mkdirSync } from "node:fs";
import { app } from "electron";
import { reserveInstanceSession } from "./instanceSession";

if (process.env["VITE_DEV_SERVER_URL"]) {
	const devUserDataPath = path.join(app.getPath("appData"), "Recordly-dev");
	mkdirSync(path.join(devUserDataPath, "session"), { recursive: true });
	app.setPath("userData", devUserDataPath);
	app.setPath("sessionData", path.join(devUserDataPath, "session"));
}

let instanceSession: ReturnType<typeof reserveInstanceSession> | undefined;

// Reuse existing Chromium storage for the primary process and durable isolated
// slots for additional processes. Projects and account storage remain shared.
export function initializeInstanceSession() {
	if (instanceSession) return;
	const reservation = reserveInstanceSession(app.getPath("userData"), app.getPath("sessionData"));
	try {
		app.setPath("sessionData", reservation.sessionPath);
	} catch (error) {
		reservation.release();
		throw error;
	}
	instanceSession = reservation;
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
