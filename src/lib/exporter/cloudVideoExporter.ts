import { exportMp4WithRecovery } from "./modernExportRecovery";

/** Cloud delivery owns compression choices, while sharing the edit renderer and audio pipeline. */
export function exportCloudVideo(options: Parameters<typeof exportMp4WithRecovery>[0]) {
	return exportMp4WithRecovery({
		...options,
		pipelineModel: "modern",
		// Cloud delivery owns its encoder route; remembered outer routes describe local exports.
		initialRoute: undefined,
		config: {
			...options.config,
			deliveryProfile: "cloud",
			encodingMode: "balanced",
			backendPreference: "breeze",
			experimentalNativeExport: false,
			experimentalNvidiaCudaExport: false,
			preferredEncoderPath: null,
		},
	});
}
