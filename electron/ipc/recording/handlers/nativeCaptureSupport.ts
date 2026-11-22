import fs from "node:fs/promises";
import { shouldKeepRecordingAudioSidecars } from "../audioFilters";
import {
	type RecordingDiagnosticsSnapshot,
	writeRecordingDiagnosticsSnapshot,
} from "../diagnostics";

export async function writeWindowsRecordingDiagnostics(
	videoPath: string | null | undefined,
	snapshot: Omit<RecordingDiagnosticsSnapshot, "backend">,
) {
	if (!videoPath) {
		return null;
	}

	try {
		return await writeRecordingDiagnosticsSnapshot(videoPath, {
			backend: "windows-wgc",
			...snapshot,
		});
	} catch (error) {
		console.warn("Failed to write Windows recording diagnostics:", error);
		return null;
	}
}

export function normalizeDesktopSourceName(value: string) {
	return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function cleanupWindowsOrphanedMicAudioPath(filePath: string | null) {
	if (!filePath) {
		return;
	}

	if (shouldKeepRecordingAudioSidecars()) {
		console.log(`[recording] Keeping orphaned native mic sidecar for diagnostics: ${filePath}`);
		return;
	}

	await fs.rm(filePath, { force: true }).catch(() => undefined);
}

export async function pathExists(filePath: string | null | undefined) {
	if (!filePath) {
		return false;
	}

	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function resolveExistingPath(...candidates: Array<string | null | undefined>) {
	for (const candidate of candidates) {
		if (await pathExists(candidate)) {
			return candidate ?? null;
		}
	}

	return null;
}
