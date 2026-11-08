import { BlobSource, Input, MP4 } from "mediabunny";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
	type AnnotationRegion,
	DEFAULT_ANNOTATION_STYLE,
	type ZoomRegion,
} from "@/components/video-editor/types";
import {
	createMp4Exporter,
	exportMp4WithRecovery,
	type Mp4ExportRoute,
} from "@/lib/exporter/modernExportRecovery";
import { FrameRenderer as ModernFrameRenderer } from "@/lib/exporter/modernFrameRenderer";
import { ModernVideoExporter } from "@/lib/exporter/modernVideoExporter";
import type { VideoExporterConfig } from "@/lib/exporter/modernVideoExporterConfig";
import {
	getOrderedSupportedMp4EncoderCandidates,
	resolveSupportedMp4EncoderPath,
} from "@/lib/exporter/mp4Support";
import type { ExportProgress, ExportResult } from "@/lib/exporter/types";

async function inspectMp4(blob: Blob) {
	const input = new Input({ source: new BlobSource(blob), formats: [MP4] });
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error("The MP4 has no video track");
		return {
			container: (await input.getFormat()) === MP4 ? "mp4" : "unknown",
			codec: track.codec,
			codecParameter: await track.getCodecParameterString(),
			frameCount: (await track.computePacketStats()).packetCount,
			width: track.displayWidth,
			height: track.displayHeight,
			duration: await input.computeDuration(),
			audioTracks: (await input.getAudioTracks()).length,
		};
	} finally {
		input.dispose();
	}
}

function mediaEvent(
	video: HTMLVideoElement,
	event: "loadeddata" | "seeked" | "timeupdate",
	action: () => void = () => undefined,
) {
	return new Promise<void>((resolve, reject) => {
		const finish = (error?: Error) => {
			clearTimeout(timer);
			video.removeEventListener(event, ready);
			video.removeEventListener("error", failed);
			if (error) reject(error);
			else resolve();
		};
		const ready = () => finish();
		const failed = () => finish(new Error(video.error?.message || "MP4 playback failed"));
		const timer = setTimeout(() => finish(new Error(`MP4 ${event} timed out`)), 10_000);
		video.addEventListener(event, ready, { once: true });
		video.addEventListener("error", failed, { once: true });
		try {
			action();
		} catch (error) {
			finish(error instanceof Error ? error : new Error(String(error)));
		}
	});
}

async function inspectPlayback(blob: Blob, sampleTimes = [0.5, 5.5]) {
	const video = document.createElement("video");
	const url = URL.createObjectURL(blob);
	video.muted = true;
	video.playsInline = true;
	video.preload = "auto";
	const canvas = document.createElement("canvas");
	try {
		await mediaEvent(video, "loadeddata", () => {
			video.src = url;
			video.load();
		});
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("Canvas pixel inspection is unavailable");
		const hashes: number[] = [];
		const centerMaximumRgb: number[] = [];
		for (const time of sampleTimes) {
			await mediaEvent(video, "seeked", () => {
				video.currentTime = time;
			});
			ctx.drawImage(video, 0, 0);
			let hash = 2166136261;
			for (const byte of ctx.getImageData(0, 0, canvas.width, canvas.height).data)
				hash = Math.imul(hash ^ byte, 16777619) >>> 0;
			hashes.push(hash);
			const center = ctx.getImageData(
				Math.floor(canvas.width * 0.35),
				Math.floor(canvas.height * 0.35),
				Math.floor(canvas.width * 0.3),
				Math.floor(canvas.height * 0.3),
			).data;
			let maximum = 0;
			for (let i = 0; i < center.length; i += 4)
				maximum = Math.max(maximum, center[i], center[i + 1], center[i + 2]);
			centerMaximumRgb.push(maximum);
		}
		await mediaEvent(video, "seeked", () => {
			video.currentTime = 0.5;
		});
		const beforePlay = video.currentTime;
		await video.play();
		await mediaEvent(video, "timeupdate");
		video.pause();
		return {
			width: video.videoWidth,
			height: video.videoHeight,
			duration: video.duration,
			advanced: video.currentTime > beforePlay,
			sampleTimes,
			hashes,
			centerMaximumRgb,
		};
	} finally {
		video.pause();
		video.removeAttribute("src");
		video.load();
		URL.revokeObjectURL(url);
	}
}

type ExportScenario =
	| "clean"
	| "solid-mask"
	| "zoomed-edge-blur"
	| "renderer-recovery"
	| "renderer-recovery-clean"
	| "cancel-before-recovery"
	| "encoder-recovery";

function edgeBlurSettings(): { annotationRegions: AnnotationRegion[]; zoomRegions: ZoomRegion[] } {
	const blur = {
		type: "blur" as const,
		startMs: 0,
		endMs: 6000,
		content: "",
		style: { ...DEFAULT_ANNOTATION_STYLE, borderRadius: 0 },
		blurIntensity: 4,
	};
	return {
		annotationRegions: [
			{
				...blur,
				id: "right-edge-blur",
				position: { x: 85.78125, y: 25 },
				size: { width: 10, height: 20 },
				zIndex: 1,
			},
			{
				...blur,
				id: "bottom-edge-blur",
				position: { x: 25, y: (157.66666666666666 / 180) * 100 },
				size: { width: 15, height: 10 },
				zIndex: 2,
			},
		],
		zoomRegions: [
			{
				id: "edge-crossing-zoom",
				startMs: 1000,
				endMs: 4000,
				depth: 2,
				focus: { cx: 0.5, cy: 0.5 },
				mode: "manual",
			},
		],
	};
}

async function exportWithSoftwareRecovery(config: VideoExporterConfig) {
	if (config.preferredEncoderPath?.hardwareAcceleration !== "prefer-hardware")
		throw new Error(
			"[HARDWARE_H264_UNAVAILABLE] A real configured hardware-preference path is required for this fault injection",
		);
	const softwareProbes = [];
	for (const candidate of getOrderedSupportedMp4EncoderCandidates({}).filter(
		(path) => path.hardwareAcceleration === "prefer-software",
	)) {
		for (const latencyMode of ["realtime", "quality"] as const) {
			try {
				const support = await VideoEncoder.isConfigSupported({
					...candidate,
					width: config.width,
					height: config.height,
					framerate: config.frameRate,
					bitrate: config.bitrate,
					bitrateMode: "variable",
					latencyMode,
				});
				softwareProbes.push({
					...candidate,
					latencyMode,
					supported: support.supported === true,
				});
			} catch (error) {
				softwareProbes.push({
					...candidate,
					latencyMode,
					supported: false,
					error: String(error),
				});
			}
		}
	}
	const attempts: Array<{ route: Mp4ExportRoute; result: ExportResult }> = [];
	const factories: Mp4ExportRoute[] = [];
	const injectedFailures: Array<{ state: CodecState; name: string; message: string }> = [];
	const outcome = await exportMp4WithRecovery({
		pipelineModel: "modern",
		config,
		isCancelled: () => false,
		setActiveExporter: () => undefined,
		onAttemptResult: (route, result) =>
			attempts.push({ route, result: { ...result, blob: undefined } }),
		createExporter: async (route, attemptConfig) => {
			factories.push(route);
			const exporter = await createMp4Exporter(route, attemptConfig);
			if (route !== "modern") return exporter;
			return {
				cancel: () => exporter.cancel(),
				export: async () => {
					const encode = VideoEncoder.prototype.encode;
					// Close an actual configured browser encoder, then invoke its original
					// encode method. The browser supplies the real InvalidStateError.
					VideoEncoder.prototype.encode = function (...args) {
						const state = this.state;
						this.close();
						try {
							return encode.apply(this, args);
						} catch (error) {
							injectedFailures.push({
								state,
								name: error instanceof Error ? error.name : "unknown",
								message: String(error),
							});
							throw error;
						}
					};
					try {
						return await exporter.export();
					} finally {
						VideoEncoder.prototype.encode = encode;
					}
				},
			};
		},
	});
	const { result } = outcome;
	const report = {
		scenario: "encoder-recovery",
		factories,
		attempts,
		injectedFailures,
		capability: {
			softwareH264: softwareProbes.some((probe) => probe.supported),
			softwareProbes,
		},
		recovery: outcome.recovery,
		pipelineModel: outcome.pipelineModel,
		success: result.success,
		metrics: result.metrics,
	};
	if (!result.success || !result.blob)
		return {
			...report,
			recoveryFailure: result.error,
			noOutput: !result.blob && !result.tempFilePath,
		};
	return {
		...report,
		bytes: result.blob.size,
		output: await inspectMp4(result.blob),
		playback: await inspectPlayback(result.blob),
	};
}

async function exportVideo(scenario: ExportScenario) {
	if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined")
		throw new Error(
			"[WEBCODECS_UNAVAILABLE] This smoke requires real VideoEncoder and VideoDecoder APIs",
		);
	const size = { width: 320, height: 180, frameRate: 15, bitrate: 1_000_000 };
	const path = await resolveSupportedMp4EncoderPath(size);
	if (!path)
		throw new Error(
			"[H264_UNAVAILABLE] This browser has no H.264 encoder for 320 × 180 at 15 FPS",
		);
	const videoUrl = new URL("./fixtures/filmstrip.mp4", import.meta.url).href;
	const response = await fetch(videoUrl);
	if (!response.ok) throw new Error(`Filmstrip fixture could not load: ${response.status}`);
	const source = await inspectMp4(await response.blob());
	const progress: ExportProgress[] = [];
	const hasBlur =
		scenario !== "solid-mask" &&
		scenario !== "clean" &&
		scenario !== "renderer-recovery-clean" &&
		scenario !== "encoder-recovery";
	const effects =
		scenario === "solid-mask"
			? {
					zoomRegions: [],
					annotationRegions: [
						{
							id: "solid-mask",
							type: "blur" as const,
							startMs: 0,
							endMs: 6000,
							content: "",
							position: { x: 25, y: 25 },
							size: { width: 50, height: 50 },
							style: DEFAULT_ANNOTATION_STYLE,
							zIndex: 1,
							blurIntensity: 20,
							blurColor: "#000000",
						},
					],
				}
			: hasBlur
				? edgeBlurSettings()
				: { zoomRegions: [] };
	const config: VideoExporterConfig = {
		...size,
		videoUrl,
		backendPreference: "webcodecs",
		preferredEncoderPath: path,
		encodingMode: "balanced",
		wallpaper: "#101010",
		...effects,
		// At full 1.5× zoom the blur sampling regions intersect the right edge by
		// 0.25px and the bottom edge by 0.5px. Integer canvas sizing must retain them.
		...(hasBlur
			? { zoomClassicMode: true, previewWidth: size.width, previewHeight: size.height }
			: {}),
		showShadow: false,
		shadowIntensity: 0,
		backgroundBlur: 0,
		padding: 0,
		borderRadius: 0,
		cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		showCursor: false,
		onProgress: (update) => progress.push(update),
	};
	if (scenario === "encoder-recovery") return exportWithSoftwareRecovery(config);
	const factorySettings: Array<{
		route: Mp4ExportRoute;
		width: number;
		height: number;
		frameRate: number;
		bitrate: number;
		annotationRegions: VideoExporterConfig["annotationRegions"];
		zoomRegions: ZoomRegion[];
		zoomClassicMode: boolean | undefined;
	}> = [];
	const attempts: Array<{ route: Mp4ExportRoute; success: boolean; failureStage?: string }> = [];
	let recovery: Awaited<ReturnType<typeof exportMp4WithRecovery>>["recovery"] = null;
	let pipelineModel = "modern";
	let result;
	if (
		scenario === "renderer-recovery" ||
		scenario === "renderer-recovery-clean" ||
		scenario === "cancel-before-recovery"
	) {
		let cancelled = false;
		const outcome = await exportMp4WithRecovery({
			pipelineModel: "modern",
			config,
			isCancelled: () => cancelled,
			setActiveExporter: () => undefined,
			onAttemptResult: (route, attempt) => {
				attempts.push({
					route,
					success: attempt.success,
					failureStage: attempt.failureStage,
				});
				if (scenario === "cancel-before-recovery" && route === "modern") cancelled = true;
			},
			createExporter: async (route, attemptConfig) => {
				factorySettings.push({
					route,
					width: attemptConfig.width,
					height: attemptConfig.height,
					frameRate: attemptConfig.frameRate,
					bitrate: attemptConfig.bitrate,
					annotationRegions: attemptConfig.annotationRegions,
					zoomRegions: attemptConfig.zoomRegions,
					zoomClassicMode: attemptConfig.zoomClassicMode,
				});
				const exporter = await createMp4Exporter(route, attemptConfig);
				if (route !== "modern") return exporter;
				return {
					cancel: () => exporter.cancel(),
					export: async () => {
						const renderFrame = ModernFrameRenderer.prototype.renderFrame;
						// Fail only the modern compositor, after its real draw. The
						// recovery uses an unmodified legacy renderer and real encoders.
						ModernFrameRenderer.prototype.renderFrame = async function (...args) {
							await renderFrame.apply(this, args);
							throw new Error("Injected compositor recovery test failure");
						};
						try {
							return await exporter.export();
						} finally {
							ModernFrameRenderer.prototype.renderFrame = renderFrame;
						}
					},
				};
			},
		});
		result = outcome.result;
		recovery = outcome.recovery;
		pipelineModel = outcome.pipelineModel;
		if (scenario === "cancel-before-recovery") {
			return { scenario, cancelled: true, result, attempts, factorySettings, recovery };
		}
	} else {
		result = await new ModernVideoExporter(config).export();
	}
	if (!result.success || !result.blob)
		throw new Error(result.error || "The real exporter did not return an MP4 Blob");
	return {
		scenario,
		effects,
		attempts,
		factorySettings,
		recovery,
		pipelineModel,
		success: result.success,
		bytes: result.blob.size,
		mime: result.blob.type,
		source,
		output: await inspectMp4(result.blob),
		playback: await inspectPlayback(
			result.blob,
			scenario === "solid-mask"
				? Array.from({ length: 90 }, (_, index) => (index + 0.1) / 15)
				: hasBlur
					? [0.5, 2, 3.5, 5.5]
					: undefined,
		),
		metrics: result.metrics,
		progress,
	};
}

type Report = Awaited<ReturnType<typeof exportVideo>> | { error: string };
function Fixture() {
	const [working, setWorking] = useState(false);
	const [report, setReport] = useState<Report | null>(null);
	const runExport = async (scenario: ExportScenario) => {
		setWorking(true);
		setReport(null);
		try {
			setReport(await exportVideo(scenario));
		} catch (error) {
			setReport({ error: error instanceof Error ? error.message : String(error) });
		} finally {
			setWorking(false);
		}
	};
	return (
		<main>
			<button type="button" disabled={working} onClick={() => void runExport("solid-mask")}>
				Export solid mask MP4
			</button>
			<button type="button" disabled={working} onClick={() => void runExport("clean")}>
				Export real MP4
			</button>
			<button
				type="button"
				disabled={working}
				onClick={() => void runExport("zoomed-edge-blur")}
			>
				Export zoomed edge blur MP4
			</button>
			<button
				type="button"
				disabled={working}
				onClick={() => void runExport("renderer-recovery")}
			>
				Export with renderer recovery
			</button>
			<button
				type="button"
				disabled={working}
				onClick={() => void runExport("renderer-recovery-clean")}
			>
				Export clean with renderer recovery
			</button>
			<button
				type="button"
				disabled={working}
				onClick={() => void runExport("cancel-before-recovery")}
			>
				Cancel before renderer recovery
			</button>
			<button
				type="button"
				disabled={working}
				onClick={() => void runExport("encoder-recovery")}
			>
				Export with software encoder recovery
			</button>
			<pre id="result" data-state={working ? "working" : report ? "done" : "idle"}>
				{JSON.stringify(report)}
			</pre>
		</main>
	);
}
createRoot(document.getElementById("root")!).render(<Fixture />);
