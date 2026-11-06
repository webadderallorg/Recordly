import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const pendingWrites = new Map<string, Promise<unknown>>();
let recoveryDirectory: string | undefined;
const recoveredGenerations = new Map<string, { primaryHash: string | null; contents: string }>();

/** Configure once from the app's userData location; pure utilities use hidden sibling storage. */
export function setProjectRecoveryDirectory(directory: string) {
	recoveryDirectory = path.resolve(directory);
}

const unsupportedDirectorySyncErrors = new Set([
	"EACCES",
	"EINVAL",
	"EISDIR",
	"ENOSYS",
	"ENOTSUP",
	"EOPNOTSUPP",
	"EPERM",
]);

export function getProjectBackupPath(projectPath: string): string {
	const key = getQueueKey(projectPath);
	const digest = createHash("sha256").update(key).digest("hex");
	return path.join(
		recoveryDirectory ?? path.join(path.dirname(key), ".recordly-recovery"),
		`${digest}.recordly`,
	);
}

export function getLegacyProjectBackupPath(projectPath: string): string {
	return `${projectPath}.bak`;
}

export function getProjectBackupPaths(projectPath: string): string[] {
	return [getProjectBackupPath(projectPath), getLegacyProjectBackupPath(projectPath)];
}

function contentHash(contents: string): string {
	return createHash("sha256").update(contents).digest("hex");
}

/** A corrupt/missing primary may use a validated previous generation, without overwriting it. */
export async function readProjectFileWithRecovery<T>(
	projectPath: string,
	parse: (contents: string) => T,
): Promise<{ project: T; recovered: boolean; contents: string; primaryHash: string | null }> {
	return queueProjectWrite(projectPath, async () => {
		const key = getQueueKey(projectPath);
		let primary: string | null = null;
		let primaryError: unknown;
		try {
			primary = await fs.readFile(projectPath, "utf-8");
			const project = parse(primary);
			recoveredGenerations.delete(key);
			return {
				project,
				recovered: false,
				contents: primary,
				primaryHash: contentHash(primary),
			};
		} catch (error) {
			primaryError = error;
			// Never bypass filesystem access failures by opening another path.
			const code = (error as NodeJS.ErrnoException).code;
			if (code && code !== "ENOENT") throw error;
		}
		for (const backupPath of getProjectBackupPaths(projectPath)) {
			try {
				const contents = await fs.readFile(backupPath, "utf-8");
				const project = parse(contents);
				recoveredGenerations.set(key, {
					primaryHash: primary === null ? null : contentHash(primary),
					contents,
				});
				return {
					project,
					recovered: true,
					contents,
					primaryHash: primary === null ? null : contentHash(primary),
				};
			} catch {
				/* Try the legacy generation if the managed one is absent or invalid. */
			}
		}
		throw primaryError;
	});
}

function getQueueKey(projectPath: string): string {
	const resolvedPath = path.resolve(projectPath);
	return process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
}

function createTemporaryPath(parentDir: string, label: string): string {
	return path.join(parentDir, `.recordly-${label}-${process.pid}-${randomUUID()}.tmp`);
}

async function getExistingFileMode(filePath: string): Promise<number | undefined> {
	try {
		return (await fs.stat(filePath)).mode & 0o777;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
}

async function writeSyncedTemporaryFile(
	filePath: string,
	contents: string,
	mode?: number,
): Promise<void> {
	const handle = await fs.open(filePath, "wx", mode);
	try {
		await handle.writeFile(contents, "utf-8");
		if (mode !== undefined) {
			await handle.chmod(mode);
		}
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function syncExistingFile(filePath: string): Promise<void> {
	const handle = await fs.open(filePath, "r+");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function syncParentDirectory(parentDir: string): Promise<void> {
	if (process.platform === "win32") {
		return;
	}

	try {
		const handle = await fs.open(parentDir, "r");
		try {
			await handle.sync();
		} finally {
			await handle.close();
		}
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (!code || !unsupportedDirectorySyncErrors.has(code)) {
			throw error;
		}
	}
}

async function preservePreviousGeneration(
	targetPath: string,
	backupPath: string,
	backupTemporaryPath: string,
): Promise<void> {
	try {
		await fs.copyFile(targetPath, backupTemporaryPath, fsConstants.COPYFILE_EXCL);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			await fs.rm(backupPath, { force: true });
			return;
		}
		throw error;
	}

	await syncExistingFile(backupTemporaryPath);
	await fs.rename(backupTemporaryPath, backupPath);
}

async function commitProjectFile(projectPath: string, contents: string): Promise<void> {
	const targetPath = path.resolve(projectPath);
	const parentDir = path.dirname(targetPath);
	const backupPath = getProjectBackupPath(targetPath);
	const temporaryPath = createTemporaryPath(parentDir, "project");
	const backupDir = path.dirname(backupPath);
	const backupTemporaryPath = createTemporaryPath(backupDir, "backup");
	const existingMode = await getExistingFileMode(targetPath);

	try {
		await writeSyncedTemporaryFile(temporaryPath, contents, existingMode);
		await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
		await syncParentDirectory(path.dirname(backupDir));
		const recovered = recoveredGenerations.get(getQueueKey(targetPath));
		let recoveringSameGeneration = false;
		if (recovered) {
			let currentHash: string | null = null;
			try {
				currentHash = contentHash(await fs.readFile(targetPath, "utf-8"));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			recoveringSameGeneration = currentHash === recovered.primaryHash;
		}
		if (recovered && recoveringSameGeneration) {
			// Preserve the known-good generation instead of backing up the damaged primary.
			await writeSyncedTemporaryFile(backupTemporaryPath, recovered.contents, 0o600);
			await fs.rename(backupTemporaryPath, backupPath);
		} else {
			await preservePreviousGeneration(targetPath, backupPath, backupTemporaryPath);
		}
		await syncParentDirectory(backupDir);
		await fs.rename(temporaryPath, targetPath);
		await syncParentDirectory(parentDir);
		recoveredGenerations.delete(getQueueKey(targetPath));
		// The previous generation is durable in managed storage before retiring an old sidecar.
		if (existingMode !== undefined || recoveringSameGeneration) {
			await fs
				.rm(getLegacyProjectBackupPath(targetPath), { force: true })
				.catch(() => undefined);
		}
	} finally {
		await Promise.all([
			fs.rm(temporaryPath, { force: true }).catch(() => undefined),
			fs.rm(backupTemporaryPath, { force: true }).catch(() => undefined),
		]);
	}
}

export async function writeProjectFileAtomically(
	projectPath: string,
	contents: string,
): Promise<void> {
	return queueProjectWrite(projectPath, () => commitProjectFile(projectPath, contents));
}

/** Read/validate/update under the same queue as autosave to preserve concurrent edits. */
export class ProjectFileChangedError extends Error {}

export async function updateProjectFileAtomically(
	projectPath: string,
	update: (contents: string) => string,
	snapshot?: { primaryHash: string | null; contents: string; recovered: boolean },
): Promise<void> {
	return queueProjectWrite(projectPath, async () => {
		let primary: string | null = null;
		try {
			primary = await fs.readFile(projectPath, "utf-8");
		} catch (error) {
			if (!snapshot || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		if (snapshot && (primary === null ? null : contentHash(primary)) !== snapshot.primaryHash) {
			throw new ProjectFileChangedError("Project changed while updating");
		}
		const contents = update(snapshot?.contents ?? primary!);
		if (snapshot?.recovered) {
			recoveredGenerations.set(getQueueKey(projectPath), {
				primaryHash: snapshot.primaryHash,
				contents: snapshot.contents,
			});
		}
		await commitProjectFile(projectPath, contents);
	});
}

async function queueProjectWrite<T>(projectPath: string, write: () => Promise<T>): Promise<T> {
	const queueKey = getQueueKey(projectPath);
	const previousWrite = pendingWrites.get(queueKey) ?? Promise.resolve();
	const currentWrite = previousWrite.catch(() => undefined).then(write);
	pendingWrites.set(queueKey, currentWrite);

	try {
		return await currentWrite;
	} finally {
		if (pendingWrites.get(queueKey) === currentWrite) {
			pendingWrites.delete(queueKey);
		}
	}
}
