import { describe, expect, it } from "vitest";
import {
	formatSubtitleTimestamp,
	serializeCaptionsAsSrt,
	serializeCaptionsAsWebVtt,
} from "./subtitleExport";
import type { CaptionCue } from "./types";

describe("subtitle export", () => {
	const cues: CaptionCue[] = [
		{ id: "b", startMs: 2400, endMs: 3800, text: " second cue " },
		{ id: "a", startMs: 100, endMs: 1234, text: "First   cue" },
	];

	it("formats SRT and WebVTT timestamps", () => {
		expect(formatSubtitleTimestamp(3_661_234, "srt")).toBe("01:01:01,234");
		expect(formatSubtitleTimestamp(3_661_234, "vtt")).toBe("01:01:01.234");
	});

	it("serializes captions as ordered SRT cues", () => {
		expect(serializeCaptionsAsSrt(cues)).toBe(
			"1\n00:00:00,100 --> 00:00:01,234\nFirst cue\n\n2\n00:00:02,400 --> 00:00:03,800\nsecond cue",
		);
	});

	it("serializes captions as WebVTT", () => {
		expect(serializeCaptionsAsWebVtt(cues)).toBe(
			"WEBVTT\n\n00:00:00.100 --> 00:00:01.234\nFirst cue\n\n00:00:02.400 --> 00:00:03.800\nsecond cue\n",
		);
	});

	it("skips empty or zero-length cues", () => {
		expect(
			serializeCaptionsAsSrt([
				{ id: "empty", startMs: 0, endMs: 1000, text: " " },
				{ id: "zero", startMs: 1000, endMs: 1000, text: "no duration" },
			]),
		).toBe("");
	});
});
