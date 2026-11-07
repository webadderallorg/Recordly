import { spawn } from "node:child_process";
import path from "node:path";
import { app } from "electron";
import {
	buildNativeVideoExportArgs,
	getNativeVideoInputByteSize,
	getPreferredNativeVideoEncoders,
	type NativeExportEncodingMode,
	parseAvailableFfmpegEncoders,
} from "../../nativeVideoExport";
import { cachedNativeVideoEncoder, setCachedNativeVideoEncoder } from "../../state";
import { execFileAsync } from "./constants";
import { removeTemporaryExportFile } from "./stream";

export async function getAvailableNativeVideoEncoders(ffmpegPath: string) {
	const { stdout } = await execFileAsync(ffmpegPath, ["-hide_banner", "-encoders"], {
		timeout: 15000,
		maxBuffer: 20 * 1024 * 1024,
	});

	return parseAvailableFfmpegEncoders(stdout);
}

export async function probeNativeVideoEncoder(
	ffmpegPath: string,
	encoderName: string,
	encodingMode: NativeExportEncodingMode,
) {
	const outputPath = path.join(
		app.getPath("temp"),
		`recordly-export-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`,
	);
	const args = buildNativeVideoExportArgs(
		encoderName,
		{
			width: 64,
			height: 64,
			frameRate: 1,
			bitrate: 1_500_000,
			encodingMode,
		},
		outputPath,
	);

	return new Promise<boolean>((resolve) => {
		let process: ReturnType<typeof spawn>;
		try {
			process = spawn(ffmpegPath, args, { stdio: ["pipe", "ignore", "pipe"] });
		} catch {
			void removeTemporaryExportFile(outputPath);
			resolve(false);
			return;
		}
		let stderrOutput = "";
		let settled = false;
		let timeout: ReturnType<typeof setTimeout>;
		const finish = (success: boolean) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			void removeTemporaryExportFile(outputPath);
			resolve(success);
		};
		const fail = () => {
			if (settled) return;
			finish(false);
			try {
				process.kill("SIGKILL");
			} catch {
				// ignore
			}
		};
		timeout = setTimeout(fail, 15000);
		// Keep the handlers installed through shutdown: a failed probe can emit
		// another stream/process error while its child is being terminated.
		process.on("error", fail);
		process.stdin?.on("error", fail);

		process.stderr?.on("data", (chunk: Buffer) => {
			stderrOutput += chunk.toString();
		});

		process.on("close", (code) => {
			if (settled) void removeTemporaryExportFile(outputPath);
			if (code !== 0 && stderrOutput.trim().length > 0) {
				console.warn(
					`[native-export] Encoder probe failed for ${encoderName}:`,
					stderrOutput.trim(),
				);
			}
			finish(code === 0);
		});

		try {
			if (!process.stdin) fail();
			else process.stdin.end(Buffer.alloc(getNativeVideoInputByteSize(64, 64), 0));
		} catch {
			fail();
		}
	});
}

export async function resolveNativeVideoEncoder(
	ffmpegPath: string,
	encodingMode: NativeExportEncodingMode,
) {
	if (
		cachedNativeVideoEncoder?.ffmpegPath === ffmpegPath &&
		cachedNativeVideoEncoder?.encodingMode === encodingMode
	) {
		return cachedNativeVideoEncoder.encoderName;
	}

	const availableEncoders = await getAvailableNativeVideoEncoders(ffmpegPath);
	const candidates = [
		...new Set([...getPreferredNativeVideoEncoders(process.platform), "libx264"]),
	];

	for (const encoderName of candidates) {
		if (!availableEncoders.has(encoderName)) {
			continue;
		}

		if (await probeNativeVideoEncoder(ffmpegPath, encoderName, encodingMode)) {
			setCachedNativeVideoEncoder({ ffmpegPath, encodingMode, encoderName });
			return encoderName;
		}
	}

	throw new Error("No usable FFmpeg encoder was available for native export");
}
