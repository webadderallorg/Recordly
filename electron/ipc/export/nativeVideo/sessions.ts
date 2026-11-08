import { type NativeStaticLayoutExportSession, type NativeVideoExportSession } from "./types";

export const nativeVideoExportSessions = new Map<string, NativeVideoExportSession>();

export function cleanupNativeVideoExportSessions() {
	for (const [sessionId, session] of nativeVideoExportSessions) {
		session.terminating = true;
		try {
			if (!session.ffmpegProcess.stdin.destroyed) {
				session.ffmpegProcess.stdin.destroy();
			}
		} catch {
			/* stream may already be closed */
		}
		try {
			session.ffmpegProcess.kill("SIGKILL");
		} catch {
			/* process may already be exited */
		}
		nativeVideoExportSessions.delete(sessionId);
	}

	for (const [sessionId, session] of nativeStaticLayoutExportSessions) {
		session.terminating = true;
		try {
			session.currentProcess?.kill("SIGKILL");
		} catch {
			/* process may already be exited */
		}
		nativeStaticLayoutExportSessions.delete(sessionId);
	}
}

export const nativeStaticLayoutExportSessions = new Map<string, NativeStaticLayoutExportSession>();
