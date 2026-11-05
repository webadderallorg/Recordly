import type { ChildProcessWithoutNullStreams } from "node:child_process";

export function waitForNativeCaptureCommand(
	process: ChildProcessWithoutNullStreams,
	marker: "Recording paused" | "Recording resumed" | "HUD capture filter updated",
) {
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error(`Timed out waiting for ScreenCaptureKit helper: ${marker}`));
		}, 5000);

		let stdoutBuffer = "";
		const onStdout = (chunk: Buffer) => {
			stdoutBuffer += chunk.toString();
			if (stdoutBuffer.includes(marker)) {
				cleanup();
				resolve();
			}
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		const onExit = (code: number | null) => {
			cleanup();
			reject(
				new Error(
					`Native capture helper exited before ${marker.toLowerCase()} (code ${code ?? "unknown"})`,
				),
			);
		};
		const cleanup = () => {
			clearTimeout(timer);
			process.stdout.off("data", onStdout);
			process.off("error", onError);
			process.off("exit", onExit);
		};

		process.stdout.on("data", onStdout);
		process.once("error", onError);
		process.once("exit", onExit);
	});
}
