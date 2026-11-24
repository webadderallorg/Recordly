import os from "node:os";
import { app, screen } from "electron";
import { redactDiagnostic } from "../src/lib/feedback/diagnosticRedaction";
import { getExportHardwareInfo } from "./ipc/export/nativeVideo/hardware";

function displayConfiguration() {
	try {
		const primary = screen.getPrimaryDisplay();
		const displays = screen.getAllDisplays();
		return {
			count: displays.length,
			connected: [primary, ...displays.filter(({ id }) => id !== primary.id)]
				.slice(0, 4)
				.map((display) => ({
					primary: display.id === primary.id,
					internal: display.internal,
					widthDip: display.bounds.width,
					heightDip: display.bounds.height,
					scaleFactor: display.scaleFactor,
					refreshHz: display.displayFrequency > 0 ? display.displayFrequency : undefined,
					colorDepth: display.colorDepth > 0 ? display.colorDepth : undefined,
					rotation: display.rotation,
				})),
		};
	} catch {
		// Headless runs and an unavailable display service can still report the host.
		return undefined;
	}
}

function hardwareLabel(value: string | null | undefined) {
	return value ? redactDiagnostic(value).slice(0, 120) : null;
}

/** Snapshot only diagnostic host properties. Machine names, serials and display IDs stay local. */
export async function collectSupportDeviceInfo() {
	const capturedAt = new Date().toISOString();
	const displays = displayConfiguration();
	const freeMemoryMiB = Math.round(os.freemem() / 1024 ** 2);
	const translation = app.runningUnderARM64Translation;
	const hardware = await getExportHardwareInfo(800);
	return {
		capturedAt,
		machineModel: hardwareLabel(hardware.machineModel),
		hostArchitecture: translation ? "arm64" : os.machine(),
		runningUnderArm64Translation: translation,
		cpu: {
			model: hardwareLabel(hardware.cpuModel),
			logicalProcessors: hardware.logicalProcessors,
		},
		memory: { totalMiB: Math.round(os.totalmem() / 1024 ** 2), freeMiB: freeMemoryMiB },
		graphics: {
			probeStatus: hardware.gpuInfoStatus,
			adapters: hardware.gpus.map(({ name, vendor, active, driverVersion }) => ({
				name: hardwareLabel(name),
				vendor: hardwareLabel(vendor),
				active,
				driverVersion: hardwareLabel(driverVersion),
			})),
			features: hardware.gpuFeatures,
		},
		displays,
	};
}

export type SupportDeviceInfo = Awaited<ReturnType<typeof collectSupportDeviceInfo>>;
