import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseNativeCaptureResult } from "../../../../src/shared/iosCapture";
import type {
	IOSAudioFormat,
	IOSSessionId,
	NativeCaptureResult,
	IOSVideoFormat,
	IOSCaptureMode,
} from "../../../../src/shared/iosCapture";
export interface IOSSessionStorage {
	sessionId: IOSSessionId;
	directory: string;
	journalPath: string;
}
export interface IOSCaptureJournal {
	version: 1;
	sessionId: IOSSessionId;
	createdAt: string;
	state:
		| "allocated"
		| "starting"
		| "recording"
		| "stopping"
		| "interrupted"
		| "finalising"
		| "renamed"
		| "committed"
		| "failed";
	format?: IOSVideoFormat;
	mode?: IOSCaptureMode;
	nativeResult?: NativeCaptureResult;
	outputAudio?: IOSAudioFormat;
	committedFile?: "recording.mov" | "source-video.mov";
}
export const IOS_SESSION_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const IOS_ARTIFACT_NAMES = [
	"capture-journal.json",
	"native-timing.json",
	"source-video.mov",
	"device-audio.mov",
	"microphone.mov",
	"recording.pending.mov",
	"recording.mov",
	"diagnostics.json",
] as const;
export async function availableIOSStorageBytes(directory: string): Promise<number> {
	const s = await fs.statfs(directory, { bigint: true });
	const bytes = s.bavail * s.bsize;
	return Number(
		bytes > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : bytes,
	);
}
export function checkIOSStorageCapacity(input: {
	availableBytes: number;
	videoBytes: number;
	observedBytes: number;
	elapsedMs: number;
	mixing: boolean;
}): boolean {
	const { availableBytes, videoBytes, observedBytes, elapsedMs, mixing } = input;
	if (
		![availableBytes, videoBytes, observedBytes, elapsedMs].every(
			(n) => Number.isFinite(n) && n >= 0,
		)
	)
		return false;
	const rate = elapsedMs > 0 ? observedBytes / (elapsedMs / 1000) : 0;
	return availableBytes >= 256 * 1024 ** 2 + rate * 60 + (mixing ? videoBytes : 0);
}
export async function validateIOSStorage(storage: IOSSessionStorage): Promise<void> {
	if (
		!IOS_SESSION_UUID.test(storage.sessionId) ||
		path.basename(storage.directory) !== `ios-${storage.sessionId}` ||
		storage.journalPath !== path.join(storage.directory, "capture-journal.json")
	)
		throw new Error("INVALID_SESSION_STORAGE");
	const st = await fs.lstat(storage.directory);
	if (
		!st.isDirectory() ||
		st.isSymbolicLink() ||
		(await fs.realpath(storage.directory)) !== path.resolve(storage.directory)
	)
		throw new Error("UNSAFE_SESSION_PATH");
}
export async function resolveIOSArtifact(
	storage: IOSSessionStorage,
	name: string,
	allowMissing = false,
): Promise<string> {
	await validateIOSStorage(storage);
	if (!(IOS_ARTIFACT_NAMES as readonly string[]).includes(name))
		throw new Error("INVALID_ARTIFACT_NAME");
	const p = path.join(storage.directory, name);
	try {
		const st = await fs.lstat(p);
		if (!st.isFile() || st.isSymbolicLink() || (await fs.realpath(p)) !== p)
			throw new Error("UNSAFE_ARTIFACT");
	} catch (e) {
		if (!(allowMissing && (e as NodeJS.ErrnoException).code === "ENOENT")) throw e;
	}
	return p;
}
export async function allocateIOSSessionStorage(
	root: string,
	sessionId: IOSSessionId,
	deps: { availableBytes?: (directory: string) => Promise<number> } = {},
): Promise<IOSSessionStorage> {
	if (!IOS_SESSION_UUID.test(sessionId) || !path.isAbsolute(root))
		throw new Error("INVALID_SESSION_STORAGE");
	const st = await fs.lstat(root);
	if (
		!st.isDirectory() ||
		st.isSymbolicLink() ||
		(await fs.realpath(root)) !== path.resolve(root)
	)
		throw new Error("UNSAFE_RECORDINGS_ROOT");
	await fs.access(root, constants.W_OK);
	if ((await (deps.availableBytes ?? availableIOSStorageBytes)(root)) < 1024 ** 3)
		throw new Error("DISK_SPACE_LOW");
	const directory = path.join(root, `ios-${sessionId}`);
	await fs.mkdir(directory, { mode: 0o700 });
	const storage = {
		sessionId,
		directory,
		journalPath: path.join(directory, "capture-journal.json"),
	};
	await writeIOSJournal(storage, {
		version: 1,
		sessionId,
		createdAt: new Date().toISOString(),
		state: "allocated",
	});
	return storage;
}
async function writeIOSJournal(
	storage: IOSSessionStorage,
	journal: IOSCaptureJournal,
): Promise<void> {
	await resolveIOSArtifact(storage, "capture-journal.json", true);
	const temporary = path.join(storage.directory, `.journal-${randomUUID()}.tmp`);
	try {
		const file = await fs.open(temporary, "wx", 0o600);
		try {
			await file.writeFile(JSON.stringify(journal));
			await file.sync();
		} finally {
			await file.close();
		}
		await fs.rename(temporary, storage.journalPath);
		const directory = await fs.open(storage.directory, "r");
		try {
			await directory.sync();
		} finally {
			await directory.close();
		}
	} finally {
		await fs.rm(temporary, { force: true });
	}
}
export async function readIOSJournal(storage: IOSSessionStorage): Promise<IOSCaptureJournal> {
	const journal = JSON.parse(
		await fs.readFile(await resolveIOSArtifact(storage, "capture-journal.json"), "utf8"),
	) as IOSCaptureJournal;
	const states = [
		"allocated",
		"starting",
		"recording",
		"stopping",
		"interrupted",
		"finalising",
		"renamed",
		"committed",
		"failed",
	];
	if (
		journal.version !== 1 ||
		journal.sessionId !== storage.sessionId ||
		!states.includes(journal.state) ||
		typeof journal.createdAt !== "string"
	)
		throw new Error("INVALID_JOURNAL");
	if (
		journal.committedFile !== undefined &&
		!["recording.mov", "source-video.mov"].includes(journal.committedFile)
	)
		throw new Error("INVALID_JOURNAL");
	return journal;
}
const journalWrites = new Map<string, Promise<void>>();
export async function updateIOSJournal(
	storage: IOSSessionStorage,
	patch: Partial<Omit<IOSCaptureJournal, "version" | "sessionId" | "createdAt">>,
): Promise<void> {
	const previous = journalWrites.get(storage.directory) ?? Promise.resolve();
	const work = previous
		.catch(() => undefined)
		.then(async () => {
			const current = await readIOSJournal(storage);
			if (
				current.state === "committed" &&
				((patch.state && patch.state !== "committed") ||
					(patch.committedFile && patch.committedFile !== current.committedFile))
			)
				throw new Error("ALREADY_COMMITTED");
			await writeIOSJournal(storage, { ...current, ...patch });
		});
	journalWrites.set(storage.directory, work);
	try {
		await work;
	} finally {
		if (journalWrites.get(storage.directory) === work) journalWrites.delete(storage.directory);
	}
}

export async function repairIOSJournal(
	storage: IOSSessionStorage,
	result: NativeCaptureResult,
): Promise<void> {
	const nativeResult = parseNativeCaptureResult(result);
	if (nativeResult.sessionId !== storage.sessionId) throw new Error("INVALID_NATIVE_RESULT");
	try {
		const journal = await readIOSJournal(storage);
		if (journal.state === "committed") throw new Error("ALREADY_COMMITTED");
		return;
	} catch (error) {
		if ((error as Error).message === "ALREADY_COMMITTED") throw error;
	}
	await writeIOSJournal(storage, {
		version: 1,
		sessionId: storage.sessionId,
		createdAt: new Date().toISOString(),
		state: "interrupted",
		nativeResult,
		format: nativeResult.format,
		mode: nativeResult.mode,
	});
}
