import { normalizeLightningRuntimePlatform } from "./backendPolicy";
import {
	getNowMs,
	LIGHTNING_PIPELINE_NAME,
	MEDIA_SOURCE_RETRY_ERROR_TOKENS,
	NATIVE_ENCODER_QUEUE_LIMIT,
	NATIVE_EXPORT_ENGINE_NAME,
} from "./modernExportConstants";
import type { ModernExportHooks } from "./modernExportHooks";
import type { ExportRuntimeDiagnostics, ModernExportSession } from "./modernExportSession";

type Hooks = Pick<ModernExportHooks, "getRuntimePlatform">;

type Session = Pick<
	ModernExportSession,
	| "backpressureProfile"
	| "browser"
	| "config"
	| "effectiveDurationSec"
	| "flow"
	| "metrics"
	| "native"
	| "sourceVideoInfo"
>;

export function shouldRetryWithFallbackMediaSource(
	session: Session,
	_hooks: Hooks,
	error: unknown,
): boolean {
	const resolvedError = session.browser.encoderError ?? error;
	const message = resolvedError instanceof Error ? resolvedError.message : String(resolvedError);
	const normalizedMessage = message.toLowerCase();
	return MEDIA_SOURCE_RETRY_ERROR_TOKENS.some((token) => normalizedMessage.includes(token));
}

export function getPlatformLabel(session: Session, hooks: Hooks): string {
	const { runtime, hardware } = session.metrics.runtimeDiagnostics;
	switch (runtime?.platform ?? hardware?.platform ?? hooks.getRuntimePlatform()) {
		case "win32":
			return "Windows";
		case "linux":
			return "Linux";
		case "darwin":
			return "macOS";
		default:
			if (typeof navigator === "undefined") {
				return "Unknown";
			}

			return navigator.platform || navigator.userAgent || "Unknown";
	}
}

export function getRuntimePlatform(): ReturnType<typeof normalizeLightningRuntimePlatform> {
	if (typeof navigator === "undefined") {
		return "unknown";
	}

	return normalizeLightningRuntimePlatform(navigator.platform || navigator.userAgent || "");
}

export async function collectRuntimeDiagnostics(
	_session: Session,
	_hooks: Hooks,
): Promise<ExportRuntimeDiagnostics> {
	const diagnostics: ExportRuntimeDiagnostics = {};
	if (typeof navigator !== "undefined") {
		const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
		if (navigator.userAgent) diagnostics.userAgent = navigator.userAgent;
		if (navigator.hardwareConcurrency > 0) {
			diagnostics.logicalProcessors = navigator.hardwareConcurrency;
		}
		if (
			typeof navigatorWithMemory.deviceMemory === "number" &&
			navigatorWithMemory.deviceMemory > 0
		) {
			diagnostics.deviceMemoryGb = navigatorWithMemory.deviceMemory;
		}
	}

	let hardwareFinished = false;
	let runtimeFinished = false;
	// Diagnostic IPC is best effort; collect in parallel and bound the entire wait.
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const collection = Promise.all([
			(async () => {
				try {
					const getRuntime =
						typeof window !== "undefined" && window.electronAPI?.getExportRuntimeInfo;
					if (getRuntime) {
						const result = await getRuntime();
						if (result.success && result.runtime) diagnostics.runtime = result.runtime;
					}
				} catch {
					/* Native runtime diagnostics are best effort. */
				} finally {
					runtimeFinished = true;
				}
			})(),
			(async () => {
				try {
					const getVersion =
						typeof window !== "undefined" && window.electronAPI?.getAppVersion;
					if (getVersion) {
						const version = await getVersion();
						if (typeof version === "string") diagnostics.appVersion = version;
					}
				} catch {
					/* Diagnostics must never prevent exporting. */
				}
			})(),
			(async () => {
				try {
					const getHardware =
						typeof window !== "undefined" && window.electronAPI?.getExportHardwareInfo;
					if (getHardware) {
						const result = await getHardware();
						if (result.success && result.hardware)
							diagnostics.hardware = result.hardware;
					}
				} catch {
					/* Diagnostics must never prevent exporting. */
				} finally {
					hardwareFinished = true;
				}
			})(),
		]);
		await Promise.race([
			collection,
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, 1500);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}

	return {
		...diagnostics,
		appVersion: diagnostics.runtime?.appVersion ?? diagnostics.appVersion,
		runtimeInfoStatus: diagnostics.runtime
			? "available"
			: runtimeFinished
				? "unavailable"
				: "timed-out",
		hardwareInfoStatus: diagnostics.hardware
			? "available"
			: hardwareFinished
				? "unavailable"
				: "timed-out",
	};
}

export function getLightningErrorGuidance(
	session: Session,
	hooks: Hooks,
	message: string,
): string[] {
	const guidance = new Set<string>();
	const platform = getPlatformLabel(session, hooks);
	const isVideoDecodeFailure = /VideoDecoder failure|VIDEO_DECODE|VIDEO_CODEC/i.test(message);

	if (isVideoDecodeFailure) {
		if (message.includes("VIDEO_DECODE_RECOVERY_FAILED")) {
			guidance.add(
				"The default decoder and software retry both failed. Compare their source times below; failure near the same point suggests a source/codec issue but does not prove corruption.",
			);
		}
		guidance.add(
			"The input video decoder failed before Recordly could finish rendering the source frames.",
		);
		guidance.add(
			"If only this recording fails, remux or convert it to a standard H.264 MP4; the source may contain a damaged or unsupported frame.",
		);
		guidance.add(
			"If every recording fails, update the GPU/media driver. Lowering export FPS does not change the input stream that must be decoded.",
		);
	} else {
		guidance.add(
			"Lightning is designed to work on macOS, Windows, and Linux, but the available encoder path depends on WebCodecs support, GPU drivers, and the bundled FFmpeg encoders.",
		);
	}

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
		guidance.add("Update GPU and media drivers so system H.264 encoding paths are available.");
	}

	if (session.native.lastNativeExportError) {
		guidance.add(
			`Check that the packaged FFmpeg build includes a compatible ${NATIVE_EXPORT_ENGINE_NAME} encoder path for ${platform}, plus libx264 as a software fallback.`,
		);
	}

	if (!isVideoDecodeFailure && platform === "Windows") {
		guidance.add(
			"Windows Lightning exports can use WebCodecs or FFmpeg encoders such as h264_nvenc, h264_qsv, h264_amf, h264_mf, or libx264 depending on the machine.",
		);
	} else if (!isVideoDecodeFailure && platform === "Linux") {
		guidance.add(
			"Linux Lightning exports can use WebCodecs when supported, or FFmpeg encoders such as libx264 and optional GPU paths depending on the distro build.",
		);
	} else if (!isVideoDecodeFailure && platform === "macOS") {
		guidance.add(
			"macOS Lightning exports can use WebCodecs or VideoToolbox/libx264 through Breeze depending on the output profile.",
		);
	}

	return [...guidance];
}

export function buildLightningExportError(session: Session, hooks: Hooks, error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const failureCode = message.match(/\[([A-Z][A-Z0-9_]+)\]/)?.[1];
	const isVideoDecodeFailure = /VideoDecoder failure|VIDEO_DECODE|VIDEO_CODEC/i.test(message);
	const resolvedEncodePath =
		session.metrics.encodeBackend === "ffmpeg"
			? `${NATIVE_EXPORT_ENGINE_NAME} native`
			: session.metrics.encodeBackend === "webcodecs"
				? "WebCodecs"
				: null;
	const lines = [
		`${LIGHTNING_PIPELINE_NAME} export failed.`,
		...(failureCode ? [`Failure code: ${failureCode}`] : []),
		...(isVideoDecodeFailure ? ["Failure stage: Input video decoding"] : []),
		`Reason: ${message}`,
		`Platform: ${getPlatformLabel(session, hooks)}`,
		`Requested backend mode: ${session.config.backendPreference ?? "auto"}`,
		`Output: ${session.config.width}x${session.config.height} @ ${session.config.frameRate} FPS; ${(session.config.bitrate / 1_000_000).toFixed(2)} Mbps; mode=${session.config.encodingMode ?? "default"}`,
	];

	if (session.metrics.runtimeDiagnostics.appVersion) {
		lines.push(`Recordly version: ${session.metrics.runtimeDiagnostics.appVersion}`);
	}
	const { runtime, hardware, userAgent, runtimeInfoStatus } = session.metrics.runtimeDiagnostics;
	if (runtime) {
		const versions = Object.entries(runtime.versions).filter(([, value]) => Boolean(value));
		lines.push(
			`Runtime: ${versions.map(([name, value]) => `${name === "chromium" ? "Chromium" : name === "electron" ? "Electron" : name === "node" ? "Node.js" : "V8"} ${value}`).join("; ") || "version information unavailable"}`,
		);
		lines.push(
			`System: ${getPlatformLabel(session, hooks)}${runtime.osVersion ? ` ${runtime.osVersion}` : " (product version unavailable)"}; Electron process=${runtime.arch}; kernel release=${runtime.kernelRelease}${hardware?.machineModel ? `; model=${hardware.machineModel}` : ""}`,
		);
	} else if (hardware) {
		lines.push(
			`Runtime: native process versions unavailable (${runtimeInfoStatus ?? "unavailable"})`,
		);
		lines.push(
			`System: ${hardware.platform} (Electron process=${hardware.arch}); kernel release=${hardware.release}${hardware.machineModel ? `; model=${hardware.machineModel}` : ""}`,
		);
	} else {
		lines.push(
			`Runtime: native process information unavailable (${runtimeInfoStatus ?? "unavailable"})`,
		);
	}
	if (userAgent) lines.push(`Browser user agent (compatibility string): ${userAgent}`);
	if (hardware) {
		lines.push(
			`CPU: ${hardware.cpuModel ?? "Unknown"}; ${hardware.logicalProcessors} logical processors`,
		);
		lines.push(`Memory: ${hardware.totalMemoryGb} GB`);
		for (const [index, gpu] of hardware.gpus.entries()) {
			const details = [
				gpu.vendor && !gpu.name.toLowerCase().includes(gpu.vendor.toLowerCase())
					? `vendor=${gpu.vendor}`
					: null,
				gpu.active === true ? "active" : gpu.active === false ? "inactive" : null,
			].filter((value): value is string => Boolean(value));
			lines.push(
				`GPU ${index + 1}: ${gpu.name}${details.length ? `; ${details.join("; ")}` : ""}`,
			);
		}
		const gpuFeatures = [
			hardware.gpuFeatures.videoDecode
				? `video decode=${hardware.gpuFeatures.videoDecode}`
				: null,
			hardware.gpuFeatures.videoEncode
				? `video encode=${hardware.gpuFeatures.videoEncode}`
				: null,
			hardware.gpuFeatures.webgl ? `WebGL=${hardware.gpuFeatures.webgl}` : null,
			hardware.gpuFeatures.webgpu ? `WebGPU=${hardware.gpuFeatures.webgpu}` : null,
		].filter((value): value is string => Boolean(value));
		if (gpuFeatures.length > 0) {
			lines.push(`GPU acceleration: ${gpuFeatures.join("; ")}`);
		}
	} else {
		const hardwareParts = [
			session.metrics.runtimeDiagnostics.logicalProcessors
				? `${session.metrics.runtimeDiagnostics.logicalProcessors} logical processors`
				: null,
			session.metrics.runtimeDiagnostics.deviceMemoryGb
				? `${session.metrics.runtimeDiagnostics.deviceMemoryGb} GB device memory`
				: null,
		].filter((value): value is string => Boolean(value));
		if (hardwareParts.length > 0) {
			lines.push(`Hardware capacity: ${hardwareParts.join("; ")}`);
		}
	}

	if (session.sourceVideoInfo) {
		lines.push(
			`Source: ${session.sourceVideoInfo.codec} ${session.sourceVideoInfo.width}x${session.sourceVideoInfo.height} @ ${session.sourceVideoInfo.frameRateSource === "fallback" ? `unknown (decode fallback=${session.sourceVideoInfo.frameRate.toFixed(3)})` : Number.isFinite(session.sourceVideoInfo.frameRate) && session.sourceVideoInfo.frameRate > 0 ? session.sourceVideoInfo.frameRate.toFixed(3) : "unknown"} FPS; ${Number.isFinite(session.sourceVideoInfo.duration) ? session.sourceVideoInfo.duration.toFixed(3) : "unknown"}s (untrimmed container duration)`,
		);
		lines.push(
			session.sourceVideoInfo.hasAudio
				? `Source audio: ${session.sourceVideoInfo.audioCodec ?? "unknown codec"}${session.sourceVideoInfo.audioSampleRate ? ` @ ${session.sourceVideoInfo.audioSampleRate} Hz` : ""}`
				: "Source audio: none",
		);
	}

	if (Number.isFinite(session.effectiveDurationSec) && session.effectiveDurationSec > 0) {
		const frames = Math.ceil(session.effectiveDurationSec * session.config.frameRate);
		lines.push(
			`Output timeline: ${session.effectiveDurationSec.toFixed(3)}s; planned frames=${frames}; planned frame span=${(frames / session.config.frameRate).toFixed(3)}s`,
		);
	}
	if (session.metrics.totalExportStartTimeMs > 0) {
		const elapsedSeconds = Math.max(
			0,
			(getNowMs() - session.metrics.totalExportStartTimeMs) / 1000,
		);
		const expectedFrames = Math.ceil(session.effectiveDurationSec * session.config.frameRate);
		const progressSuffix =
			expectedFrames > 0
				? `/${expectedFrames} (${Math.min(100, (session.metrics.processedFrameCount / expectedFrames) * 100).toFixed(1)}%)`
				: "";
		lines.push(
			`Progress at failure: ${session.metrics.processedFrameCount}${progressSuffix} reported output frames after ${elapsedSeconds.toFixed(2)}s in current attempt`,
		);
	}

	if (session.metrics.diagnosticStartedAt > 0) {
		lines.push(
			`Total export elapsed: ${(Math.max(0, getNowMs() - session.metrics.diagnosticStartedAt) / 1000).toFixed(2)}s (includes diagnostics and retries)`,
		);
	}
	if (session.metrics.mediaSourceRetryAttempted) {
		lines.push("Media source retry: attempted with a fresh source");
	}

	if (session.metrics.renderBackend) {
		lines.push(`Renderer: ${session.metrics.renderBackend}`);
	}

	if (resolvedEncodePath) {
		lines.push(
			`Encoder path: ${resolvedEncodePath}${session.metrics.encoderName ? ` (${session.metrics.encoderName})` : ""}`,
		);
	}

	if (session.backpressureProfile) {
		lines.push(
			`Pipeline tuning: ${session.backpressureProfile.name}; configured decode queue=${session.config.maxDecodeQueue ?? session.backpressureProfile.maxDecodeQueue}; configured pending frames=${session.config.maxPendingFrames ?? session.backpressureProfile.maxPendingFrames}`,
		);
	}

	if (session.native.nativeH264Encoder || session.native.nativeInputMode === "h264-stream") {
		lines.push(
			`Active encoder queue limit: ${NATIVE_ENCODER_QUEUE_LIMIT} (native H.264 stream)`,
		);
		lines.push(`Native writes in flight limit: ${session.flow.maxNativeWriteInFlight}`);
	} else if (session.native.nativeInputMode === "rawvideo") {
		lines.push(
			`Native rawvideo writes in flight limit: ${session.flow.maxNativeWriteInFlight}; browser encoder queue not used`,
		);
	} else if (session.browser.encoder && session.flow.webCodecsEncodeQueueLimit > 0) {
		lines.push(
			`Active encoder queue limit: ${session.flow.webCodecsEncodeQueueLimit} (WebCodecs)`,
		);
	}

	if (
		session.native.lastNativeExportError &&
		!message.includes(session.native.lastNativeExportError)
	) {
		lines.push(
			`${NATIVE_EXPORT_ENGINE_NAME} fallback: ${session.native.lastNativeExportError}`,
		);
	}

	const guidance = getLightningErrorGuidance(session, hooks, message);
	if (guidance.length > 0) {
		lines.push("Suggested actions:");
		for (const item of guidance) {
			lines.push(`- ${item}`);
		}
	}

	return lines.join("\n");
}
