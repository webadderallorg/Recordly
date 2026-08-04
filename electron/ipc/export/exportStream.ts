import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { app } from "electron";

type ExportStreamSession = {
	streamId: string;
	sessionDir: string;
	tempPath: string;
	fileHandle: fs.promises.FileHandle;
	bytesWritten: number;
	highestWatermark: number;
	writeQueue: Promise<void>;
	aborted: boolean;
};

const exportStreamSessions = new Map<string, ExportStreamSession>();

// Strict lowercase-alphanumeric allowlist. The charset (no dots, slashes,
// path separators, or uppercase) is the security control: it defeats path
// traversal and arbitrary extension injection. The length cap is generous
// enough for descriptive lossless payload extensions (e.g. "tiledrgba").
const EXTENSION_ALLOWLIST = /^[a-z0-9]{1,16}$/;
const SESSION_DIR_PREFIX = "recordly-export-";

// Paths that the export pipeline itself produced (stream temp files plus any
// successor temp files returned by main-process helpers such as
// muxNativeVideoExportAudio). Every renderer-facing handler that moves or
// deletes a path must assert membership here before touching disk, so a
// compromised renderer can never route arbitrary file paths into the IPC.
const ownedExportPaths = new Set<string>();

function normalizeOwnedPath(candidate: string): string {
	return path.resolve(candidate);
}

export function registerOwnedExportPath(candidate: string): void {
	ownedExportPaths.add(normalizeOwnedPath(candidate));
}

export function releaseOwnedExportPath(candidate: string): void {
	ownedExportPaths.delete(normalizeOwnedPath(candidate));
}

export function isOwnedExportPath(candidate: string): boolean {
	return ownedExportPaths.has(normalizeOwnedPath(candidate));
}

function generateStreamId() {
	return `recordly-export-stream-${randomUUID()}`;
}

export async function openExportStream(options?: { extension?: string }): Promise<{
	streamId: string;
	tempPath: string;
}> {
	const extension = options?.extension ?? "mp4";
	if (!EXTENSION_ALLOWLIST.test(extension)) {
		throw new Error(`Invalid export stream extension: ${extension}`);
	}
	const streamId = generateStreamId();

	// Per-session 0700 directory defeats TOCTOU/symlink races on shared
	// tempdirs (e.g. /tmp on Linux): only the current user can enter the dir,
	// so an adversary cannot pre-plant a symlink at the file path.
	const sessionDir = await fsp.mkdtemp(path.join(app.getPath("temp"), SESSION_DIR_PREFIX));
	try {
		await fsp.chmod(sessionDir, 0o700);
	} catch {
		// chmod is a defense-in-depth on platforms where mkdtemp already sets
		// a safe mode. Non-Linux filesystems may ignore mode bits entirely.
	}
	const tempPath = path.join(sessionDir, `${streamId}.${extension}`);
	const fileHandle = await fsp.open(
		tempPath,
		fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL,
		0o600,
	);

	exportStreamSessions.set(streamId, {
		streamId,
		sessionDir,
		tempPath,
		fileHandle,
		bytesWritten: 0,
		highestWatermark: 0,
		writeQueue: Promise.resolve(),
		aborted: false,
	});
	registerOwnedExportPath(tempPath);

	return { streamId, tempPath };
}

export async function writeToExportStream(
	streamId: string,
	position: number,
	chunk: Uint8Array,
): Promise<void> {
	const session = exportStreamSessions.get(streamId);
	if (!session) {
		throw new Error(`Export stream not found: ${streamId}`);
	}

	if (session.aborted) {
		throw new Error("Export stream was aborted");
	}

	// Serialize writes against the session to keep byte counters consistent when
	// the renderer issues concurrent chunks.
	const previous = session.writeQueue;
	const next = previous.then(async () => {
		if (session.aborted) {
			return;
		}
		const buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
		await session.fileHandle.write(buffer, 0, buffer.byteLength, position);
		session.bytesWritten += buffer.byteLength;
		const end = position + buffer.byteLength;
		if (end > session.highestWatermark) {
			session.highestWatermark = end;
		}
	});
	session.writeQueue = next.catch(() => undefined);
	await next;
}

export async function closeExportStream(
	streamId: string,
	options?: { abort?: boolean },
): Promise<{ tempPath: string | null; bytesWritten: number }> {
	const session = exportStreamSessions.get(streamId);
	if (!session) {
		throw new Error(`Export stream not found: ${streamId}`);
	}

	const abort = options?.abort === true;
	if (abort) {
		session.aborted = true;
	}

	try {
		await session.writeQueue;
	} catch {
		// Propagated to the in-flight write promise; closure proceeds regardless.
	}

	try {
		await session.fileHandle.close();
	} catch {
		// File handle may already be closed; ignore so abort paths stay best-effort.
	}

	exportStreamSessions.delete(streamId);

	if (abort) {
		releaseOwnedExportPath(session.tempPath);
		try {
			await fsp.rm(session.tempPath, { force: true });
		} catch {
			// Temp file may be gone already.
		}
		try {
			await fsp.rm(session.sessionDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
		// Aborted streams return `tempPath: null` so callers cannot accidentally
		// reuse a path that no longer references a file on disk (or, worse, a
		// path a later session may recycle).
		return { tempPath: null, bytesWritten: 0 };
	}

	return {
		tempPath: session.tempPath,
		bytesWritten: session.highestWatermark,
	};
}

export function hasExportStream(streamId: string): boolean {
	return exportStreamSessions.has(streamId);
}

export async function cleanupAllExportStreams(): Promise<void> {
	const sessions = Array.from(exportStreamSessions.values());
	exportStreamSessions.clear();
	ownedExportPaths.clear();
	await Promise.allSettled(
		sessions.map(async (session) => {
			try {
				await session.fileHandle.close();
			} catch {
				// ignore
			}
			try {
				await fsp.rm(session.tempPath, { force: true });
			} catch {
				// ignore
			}
			try {
				await fsp.rm(session.sessionDir, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}),
	);
}
