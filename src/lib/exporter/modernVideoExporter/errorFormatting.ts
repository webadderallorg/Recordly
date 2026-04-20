import { normalizeLightningRuntimePlatform } from "../backendPolicy";
import {
	type ExporterHost,
	LIGHTNING_PIPELINE_NAME,
	NATIVE_EXPORT_ENGINE_NAME,
} from "./exporterTypes";

export function getPlatformLabel(): string {
	if (typeof navigator === "undefined") return "Unknown";
	const platformHint = navigator.platform || navigator.userAgent || "";
	switch (normalizeLightningRuntimePlatform(platformHint)) {
		case "win32":
			return "Windows";
		case "linux":
			return "Linux";
		case "darwin":
			return "macOS";
		default:
			return platformHint || "Unknown";
	}
}

export function getLightningErrorGuidance(
	message: string,
	lastNativeExportError: string | null,
): string[] {
	const guidance = new Set<string>();
	const platform = getPlatformLabel();

	guidance.add(
		"Lightning is designed to work on macOS, Windows, and Linux, but the available encoder path depends on WebCodecs support, GPU drivers, and the bundled FFmpeg encoders.",
	);

	if (/even output dimensions/i.test(message)) {
		guidance.add(
			"Use an export size with even width and height. Switching quality presets usually fixes this automatically.",
		);
	}

	if (
		/not supported on this system|H\.264 encoding|encoder path .* is not supported|Video encoding/i.test(
			message,
		)
	) {
		guidance.add("Try Good or Medium quality to reduce output resolution and bitrate.");
		guidance.add(
			"Update GPU and media drivers so system H.264 encoding paths are available.",
		);
	}

	if (lastNativeExportError) {
		guidance.add(
			`Check that the packaged FFmpeg build includes a compatible ${NATIVE_EXPORT_ENGINE_NAME} encoder path for ${platform}, plus libx264 as a software fallback.`,
		);
	}

	if (platform === "Windows") {
		guidance.add(
			"Windows Lightning exports can use WebCodecs or FFmpeg encoders such as h264_nvenc, h264_qsv, h264_amf, h264_mf, or libx264 depending on the machine.",
		);
	} else if (platform === "Linux") {
		guidance.add(
			"Linux Lightning exports can use WebCodecs when supported, or FFmpeg encoders such as libx264 and optional GPU paths depending on the distro build.",
		);
	} else if (platform === "macOS") {
		guidance.add(
			"macOS Lightning exports can use WebCodecs or VideoToolbox/libx264 through Breeze depending on the output profile.",
		);
	}

	return [...guidance];
}

export function buildLightningExportError(
	error: unknown,
	host: Pick<
		ExporterHost,
		"config" | "renderBackend" | "encodeBackend" | "encoderName" | "lastNativeExportError"
	>,
): string {
	const message = error instanceof Error ? error.message : String(error);
	const resolvedEncodePath =
		host.encodeBackend === "ffmpeg"
			? `${NATIVE_EXPORT_ENGINE_NAME} native`
			: host.encodeBackend === "webcodecs"
				? "WebCodecs"
				: null;
	const lines = [
		`${LIGHTNING_PIPELINE_NAME} export failed.`,
		`Reason: ${message}`,
		`Platform: ${getPlatformLabel()}`,
		`Requested backend mode: ${host.config.backendPreference ?? "auto"}`,
		`Output: ${host.config.width}x${host.config.height} @ ${host.config.frameRate} FPS`,
	];

	if (host.renderBackend) {
		lines.push(`Renderer: ${host.renderBackend}`);
	}

	if (resolvedEncodePath) {
		lines.push(
			`Encoder path: ${resolvedEncodePath}${host.encoderName ? ` (${host.encoderName})` : ""}`,
		);
	}

	if (host.lastNativeExportError && !message.includes(host.lastNativeExportError)) {
		lines.push(`${NATIVE_EXPORT_ENGINE_NAME} fallback: ${host.lastNativeExportError}`);
	}

	const guidance = getLightningErrorGuidance(message, host.lastNativeExportError);
	if (guidance.length > 0) {
		lines.push("Suggested actions:");
		for (const item of guidance) {
			lines.push(`- ${item}`);
		}
	}

	return lines.join("\n");
}
