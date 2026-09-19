import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ParakeetEngineAdapter } from "./engine";
import { segmentCuesIntoPhrases } from "./segment";
import { detectSilenceIntervals } from "./silence";
import { findExistingSherpaOnnxExecutable, resolveParakeetModelFiles } from "./parakeet";
import { PARAKEET_MODEL_DIR } from "../constants";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { probeAudioDuration } from "./chunking";

// Vitest hoisted mock setup so electron paths are dynamically resolved per platform
const { mockTempDir, mockUserDataDir } = await vi.hoisted(async () => {
	const nodeOs = await import("node:os");
	const nodePath = await import("node:path");
	const temp = nodeOs.tmpdir();
	const userData =
		process.platform === "win32"
			? nodePath.join(
					process.env["APPDATA"] || nodePath.join(nodeOs.homedir(), "AppData", "Roaming"),
					"Recordly-dev",
				)
			: nodePath.join(nodeOs.homedir(), ".config", "Recordly-dev");
	return { mockTempDir: temp, mockUserDataDir: userData };
});

vi.mock("electron", () => ({
	app: {
		isPackaged: false,
		getPath: vi.fn((name: string) => {
			if (name === "userData") return mockUserDataDir;
			if (name === "temp") return mockTempDir;
			return path.join(mockTempDir, "recordly-mock");
		}),
		getAppPath: vi.fn(() => process.cwd()),
	},
}));

describe("ParakeetEngineAdapter Long Audio Integration", () => {
	it("dynamically resolves runtime & model and transcribes long audio without ONNX broadcast mismatch", async () => {
		// Dynamically locate sherpa-onnx binary and Parakeet model on the current system
		const executablePath = await findExistingSherpaOnnxExecutable();
		let modelDir: string | null = null;
		try {
			const resolved = await resolveParakeetModelFiles(PARAKEET_MODEL_DIR);
			modelDir = resolved.modelDir;
		} catch {
			// Model directory not downloaded on this machine
		}

		if (!executablePath || !modelDir) {
			console.log(
				"[Parakeet Integration] Skipping live inference: sherpa-onnx runtime or model is not installed on this machine.",
			);
			return;
		}

		// Check for candidate recording files in user data
		const recordingsDir = path.join(mockUserDataDir, "recordings");
		let candidateWav: string | null = null;

		if (existsSync(recordingsDir)) {
			const entries = await fs.readdir(recordingsDir).catch(() => [] as string[]);
			for (const entry of entries) {
				if (entry.endsWith(".wav")) {
					const candidatePath = path.join(recordingsDir, entry);
					try {
						const dur = await probeAudioDuration(candidatePath);
						if (dur > 25) {
							candidateWav = candidatePath;
							break;
						}
					} catch {
						// Continue searching
					}
				}
			}
		}

		if (!candidateWav) {
			console.log(
				"[Parakeet Integration] No audio recording > 25s found in recordings folder. Skipping live multi-chunk inference.",
			);
			return;
		}

		const adapter = new ParakeetEngineAdapter();
		const result = await adapter.transcribe({
			videoPath: candidateWav,
			audioWavPath: candidateWav,
			executablePath,
			modelPath: modelDir,
		});

		expect(result.engine).toBe("parakeet");
		expect(result.cues.length).toBeGreaterThan(0);

		// Verify phrase segmentation on chunked results
		const ffmpegPath = getFfmpegBinaryPath();
		const silences = await detectSilenceIntervals({
			ffmpegPath,
			wavPath: candidateWav,
		}).catch(() => []);

		const phrases = segmentCuesIntoPhrases(result.cues, silences);
		expect(phrases.length).toBeGreaterThan(0);
		for (const phrase of phrases) {
			expect(phrase.text.trim().length).toBeGreaterThan(0);
			expect(phrase.endMs).toBeGreaterThan(phrase.startMs);
		}
	}, 180_000);
});
