import type { ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import { resolveLinuxWindowBounds } from "../cursor/bounds";
import { ffmpegCaptureOutputBuffer } from "../state";
import type { SelectedSource } from "../types";
import { getScreen, parseWindowId } from "../utils";
import { resolveWindowsCaptureDisplay } from "../windowsCaptureSelection";

export function getDisplayBoundsForSource(source: SelectedSource) {
	return resolveWindowsCaptureDisplay(
		source,
		getScreen().getAllDisplays(),
		getScreen().getPrimaryDisplay(),
	).bounds;
}

export function getDisplayWorkAreaForSource(source: SelectedSource) {
	const allDisplays = getScreen().getAllDisplays();
	const primaryDisplay = getScreen().getPrimaryDisplay();
	const { displayId } = resolveWindowsCaptureDisplay(source, allDisplays, primaryDisplay);
	const matched = allDisplays.find((d) => d.id === displayId) ?? primaryDisplay;
	return matched.workArea;
}

export type LinuxCaptureEncoderOptions = {
	/** When set, encode on the GPU via VAAPI instead of libx264 on the CPU. */
	vaapi?: { devicePath: string } | null;
	/** When set, encode on the GPU via NVENC (NVIDIA) instead of libx264. */
	nvenc?: boolean | null;
};

/** bt709 color tagging plus a web-optimized moov — shared by every encoder tier. */
const COLOR_AND_MUX_FLAGS = [
	"-colorspace",
	"bt709",
	"-color_primaries",
	"bt709",
	"-color_trc",
	"bt709",
	"-color_range",
	"tv",
	"-movflags",
	"+faststart",
];

export async function buildFfmpegCaptureArgs(
	source: SelectedSource,
	outputPath: string,
	options?: LinuxCaptureEncoderOptions,
) {
	const buildOutputArgs = (inputRange: "auto" | "full", vfPrefix?: string, preset?: string) => [
		"-an",
		"-vf",
		`${vfPrefix ?? ""}scale=in_range=${inputRange}:out_range=tv:out_color_matrix=bt709:sws_dither=bayer`,
		"-c:v",
		"libx264",
		"-preset",
		preset ?? "veryfast",
		"-pix_fmt",
		"yuv420p",
		...COLOR_AND_MUX_FLAGS,
		outputPath,
	];
	const fullRangeOutputArgs = buildOutputArgs("full");

	if (process.platform === "win32") {
		if (source?.id?.startsWith("window:")) {
			const windowId = parseWindowId(source.id);
			const windowTitle =
				typeof source.windowTitle === "string"
					? source.windowTitle.trim()
					: source.name.trim();
			if (!windowId && !windowTitle) {
				throw new Error("Missing window identifier for FFmpeg window capture");
			}

			return [
				"-y",
				"-f",
				"gdigrab",
				"-framerate",
				"60",
				"-draw_mouse",
				"0",
				"-i",
				windowId ? `hwnd=${windowId}` : `title=${windowTitle}`,
				...fullRangeOutputArgs,
			];
		}

		return [
			"-y",
			"-f",
			"gdigrab",
			"-framerate",
			"60",
			"-draw_mouse",
			"0",
			"-i",
			"desktop",
			...fullRangeOutputArgs,
		];
	}

	if (process.platform === "linux") {
		const displayEnv = process.env.DISPLAY || ":0.0";
		// showinfo logs each frame as it enters the filter chain — i.e. at grab
		// time, before the encoder pipeline delays the muxed output. The cursor
		// clock's startup calibration reads its first line for the video's true
		// first-frame instant (see calibrateLinuxCursorStartupFromFilterLog).
		if (options?.vaapi?.devicePath) {
			// GPU encode (h264_vaapi): the CPU stays free, so full 60fps holds up
			// even under desktop load (59.1/60 grabs/s, pts drift 0.01s measured
			// where libx264 veryfast collapsed to 17/60 and drifted >1s).
			// CQP QP24 via -compression_level: constant-quality, no bitrate math;
			// static screen content lands well under 1 Mbps.
			const vaapiOutputArgs = [
				"-an",
				"-vf",
				"showinfo,scale=in_range=full:out_range=tv:out_color_matrix=bt709:sws_dither=bayer,format=nv12,hwupload",
				"-vaapi_device",
				options.vaapi.devicePath,
				"-c:v",
				"h264_vaapi",
				"-rc_mode",
				"CQP",
				"-compression_level",
				"24",
				...COLOR_AND_MUX_FLAGS,
				outputPath,
			];
			const inputArgs = await buildLinuxX11grabInputArgs(source, displayEnv);
			return [...inputArgs, ...vaapiOutputArgs];
		}
		if (options?.nvenc) {
			// GPU encode (h264_nvenc) for NVIDIA machines — same rationale as the
			// VAAPI tier: the CPU stays free, so full 60fps holds up under
			// desktop load. NVENC uploads frames from system memory itself (no
			// hwupload/-vaapi_device dance); constqp QP24 is constant-quality
			// with no bitrate math, like CQP on the VAAPI side.
			const nvencOutputArgs = [
				"-an",
				"-vf",
				"showinfo,scale=in_range=full:out_range=tv:out_color_matrix=bt709:sws_dither=bayer,format=yuv420p",
				"-c:v",
				"h264_nvenc",
				"-preset",
				"p4",
				"-rc",
				"constqp",
				"-qp",
				"24",
				...COLOR_AND_MUX_FLAGS,
				outputPath,
			];
			const inputArgs = await buildLinuxX11grabInputArgs(source, displayEnv);
			return [...inputArgs, ...nvencOutputArgs];
		}
		const linuxOutputArgs = buildOutputArgs("full", "showinfo,", "ultrafast");
		// CPU fallback tier: 30fps + ultrafast is deliberate. Encoding on the
		// CPU while the desktop keeps running, 1080p60 veryfast starves x11grab
		// (only ~17/60 grabs/s measured) and x11grab's schedule-based pts drifts
		// >1s behind real grab time — the recorded screen visibly lags its own
		// input. 30fps ultrafast keeps up (30.1/30, drift ≈ 0). The cursor
		// overlay stays smooth regardless: it renders from telemetry, not video.
		const inputArgs = await buildLinuxX11grabInputArgs(source, displayEnv, 30);
		return [...inputArgs, ...linuxOutputArgs];
	}

	if (process.platform === "darwin") {
		return [
			"-y",
			"-f",
			"avfoundation",
			"-capture_cursor",
			"0",
			"-framerate",
			"60",
			"-i",
			"1:none",
			...buildOutputArgs("auto"),
		];
	}

	throw new Error(`FFmpeg capture is not supported on ${process.platform}`);
}

/** The x11grab input half of the Linux capture args (display region + rate). */
async function buildLinuxX11grabInputArgs(
	source: SelectedSource,
	displayEnv: string,
	framerate = 60,
): Promise<string[]> {
	let bounds: { x: number; y: number; width: number; height: number };
	if (source?.id?.startsWith("window:")) {
		const windowBounds = await resolveLinuxWindowBounds(source);
		if (!windowBounds) {
			throw new Error("Unable to resolve Linux window bounds for FFmpeg capture");
		}
		bounds = windowBounds;
	} else {
		bounds = getDisplayBoundsForSource(source);
	}

	return [
		"-y",
		"-f",
		"x11grab",
		"-framerate",
		String(framerate),
		"-draw_mouse",
		"0",
		"-video_size",
		`${Math.max(2, bounds.width)}x${Math.max(2, bounds.height)}`,
		"-i",
		`${displayEnv}+${Math.round(bounds.x)},${Math.round(bounds.y)}`,
	];
}

export function waitForFfmpegCaptureStart(process: ChildProcessWithoutNullStreams) {
	return new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		const onExit = (code: number | null) => {
			cleanup();
			reject(
				new Error(
					ffmpegCaptureOutputBuffer.trim() ||
						`FFmpeg exited before recording started (code ${code ?? "unknown"})`,
				),
			);
		};

		const timer = setTimeout(() => {
			cleanup();
			resolve();
		}, 900);

		const cleanup = () => {
			clearTimeout(timer);
			process.off("error", onError);
			process.off("exit", onExit);
		};

		process.once("error", onError);
		process.once("exit", onExit);
	});
}

export function waitForFfmpegCaptureStop(
	process: ChildProcessWithoutNullStreams,
	outputPath: string,
) {
	return new Promise<string>((resolve, reject) => {
		const onClose = async (code: number | null) => {
			cleanup();

			try {
				await fs.access(outputPath);
				if (code === 0 || code === null) {
					resolve(outputPath);
					return;
				}

				if (ffmpegCaptureOutputBuffer.includes("Exiting normally")) {
					resolve(outputPath);
					return;
				}
			} catch {
				// handled below
			}

			reject(
				new Error(
					ffmpegCaptureOutputBuffer.trim() ||
						`FFmpeg exited with code ${code ?? "unknown"}`,
				),
			);
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		const cleanup = () => {
			process.off("close", onClose);
			process.off("error", onError);
		};

		process.once("close", onClose);
		process.once("error", onError);
	});
}
