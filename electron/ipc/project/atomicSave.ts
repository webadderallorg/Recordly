import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const pendingWrites = new Map<string, Promise<unknown>>();
const PROJECT_IDENTITY_TIMEOUT_MS = 5000;
// Reserve admission before identity I/O so aliases retain call-invocation order.
let pendingIdentityAdmissions: Promise<unknown> = Promise.resolve();
let recoveryDirectory: string | undefined;
const isJsonGeneration = (contents: string) => {
	JSON.parse(contents.replace(/^\uFEFF/, ""));
	return true;
};
let validateGeneration = isJsonGeneration;
const recoveredGenerations = new Map<string, { primaryHash: string | null; contents: string }>();
const volumeCasePolicies = new Map<number, boolean>();

/** Configure once from the app's userData location; pure utilities use hidden sibling storage. */
export function setProjectRecoveryDirectory(directory: string, validate = isJsonGeneration) {
	recoveryDirectory = path.resolve(directory);
	validateGeneration = validate;
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

export async function getProjectBackupPath(projectPath: string): Promise<string> {
	return managedBackupPath(await getProjectStorageKey(projectPath));
}

function managedBackupPath(key: string): string {
	const digest = createHash("sha256").update(key).digest("hex");
	return path.join(
		recoveryDirectory ?? path.join(path.dirname(key), ".recordly-recovery"),
		`${digest}.recordly`,
	);
}

export function getLegacyProjectBackupPath(projectPath: string): string {
	return `${projectPath}.bak`;
}

export async function getProjectBackupPaths(projectPath: string): Promise<string[]> {
	// Earlier versions hashed the lexical path. Keep that spelling readable while
	// all new generations use the stable filesystem identity.
	const resolved = path.resolve(projectPath);
	const oldKey = process.platform === "win32" ? resolved.toLowerCase() : resolved;
	return [
		...new Set([
			await getProjectBackupPath(projectPath),
			managedBackupPath(oldKey),
			getLegacyProjectBackupPath(projectPath),
		]),
	];
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
		const key = await getProjectStorageKey(projectPath);
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
		for (const backupPath of await getProjectBackupPaths(projectPath)) {
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

export async function getProjectStorageKey(projectPath: string): Promise<string> {
	const resolvedPath = path.resolve(projectPath);
	// Resolve parents even when the document is absent. Do not resolve a leaf
	// symlink: an atomic replacement replaces that entry, not its target.
	let parent = path.dirname(resolvedPath);
	const suffix = [path.basename(resolvedPath)];
	while (true) {
		try {
			const canonicalParent = await fs.realpath(parent);
			if (process.platform === "win32") {
				return path.join(canonicalParent, ...suffix).toLowerCase();
			}
			return path.join(
				canonicalParent,
				...((await isCaseInsensitiveDirectory(canonicalParent))
					? suffix.map((part) => part.toLowerCase())
					: suffix),
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			const next = path.dirname(parent);
			if (next === parent) throw error;
			suffix.unshift(path.basename(parent));
			parent = next;
		}
	}
}

async function isCaseInsensitiveDirectory(directory: string): Promise<boolean> {
	const original = await fs.stat(directory);
	const known = volumeCasePolicies.get(original.dev);
	if (known !== undefined) return known;
	let candidate = directory;
	while (true) {
		// Probe an entry inside this filesystem, not the mountpoint's spelling in
		// its parent. A case-sensitive volume can be mounted on an insensitive one.
		let entries: Awaited<ReturnType<typeof fs.opendir>> | undefined;
		try {
			entries = await fs.opendir(candidate);
			for (let entry = await entries.read(); entry; entry = await entries.read()) {
				if (entry.isSymbolicLink()) continue;
				const variant = entry.name.replace(/[a-z]/i, (letter) =>
					letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase(),
				);
				if (variant === entry.name) continue;
				const actualPath = path.join(candidate, entry.name);
				const variantPath = path.join(candidate, variant);
				try {
					const alternate = await fs.lstat(variantPath);
					const actual = await fs.lstat(actualPath);
					if (alternate.isSymbolicLink() || actual.isSymbolicLink()) continue;
					const insensitive =
						alternate.dev === actual.dev &&
						alternate.ino === actual.ino &&
						(await fs.realpath(actualPath)) === (await fs.realpath(variantPath));
					volumeCasePolicies.set(original.dev, insensitive);
					return insensitive;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ENOENT") {
						try {
							await fs.lstat(actualPath);
						} catch {
							continue;
						}
						volumeCasePolicies.set(original.dev, false);
						return false;
					}
				}
			}
		} catch {
			// A readable ancestor on the same volume may still establish the policy.
		} finally {
			await entries?.close();
		}
		const next = path.dirname(candidate);
		if (next === candidate || (await fs.stat(next)).dev !== original.dev) return false;
		candidate = next;
	}
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
	validate = validateGeneration,
): Promise<boolean> {
	let previous: string | undefined;
	let primaryMissing = false;
	try {
		previous = await fs.readFile(targetPath, "utf-8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			primaryMissing = true;
		} else throw error;
	}
	const valid = (contents: string) => {
		try {
			return validate(contents);
		} catch {
			return false;
		}
	};
	if (previous === undefined || !valid(previous)) {
		previous = undefined;
		for (const candidate of await getProjectBackupPaths(targetPath)) {
			try {
				const contents = await fs.readFile(candidate, "utf-8");
				if (valid(contents)) {
					previous = contents;
					break;
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
		// Keep even a damaged backup for manual repair if no validated generation
		// is available. Never replace it with a known-bad primary.
		if (previous === undefined) {
			if (primaryMissing) await fs.rm(backupPath, { force: true });
			return false;
		}
	}
	await writeSyncedTemporaryFile(backupTemporaryPath, previous, 0o600);
	await fs.rename(backupTemporaryPath, backupPath);
	return true;
}

async function commitProjectFile(projectPath: string, contents: string): Promise<void> {
	const targetPath = path.resolve(projectPath);
	const parentDir = path.dirname(targetPath);
	const backupPath = await getProjectBackupPath(targetPath);
	const temporaryPath = createTemporaryPath(parentDir, "project");
	const backupDir = path.dirname(backupPath);
	const backupTemporaryPath = createTemporaryPath(backupDir, "backup");
	const existingMode = await getExistingFileMode(targetPath);

	try {
		await writeSyncedTemporaryFile(temporaryPath, contents, existingMode);
		await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
		await syncParentDirectory(path.dirname(backupDir));
		const recovered = recoveredGenerations.get(await getProjectStorageKey(targetPath));
		let recoveringSameGeneration = false;
		let validBackupPreserved = false;
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
			validBackupPreserved = true;
		} else {
			validBackupPreserved = await preservePreviousGeneration(
				targetPath,
				backupPath,
				backupTemporaryPath,
			);
		}
		await syncParentDirectory(backupDir);
		await fs.rename(temporaryPath, targetPath);
		await syncParentDirectory(parentDir);
		recoveredGenerations.delete(await getProjectStorageKey(targetPath));
		// The previous generation is durable in managed storage before retiring an old sidecar.
		if (validBackupPreserved) {
			await Promise.all(
				(await getProjectBackupPaths(targetPath))
					.filter((candidate) => candidate !== backupPath)
					.map((candidate) => fs.rm(candidate, { force: true }).catch(() => undefined)),
			);
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
			recoveredGenerations.set(await getProjectStorageKey(projectPath), {
				primaryHash: snapshot.primaryHash,
				contents: snapshot.contents,
			});
		}
		await commitProjectFile(projectPath, contents);
	});
}

async function queueProjectWrite<T>(projectPath: string, write: () => Promise<T>): Promise<T> {
	// Start identity resolution in parallel, and handle rejection immediately even
	// when an earlier admission is still waiting for its filesystem result.
	let identityTimeout: ReturnType<typeof setTimeout> | undefined;
	// Race the identity itself, not just the returned save promise: a timed-out
	// lookup must release admission and must never enqueue a late write.
	const identity = Promise.race([
		getProjectStorageKey(projectPath),
		new Promise<never>((_, reject) => {
			identityTimeout = setTimeout(
				() =>
					reject(
						new Error(
							"Project location did not respond while resolving its filesystem identity.",
						),
					),
				PROJECT_IDENTITY_TIMEOUT_MS,
			);
			identityTimeout.unref?.();
		}),
	]).then(
		(key) => {
			clearTimeout(identityTimeout);
			return { key };
		},
		(error: unknown) => {
			clearTimeout(identityTimeout);
			return { error };
		},
	);
	const admission = pendingIdentityAdmissions.then(async () => {
		const resolved = await identity;
		if ("error" in resolved) throw resolved.error;
		const queueKey = resolved.key;
		const previousWrite = pendingWrites.get(queueKey) ?? Promise.resolve();
		const currentWrite = previousWrite.catch(() => undefined).then(write);
		pendingWrites.set(queueKey, currentWrite);
		// Wrap the write promise: admission must not wait for the actual disk write.
		return { queueKey, currentWrite };
	});
	pendingIdentityAdmissions = admission.then(
		() => undefined,
		() => undefined,
	);
	const { queueKey, currentWrite } = await admission;

	try {
		return await currentWrite;
	} finally {
		if (pendingWrites.get(queueKey) === currentWrite) {
			pendingWrites.delete(queueKey);
		}
	}
}
