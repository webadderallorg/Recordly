import { parseCaptureMetadata } from "../../../src/shared/iosCapture";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { RECORDING_SESSION_MANIFEST_SUFFIX } from "../constants";
import type { RecordingSessionData, RecordingSessionManifest } from "../types";
import { normalizeVideoSourcePath, parseJsonWithByteOrderMark } from "../utils";

function normalizeRecordingTimeOffsetMs(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

export function getRecordingSessionManifestPath(videoPath: string) {
	const extension = path.extname(videoPath);
	const baseName = path.basename(videoPath, extension);
	return path.join(path.dirname(videoPath), `${baseName}${RECORDING_SESSION_MANIFEST_SUFFIX}`);
}

export async function persistRecordingSessionManifest(
	session: RecordingSessionData,
): Promise<void> {
	const normalizedVideoPath = normalizeVideoSourcePath(session.videoPath);
	if (!normalizedVideoPath) {
		return;
	}

	const normalizedWebcamPath = normalizeVideoSourcePath(session.webcamPath ?? null);
	const manifestPath = getRecordingSessionManifestPath(normalizedVideoPath);

	const captureMetadata = normalizeCaptureMetadata(session.captureMetadata);
	if (!normalizedWebcamPath && !captureMetadata && !session.hideOverlayCursorByDefault) {
		await fs.rm(manifestPath, { force: true });
		return;
	}

	const manifest: RecordingSessionManifest = {
		version: captureMetadata || session.hideOverlayCursorByDefault ? 3 : 2,
		...(captureMetadata ? { captureMetadata } : {}),
		hideOverlayCursorByDefault: session.hideOverlayCursorByDefault,
		videoFileName: path.basename(normalizedVideoPath),
		webcamFileName:
			normalizedWebcamPath &&
			path.resolve(path.dirname(normalizedWebcamPath)) ===
				path.resolve(path.dirname(normalizedVideoPath))
				? path.basename(normalizedWebcamPath)
				: null,
		timeOffsetMs: normalizeRecordingTimeOffsetMs(session.timeOffsetMs),
	};

	const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`;
	try {
		await fs.writeFile(temporaryPath, JSON.stringify(manifest, null, 2), {
			encoding: "utf-8",
			flag: "wx",
			mode: 0o600,
		});
		await fs.rename(temporaryPath, manifestPath);
	} finally {
		await fs.rm(temporaryPath, { force: true });
	}
}

export async function resolveRecordingSessionManifest(
	videoPath?: string | null,
): Promise<RecordingSessionData | null> {
	const normalizedVideoPath = normalizeVideoSourcePath(videoPath);
	if (!normalizedVideoPath) {
		return null;
	}

	const manifestPath = getRecordingSessionManifestPath(normalizedVideoPath);

	try {
		const manifestStat = await fs.lstat(manifestPath);
		if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) return null;
		const content = await fs.readFile(manifestPath, "utf-8");
		const parsed = parseJsonWithByteOrderMark<Partial<RecordingSessionManifest>>(content);
		if (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3) {
			return null;
		}

		if (parsed.videoFileName !== path.basename(normalizedVideoPath)) return null;
		const provenance = {
			captureMetadata: normalizeCaptureMetadata(parsed.captureMetadata),
			hideOverlayCursorByDefault: parsed.hideOverlayCursorByDefault === true,
		};
		const webcamFileName =
			typeof parsed.webcamFileName === "string" && parsed.webcamFileName.trim()
				? parsed.webcamFileName.trim()
				: null;
		if (!webcamFileName) {
			return {
				videoPath: normalizedVideoPath,
				...provenance,
				webcamPath: null,
				timeOffsetMs: normalizeRecordingTimeOffsetMs(parsed.timeOffsetMs),
			};
		}

		const webcamPath = await resolveSessionLinkedFile(normalizedVideoPath, webcamFileName);

		return {
			videoPath: normalizedVideoPath,
			webcamPath,
			...provenance,
			timeOffsetMs: normalizeRecordingTimeOffsetMs(parsed.timeOffsetMs),
		};
	} catch {
		return null;
	}
}

export async function resolveLinkedWebcamPath(videoPath?: string | null): Promise<string | null> {
	const normalizedVideoPath = normalizeVideoSourcePath(videoPath);
	if (!normalizedVideoPath) {
		return null;
	}

	const extension = path.extname(normalizedVideoPath);
	const baseName = path.basename(normalizedVideoPath, extension);
	if (!baseName || baseName.endsWith("-webcam")) {
		return null;
	}

	const candidateExtensions = Array.from(
		new Set([extension, ".webm", ".mp4", ".mov", ".mkv", ".avi"].filter(Boolean)),
	);

	for (const candidateExtension of candidateExtensions) {
		const candidatePath = path.join(
			path.dirname(normalizedVideoPath),
			`${baseName}-webcam${candidateExtension}`,
		);

		try {
			await fs.access(candidatePath, fsConstants.F_OK);
			return candidatePath;
		} catch {
			continue;
		}
	}

	return null;
}

export async function resolveRecordingSession(
	videoPath?: string | null,
): Promise<RecordingSessionData | null> {
	const manifestSession = await resolveRecordingSessionManifest(videoPath);
	if (manifestSession) {
		return manifestSession;
	}

	const normalizedVideoPath = normalizeVideoSourcePath(videoPath);
	if (!normalizedVideoPath) {
		return null;
	}

	const linkedWebcamPath = await resolveLinkedWebcamPath(normalizedVideoPath);
	return {
		videoPath: normalizedVideoPath,
		webcamPath: linkedWebcamPath,
	};
}

async function resolveSessionLinkedFile(videoPath: string, name: string): Promise<string | null> {
	if (
		!name ||
		name !== path.basename(name) ||
		name.includes("\\") ||
		name === "." ||
		name === ".."
	)
		return null;
	try {
		const directory = await fs.realpath(path.dirname(videoPath));
		const linked = path.join(directory, name);
		const stat = await fs.lstat(linked);
		return stat.isFile() && !stat.isSymbolicLink() && (await fs.realpath(linked)) === linked
			? linked
			: null;
	} catch {
		return null;
	}
}

function normalizeCaptureMetadata(value: unknown) {
	try {
		return parseCaptureMetadata(value);
	} catch {
		return undefined;
	}
}
