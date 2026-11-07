import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";

type CommandMarker =
	| "Recording paused"
	| "Recording resumed"
	| "HUD capture filter updated"
	| `HUD capture filter updated ${string}`;
const stdinStates = new WeakMap<ChildProcessWithoutNullStreams, { error: Error | null }>();

/** Keep a listener for the pipe's lifetime, including errors emitted after helper exit. */
export function attachNativeCaptureStdinLifecycle(process: ChildProcessWithoutNullStreams) {
	let state = stdinStates.get(process);
	if (!state) {
		state = { error: null };
		stdinStates.set(process, state);
		const pipeState = state;
		process.stdin.on("error", (error: Error) => {
			pipeState.error ??= error;
		});
	}
	return state;
}

function observeNativeCaptureCommand(
	process: ChildProcessWithoutNullStreams,
	marker?: CommandMarker,
	command?: string,
) {
	const state = attachNativeCaptureStdinLifecycle(process);
	return new Promise<void>((resolve, reject) => {
		if (
			state.error ||
			process.stdin.destroyed ||
			process.stdin.writableEnded ||
			process.stdin.writable === false
		) {
			reject(state.error ?? new Error("Native capture helper command pipe is closed"));
			return;
		}
		let settled = false;
		let written = command === undefined;
		let applied = marker === undefined;
		const description = marker ?? "command write";
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (error) reject(error);
			else resolve();
		};
		const complete = () => {
			if (written && applied) finish();
		};
		const timer = setTimeout(
			() => finish(new Error(`Timed out waiting for native capture helper: ${description}`)),
			5000,
		);
		let stdoutBuffer = "";
		const onStdout = (chunk: Buffer) => {
			stdoutBuffer += chunk.toString();
			const acknowledged = marker?.startsWith("HUD capture filter updated ")
				? stdoutBuffer.split(/\r?\n/).slice(0, -1).includes(marker)
				: marker && stdoutBuffer.includes(marker);
			if (acknowledged) {
				applied = true;
				complete();
			}
		};
		const onError = (error: Error) => finish(error);
		const onExit = (code: number | null) =>
			finish(
				new Error(
					`Native capture helper exited before ${description.toLowerCase()} (code ${code ?? "unknown"})`,
				),
			);
		const cleanup = () => {
			clearTimeout(timer);
			process.stdout.off("data", onStdout);
			process.stdin.off("error", onError);
			process.off("error", onError);
			process.off("exit", onExit);
		};
		process.stdout.on("data", onStdout);
		process.stdin.once("error", onError);
		process.once("error", onError);
		process.once("exit", onExit);
		if (command !== undefined) {
			try {
				process.stdin.write(command, (error?: Error | null) => {
					if (error) {
						state.error ??= error;
						onError(error);
						return;
					}
					written = true;
					complete();
				});
			} catch (error) {
				onError(error instanceof Error ? error : new Error(String(error)));
			}
		}
	});
}

export function waitForNativeCaptureCommand(
	process: ChildProcessWithoutNullStreams,
	marker: CommandMarker,
) {
	return observeNativeCaptureCommand(process, marker);
}

/** Register acknowledgement/error listeners before writing, and settle synchronous failures too. */
export function sendNativeCaptureCommand(
	process: ChildProcessWithoutNullStreams,
	command: string,
	marker?: CommandMarker,
) {
	return observeNativeCaptureCommand(process, marker, command);
}

/** A late filter acknowledgement must never complete a subsequent settings update. */
export function sendNativeHudCaptureExclusions(
	process: ChildProcessWithoutNullStreams,
	processIds: number[],
) {
	const commandId = randomUUID();
	return sendNativeCaptureCommand(
		process,
		`hud-exclusions ${JSON.stringify({ commandId, processIds })}\n`,
		`HUD capture filter updated ${commandId}`,
	);
}
