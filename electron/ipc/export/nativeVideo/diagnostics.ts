import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { type NvidiaCudaExportSummary, type WindowsGpuExportSummary } from "./types";

export function shouldPersistNativeExportDiagnostics() {
	const rawValue = process.env.RECORDLY_NATIVE_EXPORT_DIAGNOSTICS?.trim().toLowerCase();
	return rawValue !== "0" && rawValue !== "off" && rawValue !== "false";
}

export function shouldPersistNvidiaCudaExportDiagnostics() {
	return (
		shouldPersistNativeExportDiagnostics() ||
		process.env.RECORDLY_NVIDIA_CUDA_EXPORT_DIAGNOSTICS === "1"
	);
}

export function getSafeDiagnosticsFileSegment(value: string | undefined) {
	const safe = (value || "session").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 96);
	return safe || "session";
}

export function getCliArgValue(args: string[], name: string) {
	const index = args.indexOf(name);
	if (index === -1 || index + 1 >= args.length) {
		return null;
	}
	return args[index + 1] || null;
}

export async function persistNvidiaCudaExportDiagnostics(params: {
	args: string[];
	code: number | null;
	elapsedMs: number;
	outputPath: string;
	sessionId?: string;
	signal: NodeJS.Signals | null;
	startedAtIso: string;
	stderr: string;
	stdout: string;
	summary: NvidiaCudaExportSummary | null;
	timedOut: boolean;
}) {
	if (!shouldPersistNvidiaCudaExportDiagnostics()) {
		return;
	}

	const diagnosticsDirectory = path.join(app.getPath("userData"), "native-export-diagnostics");
	const filePrefix = `${Date.now()}-${getSafeDiagnosticsFileSegment(params.sessionId)}`;
	const manifest = {
		backend: "nvidia-cuda-compositor",
		startedAt: params.startedAtIso,
		completedAt: new Date().toISOString(),
		elapsedMs: Number(params.elapsedMs.toFixed(2)),
		sessionId: params.sessionId ?? null,
		outputPath: params.outputPath,
		exitCode: params.code,
		signal: params.signal,
		timedOut: params.timedOut,
		args: params.args,
		summary: params.summary,
	};

	try {
		await fs.mkdir(diagnosticsDirectory, { recursive: true });
		const artifactsDirectory = path.join(diagnosticsDirectory, `${filePrefix}.artifacts`);
		const artifactArgs = [
			"--cursor-json",
			"--cursor-atlas-png",
			"--cursor-atlas-metadata",
			"--zoom-telemetry",
		];
		const artifactCopies = artifactArgs
			.map((argName) => {
				const sourcePath = getCliArgValue(params.args, argName);
				return sourcePath
					? {
							argName,
							sourcePath,
							outputPath: path.join(
								artifactsDirectory,
								`${getSafeDiagnosticsFileSegment(argName.replace(/^--/, ""))}-${path.basename(sourcePath)}`,
							),
						}
					: null;
			})
			.filter((artifact): artifact is NonNullable<typeof artifact> => Boolean(artifact));
		await fs.mkdir(artifactsDirectory, { recursive: true }).catch(() => undefined);
		await Promise.allSettled([
			fs.writeFile(
				path.join(diagnosticsDirectory, `${filePrefix}.manifest.json`),
				`${JSON.stringify(manifest, null, 2)}\n`,
			),
			fs.writeFile(
				path.join(diagnosticsDirectory, `${filePrefix}.stdout.json`),
				params.stdout,
			),
			fs.writeFile(
				path.join(diagnosticsDirectory, `${filePrefix}.stderr.log`),
				params.stderr,
			),
			...artifactCopies.map((artifact) =>
				fs.copyFile(artifact.sourcePath, artifact.outputPath).catch(() => undefined),
			),
		]);
	} catch (error) {
		console.warn(
			"[native-static-layout-export] Failed to persist NVIDIA CUDA diagnostics",
			error,
		);
	}
}

export async function persistWindowsGpuExportDiagnostics(params: {
	args: string[];
	code: number | null;
	elapsedMs: number;
	outputPath: string;
	signal: NodeJS.Signals | null;
	startedAtIso: string;
	stderr: string;
	stdout: string;
	summary: WindowsGpuExportSummary | null;
	timedOut: boolean;
}) {
	if (!shouldPersistNativeExportDiagnostics()) {
		return;
	}

	const diagnosticsDirectory = path.join(app.getPath("userData"), "native-export-diagnostics");
	const filePrefix = `${Date.now()}-windows-d3d11-compositor`;
	const manifest = {
		backend: "windows-d3d11-compositor",
		startedAt: params.startedAtIso,
		completedAt: new Date().toISOString(),
		elapsedMs: Number(params.elapsedMs.toFixed(2)),
		outputPath: params.outputPath,
		exitCode: params.code,
		signal: params.signal,
		timedOut: params.timedOut,
		args: params.args,
		summary: params.summary,
	};

	try {
		await fs.mkdir(diagnosticsDirectory, { recursive: true });
		await Promise.allSettled([
			fs.writeFile(
				path.join(diagnosticsDirectory, `${filePrefix}.manifest.json`),
				`${JSON.stringify(manifest, null, 2)}\n`,
			),
			fs.writeFile(
				path.join(diagnosticsDirectory, `${filePrefix}.stdout.log`),
				params.stdout,
			),
			fs.writeFile(
				path.join(diagnosticsDirectory, `${filePrefix}.stderr.log`),
				params.stderr,
			),
		]);
	} catch (error) {
		console.warn(
			"[native-static-layout-export] Failed to persist Windows GPU diagnostics",
			error,
		);
	}
}
