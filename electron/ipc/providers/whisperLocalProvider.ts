import { execFile, spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import { getBundledWhisperExecutableCandidates } from "../paths/binaries";
import { shouldRetryWhisperWithoutJson } from "../captions/parser";
import { readWhisperCaptionOutput } from "../captions/output";
import { isMissingWindowsWhisperRuntimeDependency } from "../captions/runtimeErrors";
import type { TranscriptionProvider, TranscriptionRequest, TranscriptionResult } from "./types";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// File & Binary Resolution Helpers
// ---------------------------------------------------------------------------

export async function ensureReadableFile(filePath: string, options?: { executable?: boolean }) {
	await fs.access(filePath, fsConstants.R_OK);
	if (options?.executable) {
		try {
			await fs.access(filePath, fsConstants.X_OK);
		} catch {
			throw new Error("The selected Whisper executable is not marked as executable.");
		}
	}
}

export async function isExecutableFile(filePath: string) {
	try {
		await fs.access(filePath, fsConstants.R_OK | fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

export async function resolveWhisperExecutablePath(preferredPath?: string | null) {
	const candidatePaths = [
		preferredPath?.trim() || null,
		...getBundledWhisperExecutableCandidates(),
		process.env["WHISPER_CPP_PATH"]?.trim() || null,
		process.platform === "darwin" ? "/opt/homebrew/bin/whisper-cli" : null,
		process.platform === "darwin" ? "/usr/local/bin/whisper-cli" : null,
		process.platform === "darwin" ? "/opt/homebrew/bin/whisper-cpp" : null,
		process.platform === "darwin" ? "/usr/local/bin/whisper-cpp" : null,
	].filter((value): value is string => Boolean(value));

	for (const candidate of candidatePaths) {
		const normalized = path.resolve(candidate);
		if (await isExecutableFile(normalized)) {
			return normalized;
		}
	}

	const pathCommand = process.platform === "win32" ? "where" : "which";
	const binaryNames =
		process.platform === "win32"
			? ["whisper-cli.exe", "whisper.exe", "main.exe"]
			: ["whisper-cli", "whisper-cpp", "whisper", "main"];

	for (const binaryName of binaryNames) {
		const result = spawnSync(pathCommand, [binaryName], { encoding: "utf-8" });
		if (result.status === 0) {
			const resolvedPath = result.stdout
				.split(/\r?\n/)
				.map((line) => line.trim())
				.find(Boolean);

			if (resolvedPath && (await isExecutableFile(resolvedPath))) {
				return resolvedPath;
			}
		}
	}

	throw new Error(
		`No Whisper runtime was found for ${process.platform}/${process.arch}. ` +
			"This Recordly build is missing its bundled caption runtime. Reinstall or update Recordly, or select a whisper-cli executable in Caption settings.",
	);
}

// ---------------------------------------------------------------------------
// Whisper Local Provider
// ---------------------------------------------------------------------------

/**
 * Wraps the existing local whisper-cli binary pipeline as a
 * `TranscriptionProvider`. This is the default provider and requires no API
 * key — it shells out to a bundled (or user-selected) whisper-cpp binary.
 */
export function createWhisperLocalProvider(options: {
	whisperExecutablePath?: string | null;
	whisperModelPath: string;
}): TranscriptionProvider {
	return {
		id: "whisper-local",
		label: "Whisper (Local)",
		requiresApiKey: false,

		async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
			const whisperExecutablePath = await resolveWhisperExecutablePath(
				options.whisperExecutablePath,
			);
			const whisperModelPath = path.resolve(options.whisperModelPath);
			await ensureReadableFile(whisperExecutablePath, { executable: true });
			await ensureReadableFile(whisperModelPath);

			const tempBase = path.join(
				app.getPath("temp"),
				`recordly-captions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			);
			const outputBase = `${tempBase}-whisper`;
			const srtPath = `${outputBase}.srt`;
			const jsonPath = `${outputBase}.json`;

			try {
				const language =
					request.language && request.language.trim() ? request.language.trim() : "auto";
				const whisperBaseArgs = [
					"-m",
					whisperModelPath,
					"-f",
					request.audioPath,
					"-osrt",
					"-of",
					outputBase,
					"-l",
					language,
					"-np",
					"-mc",
					"0",
				];

				let jsonEnabled = true;
				try {
					await executeWhisper(whisperExecutablePath, [...whisperBaseArgs, "-ojf"]);
				} catch (error) {
					if (!shouldRetryWhisperWithoutJson(error)) {
						throw error;
					}

					jsonEnabled = false;
					console.warn(
						"[whisper-local] Whisper runtime does not support JSON full output, retrying with SRT only:",
						error,
					);
					await executeWhisper(whisperExecutablePath, whisperBaseArgs);
				}

				const cues = await readWhisperCaptionOutput(outputBase, jsonEnabled);

				return {
					cues,
					supportsWordTimings: jsonEnabled && cues.some((c) => c.words && c.words.length > 0),
				};
			} finally {
				await Promise.allSettled([
					fs.rm(srtPath, { force: true }),
					fs.rm(jsonPath, { force: true }),
				]);
			}
		},
	};
}

async function executeWhisper(whisperExecutablePath: string, args: string[]) {
	try {
		await execFileAsync(whisperExecutablePath, args, {
			timeout: 30 * 60 * 1000,
			maxBuffer: 20 * 1024 * 1024,
		});
	} catch (error) {
		if (isMissingWindowsWhisperRuntimeDependency(error)) {
			throw new Error(
				"Whisper could not start because the Microsoft Visual C++ x64 Redistributable is missing. Install it from https://aka.ms/vc14/vc_redist.x64.exe, then restart Recordly.",
			);
		}
		throw error;
	}
}
