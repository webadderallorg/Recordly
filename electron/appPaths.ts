import path from "node:path";
import { app } from "electron";
import { getActiveWorkspaceLayout, initializeWorkspaceStorage } from "./storageSettings";

if (process.env["VITE_DEV_SERVER_URL"]) {
	const devUserDataPath = path.join(app.getPath("appData"), "Recordly-dev");
	app.setPath("userData", devUserDataPath);
	app.setPath("sessionData", path.join(devUserDataPath, "session"));
}

export const USER_DATA_PATH = app.getPath("userData");
export const INITIAL_WORKSPACE_LAYOUT = initializeWorkspaceStorage(app, USER_DATA_PATH);
export const RECORDINGS_DIR = path.join(USER_DATA_PATH, "recordings");

export function getConfiguredWorkspaceLayout() {
	return getActiveWorkspaceLayout();
}
