import { afterEach, expect, it, vi } from "vitest";
import {
	cancelNativeVideoExportSession,
	cleanupNativeVideoExportSessions,
	nativeStaticLayoutExportSessions,
	nativeVideoExportSessions,
} from "./sessions";
import { removeTemporaryExportFile } from "./stream";
import type { NativeStaticLayoutExportSession, NativeVideoExportSession } from "./types";

vi.mock("./stream", () => ({ removeTemporaryExportFile: vi.fn(async () => undefined) }));

afterEach(() => {
	nativeVideoExportSessions.clear();
	nativeStaticLayoutExportSessions.clear();
	vi.clearAllMocks();
});

it("does not reap owned files until the encoder and mux settle, and waits for static cleanup", async () => {
	let encoderClosed!: () => void;
	let muxClosed!: (result: { outputPath: string }) => void;
	let staticCleaned!: () => void;
	const encoder = { kill: vi.fn(), stdin: { destroy: vi.fn(), destroyed: false } };
	const mux = { kill: vi.fn() };
	const staticProcess = { kill: vi.fn() };
	const streaming = {
		ffmpegProcess: encoder,
		currentProcess: mux,
		finalization: new Promise<{ outputPath: string }>((resolve) => {
			muxClosed = resolve;
		}),
		outputPath: "encoder-temp.mp4",
		completionPromise: new Promise<void>((resolve) => {
			encoderClosed = resolve;
		}),
		terminating: false,
	} as unknown as NativeVideoExportSession;
	const staticLayout = {
		currentProcess: staticProcess,
		cleanupComplete: new Promise<void>((resolve) => {
			staticCleaned = resolve;
		}),
		terminating: false,
	} as unknown as NativeStaticLayoutExportSession;
	nativeVideoExportSessions.set("stream", streaming);
	nativeStaticLayoutExportSessions.set("static", staticLayout);

	const cancelled = cancelNativeVideoExportSession("stream", streaming);
	expect(nativeVideoExportSessions.get("stream")).toBe(streaming);
	expect(cancelNativeVideoExportSession("stream", streaming)).toBe(cancelled);
	const finished = vi.fn();
	const cleanup = cleanupNativeVideoExportSessions()?.then(finished);
	expect(streaming.terminating).toBe(true);
	expect(staticLayout.terminating).toBe(true);
	expect(encoder.stdin.destroy).toHaveBeenCalledOnce();
	for (const process of [encoder, mux, staticProcess]) {
		expect(process.kill).toHaveBeenCalledWith("SIGKILL");
	}
	expect(removeTemporaryExportFile).not.toHaveBeenCalled();

	encoderClosed();
	await Promise.resolve();
	expect(removeTemporaryExportFile).not.toHaveBeenCalled();
	expect(nativeVideoExportSessions.get("stream")).toBe(streaming);
	muxClosed({ outputPath: "owned-muxed.mp4" });
	await vi.waitFor(() =>
		expect(vi.mocked(removeTemporaryExportFile).mock.calls).toEqual([
			["encoder-temp.mp4", true],
			["owned-muxed.mp4", true],
		]),
	);
	await cancelled;
	expect(nativeVideoExportSessions.has("stream")).toBe(false);
	expect(finished).not.toHaveBeenCalled();
	staticCleaned();
	await cleanup;
	expect(finished).toHaveBeenCalledOnce();
	expect(cleanupNativeVideoExportSessions()).toBeNull();
});
