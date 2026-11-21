import { execFile } from "node:child_process";
import path from "node:path";
import { removeTemporaryExportFile } from "./stream";
import type { NativeStaticLayoutExportSession, NativeVideoExportSession } from "./types";

export const nativeVideoExportSessions = new Map<string, NativeVideoExportSession>();

export function cleanupNativeVideoExportSessions() {
	const cleanup: Promise<unknown>[] = [];
	for (const session of nativeVideoExportSessions.values()) {
		session.terminating = true;
		try {
			if (!session.ffmpegProcess.stdin.destroyed) {
				session.ffmpegProcess.stdin.destroy();
			}
		} catch {
			/* stream may already be closed */
		}
		cleanup.push(
			(async () => {
				await Promise.all([
					stopProcess(session.ffmpegProcess),
					stopProcess(session.currentProcess),
					session.completionPromise.catch(() => undefined),
				]);
				const muxed = await session.finalization?.catch(() => undefined);
				await removeTemporaryExportFile(session.outputPath, true);
				if (muxed && muxed.outputPath !== session.outputPath) {
					await removeTemporaryExportFile(muxed.outputPath, true);
				}
			})(),
		);
	}
	nativeVideoExportSessions.clear();

	for (const session of nativeStaticLayoutExportSessions.values()) {
		session.terminating = true;
		cleanup.push(Promise.all([stopProcess(session.currentProcess), session.cleanupComplete]));
	}
	nativeStaticLayoutExportSessions.clear();

	return cleanup.length > 0 ? Promise.allSettled(cleanup) : null;
}

async function stopProcess(child: NativeStaticLayoutExportSession["currentProcess"] | undefined) {
	if (!child || typeof child.exitCode === "number" || child.signalCode) return;
	const systemRoot = process.env.SystemRoot;
	if (process.platform === "win32" && child.pid && systemRoot) {
		// Windows package-manager shims can leave the actual encoder running as a child.
		const stopped = await new Promise<boolean>((resolve) => {
			execFile(
				path.join(systemRoot, "System32", "taskkill.exe"),
				["/PID", String(child.pid), "/T", "/F"],
				{ windowsHide: true, timeout: 1500 },
				(error) => resolve(!error),
			);
		});
		if (stopped) return;
	}
	try {
		child.kill("SIGKILL");
	} catch {
		/* process may already be exited */
	}
}

export const nativeStaticLayoutExportSessions = new Map<string, NativeStaticLayoutExportSession>();
