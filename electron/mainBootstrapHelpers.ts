import fs from "node:fs/promises";
import { app } from "electron";
import { RECORDINGS_DIR } from "./appPaths";

export function configureGpuAccelerationSwitches() {
	if (process.platform === "darwin") {
		app.commandLine.appendSwitch("use-angle", "metal");
		app.commandLine.appendSwitch("disable-features", "MacCatapLoopbackAudioForScreenShare");
		return;
	}

	if (process.platform === "win32") {
		app.commandLine.appendSwitch("use-angle", "d3d11");
		return;
	}

	app.commandLine.appendSwitch("use-gl", "egl");
	app.commandLine.appendSwitch("disable-features", "VaapiVideoDecoder,VaapiVideoEncoder");
}

export async function logSmokeExportGpuDiagnostics(isSmokeExport: boolean) {
	if (!isSmokeExport) {
		return;
	}

	try {
		console.log("[smoke-export] GPU feature status", JSON.stringify(app.getGPUFeatureStatus()));
		console.log("[smoke-export] GPU info", JSON.stringify(await app.getGPUInfo("basic")));
	} catch (error) {
		console.warn("[smoke-export] Failed to read GPU diagnostics:", error);
	}
}

export async function ensureRecordingsDir() {
	try {
		await fs.mkdir(RECORDINGS_DIR, { recursive: true });
		console.log("RECORDINGS_DIR:", RECORDINGS_DIR);
		console.log("User Data Path:", app.getPath("userData"));
	} catch (error) {
		console.error("Failed to create recordings directory:", error);
	}
}