import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	attachNativeCaptureStdinLifecycle,
	sendNativeCaptureCommand,
	waitForNativeCaptureCommand,
} from "./nativeCaptureCommand";

function helper() {
	return Object.assign(new EventEmitter(), {
		stdin: new PassThrough(),
		stdout: new PassThrough(),
	}) as unknown as ChildProcessWithoutNullStreams;
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});
it("registers acknowledgement before writing and waits for the write callback", async () => {
	const child = helper();
	let written!: (error?: Error | null) => void;
	vi.spyOn(child.stdin, "write").mockImplementation((_chunk, callback) => {
		child.stdout.emit("data", Buffer.from("Recording paused"));
		written = callback as typeof written;
		return true;
	});
	let completed = false;
	const command = sendNativeCaptureCommand(child, "pause\n", "Recording paused").then(() => {
		completed = true;
	});
	await Promise.resolve();
	expect(completed).toBe(false);
	written();
	await command;
	expect(vi.getTimerCount()).toBe(0);
	expect(child.stdout.listenerCount("data")).toBe(0);
	expect(child.listenerCount("exit")).toBe(0);
	expect(child.stdin.listenerCount("error")).toBe(1);
});
it.each([
	"throw",
	"callback",
	"event",
] as const)("rejects a %s write failure, clears waiters and tolerates late EPIPE", async (mode) => {
	const child = helper();
	const failure = new Error("synthetic EPIPE");
	vi.spyOn(child.stdin, "write").mockImplementation((_chunk, callback) => {
		if (mode === "throw") throw failure;
		queueMicrotask(() => {
			if (mode === "callback") (callback as (error: Error) => void)(failure);
			else child.stdin.emit("error", failure);
		});
		return true;
	});
	const command = sendNativeCaptureCommand(child, "pause\n", "Recording paused");
	const rejected = expect(command).rejects.toBe(failure);
	await vi.runAllTicks();
	await rejected;
	expect(vi.getTimerCount()).toBe(0);
	expect(child.stdout.listenerCount("data")).toBe(0);
	expect(child.listenerCount("error")).toBe(0);
	child.emit("exit", 1);
	expect(() => child.stdin.emit("error", new Error("late EPIPE"))).not.toThrow();
});
it("rejects pending command acknowledgement on a pipe error", async () => {
	const child = helper();
	const command = waitForNativeCaptureCommand(child, "HUD capture filter updated");
	const failure = new Error("pipe closed");
	child.stdin.emit("error", failure);
	await expect(command).rejects.toBe(failure);
	expect(vi.getTimerCount()).toBe(0);
});
it("rejects later writes after an idle pipe failure without reopening or adding listeners", async () => {
	const child = helper();
	attachNativeCaptureStdinLifecycle(child);
	attachNativeCaptureStdinLifecycle(child);
	const failure = new Error("idle EPIPE");
	child.stdin.emit("error", failure);
	const write = vi.spyOn(child.stdin, "write");
	await expect(sendNativeCaptureCommand(child, "resume\n")).rejects.toBe(failure);
	expect(write).not.toHaveBeenCalled();
	expect(child.stdin.listenerCount("error")).toBe(1);
});
it("waits for Windows write completion and propagates its callback failure", async () => {
	const child = helper();
	await expect(sendNativeCaptureCommand(child, "pause\n")).resolves.toBeUndefined();
	const failure = new Error("Windows pipe closed");
	vi.spyOn(child.stdin, "write").mockImplementation((_chunk, callback) => {
		(callback as (error: Error) => void)(failure);
		return false;
	});
	await expect(sendNativeCaptureCommand(child, "resume\n")).rejects.toBe(failure);
});
it.each([
	"exit",
	"timeout",
] as const)("settles %s without leaving acknowledgement listeners", async (mode) => {
	const child = helper();
	const command = sendNativeCaptureCommand(child, "pause\n", "Recording paused");
	const rejected = expect(command).rejects.toThrow(mode === "exit" ? "exited" : "Timed out");
	if (mode === "exit") child.emit("exit", 1);
	else await vi.advanceTimersByTimeAsync(5000);
	await rejected;
	expect(child.stdout.listenerCount("data")).toBe(0);
	expect(child.listenerCount("exit")).toBe(0);
	expect(vi.getTimerCount()).toBe(0);
});
