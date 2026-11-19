import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { getPath: () => os.tmpdir() } }));
import { transcribeParakeetAudio } from "./parakeet";

// Opt-in real-model smoke. Normal unit runs require neither network nor model downloads.
const model = process.env.RECORDLY_PARAKEET_SMOKE_MODEL;
const sample = process.env.RECORDLY_PARAKEET_SMOKE_WAV;
it.skipIf(!model || !sample)(
	"transcribes real speech with measured timings across overlapping windows",
	async () => {
		const sherpa = createRequire(import.meta.url)("sherpa-onnx-node");
		const wave = sherpa.readWave(sample);
		expect(
			wave.sampleRate,
			"Smoke fixture must be PCM16 mono at 16 kHz (like the extraction pipeline)",
		).toBe(16000);
		const seconds = 66;
		const pcm = Buffer.alloc(seconds * 16000 * 2);
		for (const start of [27, 57]) {
			for (let i = 0; i < wave.samples.length; i++)
				pcm.writeInt16LE(
					Math.round(Math.max(-1, Math.min(1, wave.samples[i])) * 32767),
					(start * 16000 + i) * 2,
				);
		}
		const header = Buffer.alloc(44);
		header.write("RIFF");
		header.writeUInt32LE(pcm.length + 36, 4);
		header.write("WAVEfmt ", 8);
		header.writeUInt32LE(16, 16);
		header.writeUInt16LE(1, 20);
		header.writeUInt16LE(1, 22);
		header.writeUInt32LE(16000, 24);
		header.writeUInt32LE(32000, 28);
		header.writeUInt16LE(2, 32);
		header.writeUInt16LE(16, 34);
		header.write("data", 36);
		header.writeUInt32LE(pcm.length, 40);
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-parakeet-smoke-"));
		try {
			const wav = path.join(directory, "boundary.wav");
			await fs.writeFile(wav, Buffer.concat([header, pcm]));
			const baseline = await transcribeParakeetAudio(sample!, model!);
			let ticks = 0;
			const interval = setInterval(() => ticks++, 10);
			let cues;
			try {
				cues = await transcribeParakeetAudio(wav, model!);
			} finally {
				clearInterval(interval);
			}
			expect(ticks).toBeGreaterThan(5);
			const words = cues.flatMap((cue) => cue.words ?? []);
			const normalize = (text: string) => text.toLowerCase().replace(/\p{P}/gu, "");
			const expected = baseline
				.flatMap((cue) => cue.words ?? [])
				.map((word) => normalize(word.text));
			expect(words.map((word) => normalize(word.text))).toEqual([...expected, ...expected]);
			expect(words.every((word) => word.endMs > word.startMs)).toBe(true);
			// Acoustic estimates vary slightly with context; bound alignment error.
			expect(Math.abs(words[0].startMs - 27000)).toBeLessThanOrEqual(400);
			expect(words.some((word) => word.startMs >= 57000)).toBe(true);
		} finally {
			await fs.rm(directory, { recursive: true, force: true });
		}
	},
	120000,
);
