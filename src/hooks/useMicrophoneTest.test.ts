import { describe, expect, it, vi } from "vitest";
import {
	handleMicrophonePlaybackEnded,
	handleMicrophonePlaybackError,
	shouldAbortMicrophoneTestSession,
} from "./useMicrophoneTest";

describe("useMicrophoneTest helpers", () => {
	it("ignores stale playback failures", () => {
		const clearPlaybackAudio = vi.fn();
		const setError = vi.fn();
		const setStatus = vi.fn();
		const playbackAudio = {} as HTMLAudioElement;

		const handled = handleMicrophonePlaybackError({
			currentPlaybackAudio: null,
			playbackAudio,
			clearPlaybackAudio,
			setError,
			setStatus,
		});

		expect(handled).toBe(false);
		expect(clearPlaybackAudio).not.toHaveBeenCalled();
		expect(setError).not.toHaveBeenCalled();
		expect(setStatus).not.toHaveBeenCalled();
	});

	it("updates playback state for the active audio element", () => {
		const clearPlaybackAudio = vi.fn();
		const setError = vi.fn();
		const setStatus = vi.fn();
		const playbackAudio = {} as HTMLAudioElement;

		const handled = handleMicrophonePlaybackError({
			currentPlaybackAudio: playbackAudio,
			playbackAudio,
			clearPlaybackAudio,
			setError,
			setStatus,
		});

		expect(handled).toBe(true);
		expect(clearPlaybackAudio).toHaveBeenCalledTimes(1);
		expect(setError).toHaveBeenCalledWith("playback-failed");
		expect(setStatus).toHaveBeenCalledWith("error");
	});

	it("ignores stale playback end events", () => {
		const clearPlaybackAudio = vi.fn();
		const setStatus = vi.fn();
		const playbackAudio = {} as HTMLAudioElement;

		const handled = handleMicrophonePlaybackEnded({
			currentPlaybackAudio: {} as HTMLAudioElement,
			playbackAudio,
			clearPlaybackAudio,
			setStatus,
		});

		expect(handled).toBe(false);
		expect(clearPlaybackAudio).not.toHaveBeenCalled();
		expect(setStatus).not.toHaveBeenCalled();
	});

	it("aborts stale microphone sessions without touching the new recorder", () => {
		const stop = vi.fn();
		const stream = {
			getTracks: () => [{ stop }],
		} as unknown as MediaStream;
		const recorder = {} as MediaRecorder;

		const shouldAbort = shouldAbortMicrophoneTestSession({
			currentSession: 2,
			session: 1,
			currentRecorder: recorder,
			recorder,
			stream,
		});

		expect(shouldAbort).toBe(true);
		expect(stop).toHaveBeenCalledTimes(1);
	});

	it("continues active microphone sessions", () => {
		const stop = vi.fn();
		const stream = {
			getTracks: () => [{ stop }],
		} as unknown as MediaStream;
		const recorder = {} as MediaRecorder;

		const shouldAbort = shouldAbortMicrophoneTestSession({
			currentSession: 1,
			session: 1,
			currentRecorder: recorder,
			recorder,
			stream,
		});

		expect(shouldAbort).toBe(false);
		expect(stop).not.toHaveBeenCalled();
	});

	it("aborts stale stop events when the recorder identity changes", () => {
		const stop = vi.fn();
		const stream = {
			getTracks: () => [{ stop }],
		} as unknown as MediaStream;
		const recorder = {} as MediaRecorder;

		const shouldAbort = shouldAbortMicrophoneTestSession({
			currentSession: 1,
			session: 1,
			currentRecorder: {} as MediaRecorder,
			recorder,
			stream,
		});

		expect(shouldAbort).toBe(true);
		expect(stop).toHaveBeenCalledTimes(1);
	});
});
