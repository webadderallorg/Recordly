import { execFile } from "node:child_process";
import path from "node:path";
import { removeTemporaryExportFile } from "./stream";
import type { NativeStaticLayoutExportSession, NativeVideoExportSession } from "./types";

export const nativeVideoExportSessions = new Map<string, NativeVideoExportSession>();

export function cancelNativeVideoExportSession(
	sessionId: string,
	session: NativeVideoExportSession,
) {
	if (session.cancellation) return session.cancellation;

	session.terminating = true;
	try {
		const stdin = session.ffmpegProcess.stdin;
		if (!stdin.destroyed && !stdin.writableEnded) {
			stdin.destroy();
		}
	} catch {
		/* stream may already be closed */
	}
	session.cancellation = (async () => {
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
	})().finally(() => {
		nativeVideoExportSessions.delete(sessionId);
	});
	return session.cancellation;
}

export function cleanupNativeVideoExportSessions() {
	const cleanup: Promise<unknown>[] = [];
	for (const [sessionId, session] of nativeVideoExportSessions) {
		cleanup.push(cancelNativeVideoExportSession(sessionId, session));
	}

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
