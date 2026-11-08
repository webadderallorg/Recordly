import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, type IpcMainInvokeEvent, ipcMain, safeStorage } from "electron";
import { getPackagedRendererBaseUrl } from "./rendererServer";

const MAX_VALUE_LENGTH = 256 * 1024;
const MAX_STORE_LENGTH = 1024 * 1024;
const MAX_KEYS = 16;
// Supabase stores a bounded index and one verifier per pending PKCE flow.
const AUTH_KEY =
	/^sb-[a-z0-9-]{1,100}-auth-token(?:-code-verifier|-user|-flows-code-verifier|-flow-[A-Za-z0-9_-]{8,64}-code-verifier)?$/;
type AuthEntries = Record<string, string>;
let entries: AuthEntries | undefined;
let migrated = false;
let pending = Promise.resolve();

function encryptionAvailable(): boolean {
	return (
		safeStorage.isEncryptionAvailable() &&
		(process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text")
	);
}

function assertTrustedRenderer(event: IpcMainInvokeEvent): void {
	if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
		throw new Error("Authentication storage requires the app's main frame.");
	}
	const candidate = new URL(event.senderFrame.url);
	const trusted = [
		process.env.VITE_DEV_SERVER_URL,
		getPackagedRendererBaseUrl(),
		pathToFileURL(path.join(process.env.APP_ROOT || app.getAppPath(), "dist", "index.html"))
			.href,
	].filter((value): value is string => Boolean(value));
	if (
		candidate.username ||
		candidate.password ||
		!trusted.some((value) => {
			const base = new URL(value);
			return candidate.origin === base.origin && candidate.pathname === base.pathname;
		})
	) {
		throw new Error("Authentication storage is only available to Recordly.");
	}
}

function assertKey(key: unknown): asserts key is string {
	if (typeof key !== "string" || !AUTH_KEY.test(key)) {
		throw new Error("Invalid authentication storage key.");
	}
}

function validateEntries(value: unknown): AuthEntries {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Invalid authentication storage data.");
	}
	const values = Object.entries(value);
	if (values.length > MAX_KEYS) throw new Error("Authentication storage is too large.");
	const result: AuthEntries = Object.create(null);
	for (const [key, item] of values) {
		assertKey(key);
		if (typeof item !== "string" || item.length > MAX_VALUE_LENGTH) {
			throw new Error("Invalid authentication storage value.");
		}
		result[key] = item;
	}
	if (JSON.stringify(result).length > MAX_STORE_LENGTH) {
		throw new Error("Authentication storage is too large.");
	}
	return result;
}

function storagePath(): string {
	return path.join(app.getPath("userData"), "private-auth", "session.enc");
}

async function load(): Promise<AuthEntries> {
	if (!encryptionAvailable()) throw new Error("Secure authentication storage is unavailable.");
	if (entries) return entries;
	try {
		const filePath = storagePath();
		const stat = await fs.stat(filePath);
		if (stat.size > MAX_STORE_LENGTH * 8)
			throw new Error("Authentication storage is too large.");
		const payload = JSON.parse(safeStorage.decryptString(await fs.readFile(filePath)));
		if (payload.version !== 1) throw new Error("Unsupported authentication storage version.");
		entries = validateEntries(payload.entries);
		migrated = true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			// Keep an unreadable store intact; never replace it with an empty session.
			throw new Error(
				"Could not unlock saved authentication. Restart Recordly and try again.",
			);
		}
		entries = Object.create(null) as AuthEntries;
	}
	return entries;
}

async function save(next: AuthEntries): Promise<void> {
	const validated = validateEntries(next);
	const encrypted = safeStorage.encryptString(JSON.stringify({ version: 1, entries: validated }));
	const filePath = storagePath();
	const directory = path.dirname(filePath);
	await fs.mkdir(directory, { recursive: true, mode: 0o700 });
	if (process.platform !== "win32") await fs.chmod(directory, 0o700);
	const temporary = path.join(directory, `${randomUUID()}.tmp`);
	try {
		const file = await fs.open(temporary, "wx", 0o600);
		try {
			await file.writeFile(encrypted);
			await file.sync();
		} finally {
			await file.close();
		}
		await fs.rename(temporary, filePath);
		entries = validated;
		migrated = true;
	} finally {
		await fs.rm(temporary, { force: true }).catch(() => {
			// A cleanup failure must not mask the original storage error.
		});
	}
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
	const result = pending.then(operation);
	pending = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}

export function registerAuthStorageHandlers(): void {
	ipcMain.handle("auth-storage:available", (event) => {
		assertTrustedRenderer(event);
		return encryptionAvailable();
	});
	ipcMain.handle("auth-storage:migrate", (event, snapshot: unknown) => {
		assertTrustedRenderer(event);
		const validated = validateEntries(snapshot);
		return serialize(async () => {
			await load();
			if (!migrated) await save(validated);
		});
	});
	ipcMain.handle("auth-storage:get", (event, key: unknown) => {
		assertTrustedRenderer(event);
		assertKey(key);
		return serialize(async () => (await load())[key] ?? null);
	});
	ipcMain.handle("auth-storage:set", (event, key: unknown, value: unknown) => {
		assertTrustedRenderer(event);
		assertKey(key);
		const validated = validateEntries({ [key]: value });
		return serialize(async () => save({ ...(await load()), ...validated }));
	});
	ipcMain.handle("auth-storage:remove", (event, key: unknown) => {
		assertTrustedRenderer(event);
		assertKey(key);
		return serialize(async () => {
			const next = { ...(await load()) };
			delete next[key];
			await save(next);
		});
	});
}
