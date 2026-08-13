import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const pendingWrites = new Map<string, Promise<void>>();

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
	return `${projectPath}.bak`;
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
	const backupTemporaryPath = createTemporaryPath(parentDir, "backup");
	const existingMode = await getExistingFileMode(targetPath);

	try {
		await writeSyncedTemporaryFile(temporaryPath, contents, existingMode);
		await preservePreviousGeneration(targetPath, backupPath, backupTemporaryPath);
		await fs.rename(temporaryPath, targetPath);
		await syncParentDirectory(parentDir);
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
	const queueKey = getQueueKey(projectPath);
	const previousWrite = pendingWrites.get(queueKey) ?? Promise.resolve();
	const currentWrite = previousWrite
		.catch(() => undefined)
		.then(() => commitProjectFile(projectPath, contents));
	pendingWrites.set(queueKey, currentWrite);

	try {
		await currentWrite;
	} finally {
		if (pendingWrites.get(queueKey) === currentWrite) {
			pendingWrites.delete(queueKey);
		}
	}
}
