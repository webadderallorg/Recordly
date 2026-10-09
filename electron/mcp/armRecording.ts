import type { WindowBounds } from "../ipc/types";
import type { waitForStillWindow } from "./screenshot";

export const ARM_DEFAULT_QUIET_MS = 1000;
export const ARM_DEFAULT_TIMEOUT_MS = 30_000;
export const ARM_MAX_TIMEOUT_MS = 120_000;

export type ArmDeps = {
	waitForStill: typeof waitForStillWindow;
	/** When the user's mouse or keyboard last did anything, in `now()` terms (0 = never). */
	lastInputAt: () => number;
	now: () => number;
	sleep: (ms: number) => Promise<void>;
};

export type ArmResult = { quiet: boolean; waitedMs: number; message?: string };

const finiteOr = (value: number | undefined, fallback: number) =>
	value === undefined || Number.isNaN(value) ? fallback : value;

export async function waitUntilQuiet(
	frame: WindowBounds,
	options: { quietMs?: number; timeoutMs?: number; signal?: AbortSignal },
	deps: ArmDeps,
): Promise<ArmResult> {
	const quietMs = Math.max(0, finiteOr(options.quietMs, ARM_DEFAULT_QUIET_MS));
	const timeoutMs = Math.min(
		Math.max(0, finiteOr(options.timeoutMs, ARM_DEFAULT_TIMEOUT_MS)),
		ARM_MAX_TIMEOUT_MS,
	);
	const started = deps.now();
	const deadline = started + timeoutMs;
	const timedOut = (): ArmResult => ({
		quiet: false,
		waitedMs: deps.now() - started,
		message: `The screen or the keyboard and mouse were not quiet for ${quietMs / 1000} s within ${timeoutMs / 1000} s, so no recording was started. Wait for the activity to stop, or start without arming.`,
	});
	for (;;) {
		options.signal?.throwIfAborted();
		const left = deadline - deps.now();
		if (left <= 0) return timedOut();
		const { settled } = await deps.waitForStill(frame, {
			timeoutMs: left,
			quietMs,
			signal: options.signal,
		});
		if (!settled) return timedOut();
		const sinceInput = deps.now() - deps.lastInputAt();
		if (sinceInput >= quietMs) return { quiet: true, waitedMs: deps.now() - started };
		await deps.sleep(Math.max(1, Math.min(quietMs - sinceInput, deadline - deps.now())));
	}
}
