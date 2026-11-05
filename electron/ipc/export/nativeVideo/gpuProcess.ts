import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { getFfprobeBinaryPath } from "../../ffmpeg/binary";
import {
	getNativeGpuCompositorStallTimeoutMs,
	getNvidiaCudaAutoStallTimeoutMs,
	isValidatedNvidiaCudaFallbackCandidate,
	resolveExperimentalNvidiaCudaExportScriptPath,
	resolveExperimentalNvidiaCudaNodeCommand,
	resolveExperimentalWindowsGpuExporterPath,
} from "./capabilities";
import { getNowMs } from "./constants";
import {
	persistNvidiaCudaExportDiagnostics,
	persistWindowsGpuExportDiagnostics,
} from "./diagnostics";
import {
	buildExperimentalNvidiaCudaStaticLayoutArgs,
	buildExperimentalWindowsGpuStaticLayoutArgs,
} from "./gpuArgs";
import {
	setNativeStaticLayoutExportProcessPriority,
	startNativeStaticLayoutExportPowerGuard,
} from "./process";
import {
	hasNativeStaticLayoutProgressAdvanced,
	mapNvidiaCudaWrapperProgressPercentage,
	parseWindowsGpuExportProgressLine,
} from "./progress";
import {
	type NativeStaticLayoutExportOptions,
	type NativeStaticLayoutExportProgress,
	type NativeStaticLayoutExportSession,
	type NvidiaCudaExportSummary,
	type WindowsGpuExportSummary,
} from "./types";
import { parseNvidiaCudaExportSummary, parseWindowsGpuExportSummary } from "./validation";

export async function runExperimentalNvidiaCudaStaticLayoutExport(
	ffmpegPath: string,
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
	chunkDirectory: string,
	session: NativeStaticLayoutExportSession,
	onProgress?: (progress: NativeStaticLayoutExportProgress) => void,
) {
	const scriptPath = await resolveExperimentalNvidiaCudaExportScriptPath();
	if (!scriptPath) {
		throw new Error("Experimental NVIDIA CUDA export script is not available");
	}

	const nodeCommand = resolveExperimentalNvidiaCudaNodeCommand();
	const workDir = path.join(chunkDirectory, "nvidia-cuda-work");
	const args = [
		scriptPath,
		...buildExperimentalNvidiaCudaStaticLayoutArgs(options, outputPath, workDir),
	];
	const startedAt = getNowMs();
	const startedAtIso = new Date().toISOString();
	const timeoutMs = Math.max(20 * 60 * 1000, options.durationSec * 2000);
	const stallTimeoutMs = getNvidiaCudaAutoStallTimeoutMs(
		isValidatedNvidiaCudaFallbackCandidate(options),
	);
	const ffmpegDirectory = path.dirname(ffmpegPath);
	const pathKey = process.platform === "win32" ? "Path" : "PATH";
	const env = {
		...process.env,
		...nodeCommand.env,
		RECORDLY_NVIDIA_CUDA_EXPORT_HIGH_PRIORITY:
			process.env.RECORDLY_NVIDIA_CUDA_EXPORT_HIGH_PRIORITY ?? "1",
		RECORDLY_FFMPEG_EXE: ffmpegPath,
		RECORDLY_FFPROBE_EXE: process.env.RECORDLY_FFPROBE_EXE ?? getFfprobeBinaryPath(),
		[pathKey]: `${ffmpegDirectory}${path.delimiter}${process.env[pathKey] ?? ""}`,
	};
	const powerGuard = startNativeStaticLayoutExportPowerGuard();

	return await new Promise<{
		elapsedMs: number;
		stdout: string;
		stderr: string;
		summary: NvidiaCudaExportSummary;
	}>((resolve, reject) => {
		const child = spawn(nodeCommand.command, args, {
			env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		const childPriorityApplied = setNativeStaticLayoutExportProcessPriority(
			child.pid,
			"NVIDIA CUDA export wrapper",
		);
		console.info("[native-static-layout-export] NVIDIA CUDA runtime guard started", {
			childPriorityApplied,
			powerGuardStarted: powerGuard.started,
		});
		session.currentProcess = child;
		if (session.terminating) {
			child.kill("SIGKILL");
		}

		let stdout = "";
		let stderr = "";
		let stderrLineBuffer = "";
		let lastProgressPercentage = 0;
		let lastProgressForStallGuard: {
			currentFrame: number;
			percentage: number;
			stage?: string;
		} = { currentFrame: -1, percentage: -1 };
		let stallTimedOut = false;
		let settled = false;
		const timeout = setTimeout(() => {
			if (settled) return;
			child.kill("SIGKILL");
		}, timeoutMs);
		let stallTimeout: ReturnType<typeof setTimeout> | null = null;
		const clearStallTimeout = () => {
			if (stallTimeout) {
				clearTimeout(stallTimeout);
				stallTimeout = null;
			}
		};
		const armStallTimeout = () => {
			if (!stallTimeoutMs) {
				return;
			}
			clearStallTimeout();
			stallTimeout = setTimeout(() => {
				if (settled) return;
				stallTimedOut = true;
				child.kill("SIGKILL");
			}, stallTimeoutMs);
		};
		armStallTimeout();

		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			stderr += text;
			stderrLineBuffer += text;
			const lines = stderrLineBuffer.split(/\r?\n/);
			stderrLineBuffer = lines.pop() ?? "";
			for (const line of lines) {
				const progress = parseWindowsGpuExportProgressLine(line);
				if (!progress) {
					continue;
				}
				const elapsedMs = Math.max(0, getNowMs() - startedAt);
				const averageFps =
					typeof progress.averageFps === "number" &&
					Number.isFinite(progress.averageFps) &&
					progress.averageFps > 0
						? progress.averageFps
						: elapsedMs > 0 && progress.currentFrame > 0
							? (progress.currentFrame * 1000) / elapsedMs
							: undefined;
				const mappedPercentage = mapNvidiaCudaWrapperProgressPercentage(progress);
				lastProgressPercentage = Math.max(lastProgressPercentage, mappedPercentage);
				const progressForStallGuard = {
					currentFrame: progress.currentFrame,
					percentage: mappedPercentage,
					stage: progress.stage,
				};
				if (
					hasNativeStaticLayoutProgressAdvanced(
						progressForStallGuard,
						lastProgressForStallGuard,
					)
				) {
					lastProgressForStallGuard = progressForStallGuard;
					armStallTimeout();
				}
				onProgress?.({
					...progress,
					percentage: lastProgressPercentage,
					sessionId: options.sessionId,
					backend: "nvidia-cuda-compositor",
					elapsedMs,
					averageFps,
				});
			}
		});
		child.once("error", (error) => {
			if (settled) return;
			settled = true;
			if (session.currentProcess === child) {
				session.currentProcess = null;
			}
			clearTimeout(timeout);
			clearStallTimeout();
			powerGuard.release();
			reject(error);
		});
		child.once("close", async (code, signal) => {
			if (settled) return;
			settled = true;
			if (session.currentProcess === child) {
				session.currentProcess = null;
			}
			clearTimeout(timeout);
			clearStallTimeout();
			powerGuard.release();

			if (session.terminating) {
				reject(new Error("Native static layout export was cancelled"));
				return;
			}

			const elapsedMs = getNowMs() - startedAt;
			const summary = parseNvidiaCudaExportSummary(stdout);
			if (summary) {
				summary.appRuntimeGuard = {
					powerGuardStarted: powerGuard.started,
					wrapperProcessPriorityBoosted: childPriorityApplied,
					nativeProcessPriorityBoosted: summary.nativeProcessPriorityBoosted,
				};
			}
			await Promise.allSettled([
				fs.writeFile(path.join(chunkDirectory, "nvidia-cuda-export.stdout.json"), stdout),
				fs.writeFile(path.join(chunkDirectory, "nvidia-cuda-export.stderr.log"), stderr),
				summary
					? fs.writeFile(
							path.join(chunkDirectory, "nvidia-cuda-export.summary.json"),
							`${JSON.stringify(summary, null, 2)}\n`,
						)
					: Promise.resolve(),
			]);
			await persistNvidiaCudaExportDiagnostics({
				args,
				code,
				elapsedMs,
				outputPath,
				sessionId: options.sessionId,
				signal,
				startedAtIso,
				stderr,
				stdout,
				summary,
				timedOut: stallTimedOut,
			});
			if (code !== 0 || !summary?.success) {
				const suffix = signal ? ` (signal ${signal})` : "";
				reject(
					new Error(
						(stallTimedOut && stallTimeoutMs
							? `Experimental NVIDIA CUDA exporter stalled for ${stallTimeoutMs}ms without progress`
							: stderr.trim()) ||
							stdout.trim() ||
							`Experimental NVIDIA CUDA exporter exited with code ${code ?? "unknown"}${suffix}`,
					),
				);
				return;
			}

			resolve({
				elapsedMs,
				stdout,
				stderr,
				summary,
			});
		});
	});
}

export async function runExperimentalWindowsGpuStaticLayoutExport(
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
	session: NativeStaticLayoutExportSession,
	onProgress?: (progress: NativeStaticLayoutExportProgress) => void,
) {
	const executablePath = await resolveExperimentalWindowsGpuExporterPath();
	if (!executablePath) {
		throw new Error("Experimental Windows GPU exporter is not built");
	}

	const args = buildExperimentalWindowsGpuStaticLayoutArgs(options, outputPath);
	const startedAt = getNowMs();
	const startedAtIso = new Date().toISOString();
	const timeoutMs = Math.max(15 * 60 * 1000, options.durationSec * 1000);
	const stallTimeoutMs = getNativeGpuCompositorStallTimeoutMs();

	return await new Promise<{
		elapsedMs: number;
		stdout: string;
		stderr: string;
		summary: WindowsGpuExportSummary;
	}>((resolve, reject) => {
		const child = spawn(executablePath, args, {
			stdio: ["ignore", "pipe", "pipe"],
		});
		session.currentProcess = child;
		if (session.terminating) {
			child.kill("SIGKILL");
		}

		let stdout = "";
		let stderr = "";
		let stderrLineBuffer = "";
		let lastProgressForStallGuard: {
			currentFrame: number;
			percentage: number;
			stage?: string;
		} = { currentFrame: -1, percentage: -1 };
		let stallTimedOut = false;
		let settled = false;
		const timeout = setTimeout(() => {
			if (settled) return;
			child.kill("SIGKILL");
		}, timeoutMs);
		let stallTimeout: ReturnType<typeof setTimeout> | null = null;
		const clearStallTimeout = () => {
			if (stallTimeout) {
				clearTimeout(stallTimeout);
				stallTimeout = null;
			}
		};
		const armStallTimeout = () => {
			if (!stallTimeoutMs) {
				return;
			}
			clearStallTimeout();
			stallTimeout = setTimeout(() => {
				if (settled) return;
				stallTimedOut = true;
				child.kill("SIGKILL");
			}, stallTimeoutMs);
		};
		armStallTimeout();

		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			stderr += text;
			stderrLineBuffer += text;
			const lines = stderrLineBuffer.split(/\r?\n/);
			stderrLineBuffer = lines.pop() ?? "";
			for (const line of lines) {
				const progress = parseWindowsGpuExportProgressLine(line);
				if (!progress) {
					continue;
				}
				if (hasNativeStaticLayoutProgressAdvanced(progress, lastProgressForStallGuard)) {
					lastProgressForStallGuard = {
						currentFrame: progress.currentFrame,
						percentage: progress.percentage,
						stage: progress.stage,
					};
					armStallTimeout();
				}
				const elapsedMs = Math.max(0, getNowMs() - startedAt);
				onProgress?.({
					...progress,
					sessionId: options.sessionId,
					backend: "windows-d3d11-compositor",
					elapsedMs,
					averageFps:
						elapsedMs > 0 && progress.currentFrame > 0
							? (progress.currentFrame * 1000) / elapsedMs
							: undefined,
				});
			}
		});
		child.once("error", (error) => {
			if (settled) return;
			settled = true;
			if (session.currentProcess === child) {
				session.currentProcess = null;
			}
			clearTimeout(timeout);
			clearStallTimeout();
			reject(error);
		});
		child.once("close", async (code, signal) => {
			if (settled) return;
			settled = true;
			if (session.currentProcess === child) {
				session.currentProcess = null;
			}
			clearTimeout(timeout);
			clearStallTimeout();

			if (session.terminating) {
				reject(new Error("Native static layout export was cancelled"));
				return;
			}

			const elapsedMs = getNowMs() - startedAt;
			const summary = parseWindowsGpuExportSummary(stdout);
			await persistWindowsGpuExportDiagnostics({
				args,
				code,
				elapsedMs,
				outputPath,
				signal,
				startedAtIso,
				stderr,
				stdout,
				summary,
				timedOut: stallTimedOut,
			});

			if (code !== 0 || !summary?.success) {
				const suffix = signal ? ` (signal ${signal})` : "";
				reject(
					new Error(
						(stallTimedOut && stallTimeoutMs
							? `Experimental Windows GPU exporter stalled for ${stallTimeoutMs}ms without progress`
							: stderr.trim()) ||
							stdout.trim() ||
							`Experimental Windows GPU exporter exited with code ${code ?? "unknown"}${suffix}`,
					),
				);
				return;
			}

			resolve({
				elapsedMs,
				stdout,
				stderr,
				summary,
			});
		});
	});
}
