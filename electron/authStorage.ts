import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, type IpcMainInvokeEvent, ipcMain, safeStorage } from "electron";
import { withAuthStorageTransaction } from "./authStorageTransactionLock";
import { getPackagedRendererBaseUrl } from "./rendererServer";

const MAX_VALUE_LENGTH = 256 * 1024;
const MAX_STORE_LENGTH = 1024 * 1024;
const MAX_PENDING_CONSENTS = 5;
const MAX_CONSENT_RETRIES = 5;
const MAX_KEYS = 16 + MAX_CONSENT_RETRIES;
const MAX_CONSENT_LENGTH = 8192;
const COMPLETED_CALLBACK_KEY = /^sb-[a-z0-9-]{1,100}-auth-token-completed-callback$/;
const PENDING_CONSENT_KEY = /^sb-[a-z0-9-]{1,100}-auth-token-signup-consent-[A-Za-z0-9_-]{43}$/;
const CONSENT_RETRY_KEY =
	/^sb-[a-z0-9-]{1,100}-auth-token-signup-consent-retry:[A-Za-z0-9_-]{1,128}$/;
// Supabase stores a bounded index and one verifier per pending PKCE flow.
const AUTH_KEY =
	/^sb-[a-z0-9-]{1,100}-auth-token(?:-code-verifier|-user|-flows-code-verifier|-flow-[A-Za-z0-9_-]{8,64}-code-verifier|-signup-consent-[A-Za-z0-9_-]{43}|-signup-consent-retry:[A-Za-z0-9_-]{1,128}|-completed-callback)?$/;
type AuthEntries = Record<string, string>;
let pending = Promise.resolve();
let completedCallback: { key: string; fingerprint: string } | undefined;

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
	let pendingConsents = 0;
	let consentRetries = 0;
	for (const [key, item] of values) {
		if (PENDING_CONSENT_KEY.test(key) && ++pendingConsents > MAX_PENDING_CONSENTS) {
			throw new Error("Too many pending signup acknowledgements.");
		}
		if (CONSENT_RETRY_KEY.test(key) && ++consentRetries > MAX_CONSENT_RETRIES) {
			throw new Error("Too many signup acknowledgement retries.");
		}
		assertKey(key);
		if (typeof item !== "string" || item.length > MAX_VALUE_LENGTH) {
			throw new Error("Invalid authentication storage value.");
		}
		if (COMPLETED_CALLBACK_KEY.test(key) && !/^[0-9a-f]{64}$/.test(item)) {
			throw new Error("Invalid completed callback fingerprint.");
		}
		if (
			(PENDING_CONSENT_KEY.test(key) || CONSENT_RETRY_KEY.test(key)) &&
			item.length > MAX_CONSENT_LENGTH
		) {
			throw new Error("Pending signup acknowledgement is too large.");
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

async function load(): Promise<{ entries: AuthEntries; persisted: boolean }> {
	if (!encryptionAvailable()) throw new Error("Secure authentication storage is unavailable.");
	try {
		const filePath = storagePath();
		const stat = await fs.stat(filePath);
		if (stat.size > MAX_STORE_LENGTH * 8)
			throw new Error("Authentication storage is too large.");
		const payload = JSON.parse(safeStorage.decryptString(await fs.readFile(filePath)));
		if (payload.version !== 1) throw new Error("Unsupported authentication storage version.");
		return { entries: validateEntries(payload.entries), persisted: true };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			// Keep an unreadable store intact; never replace it with an empty session.
			throw new Error(
				"Could not unlock saved authentication. Restart Recordly and try again.",
			);
		}
		return { entries: Object.create(null) as AuthEntries, persisted: false };
	}
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

function transaction<T>(operation: () => Promise<T>): Promise<T> {
	return withAuthStorageTransaction(
		path.join(path.dirname(storagePath()), "transactions"),
		operation,
	);
}

export function registerAuthStorageHandlers(): void {
	ipcMain.handle("auth-storage:available", (event) => {
		assertTrustedRenderer(event);
		return encryptionAvailable();
	});
	ipcMain.handle("auth-storage:migrate", (event, snapshot: unknown) => {
		assertTrustedRenderer(event);
		const validated = validateEntries(snapshot);
		return serialize(() =>
			transaction(async () => {
				const current = await load();
				if (!current.persisted) await save(validated);
			}),
		);
	});
	ipcMain.handle("auth-storage:get", (event, key: unknown) => {
		assertTrustedRenderer(event);
		assertKey(key);
		return serialize(async () =>
			completedCallback?.key === key
				? completedCallback.fingerprint
				: transaction(async () => (await load()).entries[key] ?? null),
		);
	});
	ipcMain.handle("auth-storage:set", (event, key: unknown, value: unknown) => {
		assertTrustedRenderer(event);
		assertKey(key);
		const validated = validateEntries({ [key]: value });
		return serialize(async () => {
			if (COMPLETED_CALLBACK_KEY.test(key)) {
				// Keep one non-secret completion marker available to all our windows even
				// if optional bookkeeping cannot be persisted after a successful exchange.
				completedCallback = { key, fingerprint: validated[key] };
			}
			return transaction(async () => {
				const next = { ...(await load()).entries, ...validated };
				if (completedCallback)
					for (const candidate of Object.keys(next)) {
						if (
							candidate !== completedCallback.key &&
							COMPLETED_CALLBACK_KEY.test(candidate)
						)
							delete next[candidate];
					}
				const consents = Object.keys(next).filter((item) => PENDING_CONSENT_KEY.test(item));
				for (const expired of consents.slice(0, -MAX_PENDING_CONSENTS))
					delete next[expired];
				const retries = Object.keys(next).filter((item) => CONSENT_RETRY_KEY.test(item));
				for (const expired of retries.slice(0, -MAX_CONSENT_RETRIES)) delete next[expired];
				await save(next);
			});
		});
	});
	ipcMain.handle("auth-storage:remove", (event, key: unknown) => {
		assertTrustedRenderer(event);
		assertKey(key);
		return serialize(() =>
			transaction(async () => {
				const next = { ...(await load()).entries };
				delete next[key];
				await save(next);
				if (completedCallback?.key === key) completedCallback = undefined;
			}),
		);
	});
}
