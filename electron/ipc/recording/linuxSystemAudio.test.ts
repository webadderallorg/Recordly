import { describe, expect, it, vi } from "vitest";
import {
	buildSystemAudioArgs,
	parseDefaultSinkName,
	parsePactlSourceNames,
	pickPulseCapableFfmpeg,
	resolveMonitorSourceName,
} from "./linuxSystemAudio";

describe("parseDefaultSinkName", () => {
	it("returns the sink name from pactl output", () => {
		expect(parseDefaultSinkName("alsa_output.pci-0000_00_1b.0.analog-stereo")).toBe(
			"alsa_output.pci-0000_00_1b.0.analog-stereo",
		);
	});

	it("returns null for empty output", () => {
		expect(parseDefaultSinkName("")).toBeNull();
		expect(parseDefaultSinkName("\n")).toBeNull();
	});
});

describe("parsePactlSourceNames", () => {
	it("extracts the name column from `pactl list short sources`", () => {
		const output = [
			"0\talsa_output.pci-0000_00_1b.0.analog-stereo.monitor\tmodule-alsa-card.c\ts16le\t2ch\t44100Hz\tRUNNING",
			"1\talsa_input.pci-0000_00_1b.0.analog-stereo\tmodule-alsa-card.c\ts16le\t2ch\t44100Hz\tIDLE",
			"",
		].join("\n");
		expect(parsePactlSourceNames(output)).toEqual([
			"alsa_output.pci-0000_00_1b.0.analog-stereo.monitor",
			"alsa_input.pci-0000_00_1b.0.analog-stereo",
		]);
	});
});

describe("resolveMonitorSourceName", () => {
	it("prefers the default sink's monitor", () => {
		expect(
			resolveMonitorSourceName(
				"alsa_output.pci-0000_00_1b.0.analog-stereo",
				[
					"alsa_output.pci-0000_00_1b.0.analog-stereo.monitor",
					"alsa_input.pci-0000_00_1b.0.analog-stereo",
				],
			),
		).toBe("alsa_output.pci-0000_00_1b.0.analog-stereo.monitor");
	});

	it("falls back to any monitor source", () => {
		expect(
			resolveMonitorSourceName("some-other-sink", [
				"alsa_input.mic",
				"alsa_output.monitor",
			]),
		).toBe("alsa_output.monitor");
	});

	it("returns null when no monitor exists", () => {
		expect(resolveMonitorSourceName("sink", ["alsa_input.mic"])).toBeNull();
	});
});

describe("buildSystemAudioArgs", () => {
	it("records 48 kHz stereo PCM from the given pulse source", () => {
		expect(buildSystemAudioArgs("@DEFAULT_MONITOR@", "/tmp/a.system.wav")).toEqual([
			"-y",
			"-hide_banner",
			"-f",
			"pulse",
			"-i",
			"@DEFAULT_MONITOR@",
			"-ac",
			"2",
			"-ar",
			"48000",
			"-c:a",
			"pcm_s16le",
			"/tmp/a.system.wav",
		]);
	});

	it("does not pass -nostdin, so the app can stop ffmpeg via stdin 'q'", () => {
		expect(buildSystemAudioArgs("@DEFAULT_MONITOR@", "/tmp/a.wav")).not.toContain(
			"-nostdin",
		);
	});
});

describe("pickPulseCapableFfmpeg", () => {
	it("falls back to the system ffmpeg when the bundled one lacks pulse", async () => {
		const support = vi.fn(async (ffmpegPath: string) => ffmpegPath === "/usr/bin/ffmpeg");
		await expect(
			pickPulseCapableFfmpeg(["/bundled/ffmpeg", "/usr/bin/ffmpeg"], support),
		).resolves.toBe("/usr/bin/ffmpeg");
		expect(support.mock.invocationCallOrder).toHaveLength(2);
	});

	it("prefers the bundled ffmpeg when it has pulse support", async () => {
		const support = vi.fn(async () => true);
		await expect(
			pickPulseCapableFfmpeg(["/bundled/ffmpeg", "/usr/bin/ffmpeg"], support),
		).resolves.toBe("/bundled/ffmpeg");
		expect(support).toHaveBeenCalledTimes(1);
	});

	it("skips null candidates and returns null when nothing supports pulse", async () => {
		const support = vi.fn(async () => false);
		await expect(
			pickPulseCapableFfmpeg([null, undefined, "/usr/bin/ffmpeg"], support),
		).resolves.toBeNull();
		expect(support).toHaveBeenCalledTimes(1);
	});

	it("probes duplicate paths only once", async () => {
		const support = vi.fn(async () => true);
		await expect(
			pickPulseCapableFfmpeg(["/usr/bin/ffmpeg", "/usr/bin/ffmpeg"], support),
		).resolves.toBe("/usr/bin/ffmpeg");
		expect(support).toHaveBeenCalledTimes(1);
	});
});
