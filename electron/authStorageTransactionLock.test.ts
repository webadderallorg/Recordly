import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withAuthStorageTransaction } from "./authStorageTransactionLock";

let root: string;
let directory: string;
let modulePath: string;
let storeModulePath: string;
const children = new Set<ChildProcess>();

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-auth-transactions-"));
	directory = path.join(root, "tickets");
	modulePath = path.join(root, "lock.mjs");
	const source = await fs.readFile(
		new URL("./authStorageTransactionLock.ts", import.meta.url),
		"utf8",
	);
	await fs.writeFile(
		modulePath,
		ts.transpileModule(source, {
			compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
		}).outputText,
	);
	const storeSource = (await fs.readFile(new URL("./authStorage.ts", import.meta.url), "utf8"))
		.replace('from "electron"', 'from "./electron-stub.mjs"')
		.replace('from "./rendererServer"', 'from "./renderer-stub.mjs"')
		.replace('from "./authStorageTransactionLock"', 'from "./lock.mjs"');
	storeModulePath = path.join(root, "store.mjs");
	await fs.writeFile(
		storeModulePath,
		ts.transpileModule(storeSource, {
			compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
		}).outputText,
	);
	await fs.writeFile(
		path.join(root, "electron-stub.mjs"),
		`
		export const handlers = new Map();
		export const app = {getPath: () => ${JSON.stringify(root)}, getAppPath: () => ${JSON.stringify(root)}};
		export const ipcMain = {handle: (key, handler) => handlers.set(key, handler)};
		export const safeStorage = {
			isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'test',
			encryptString: value => Buffer.from(value), decryptString: value => value.toString()
		};
	`,
	);
	await fs.writeFile(
		path.join(root, "renderer-stub.mjs"),
		"export const getPackagedRendererBaseUrl = () => 'http://127.0.0.1:49152/';",
	);
});

afterEach(async () => {
	vi.restoreAllMocks();
	for (const child of children) {
		if (child.exitCode === null && child.signalCode === null) {
			const closed = new Promise((resolve) => child.once("exit", resolve));
			child.kill("SIGKILL");
			await closed;
		}
	}
	children.clear();
	await fs.rm(root, { recursive: true, force: true });
});

function launch(mode: "increments" | "hold" | "store", index = 0): ChildProcess {
	const child = spawn(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`
		import fs from 'node:fs/promises';
		import {withAuthStorageTransaction} from ${JSON.stringify(pathToFileURL(modulePath).href)};
		const directory = ${JSON.stringify(directory)};
		const target = ${JSON.stringify(path.join(root, "state.json"))};
		let invoke;
		if (${JSON.stringify(mode)} === 'store') {
			const {registerAuthStorageHandlers} = await import(${JSON.stringify(pathToFileURL(storeModulePath).href)});
			const {handlers} = await import(${JSON.stringify(pathToFileURL(path.join(root, "electron-stub.mjs")).href)});
			registerAuthStorageHandlers();
			const mainFrame = {url: 'http://127.0.0.1:49152/'};
			invoke = (name, ...args) => handlers.get('auth-storage:' + name)({senderFrame: mainFrame, sender: {mainFrame}}, ...args);
			// Both real storage modules load the same empty generation before either writes.
			await invoke('get', 'sb-recordlytest-auth-token');
		}
		process.send('ready');
		await new Promise(resolve => process.once('message', resolve));
		try {
			if (${JSON.stringify(mode)} === 'hold') {
				await withAuthStorageTransaction(directory, async () => {
					process.send('held');
					await new Promise(resolve => process.once('message', resolve));
				});
			} else if (${JSON.stringify(mode)} === 'store') {
				for (let n = 0; n < 10; n++) {
					await invoke('set', 'sb-recordlytest-auth-token-flow-worker00${index}-code-verifier', 'worker' + ${index} + ':' + n);
					await new Promise(resolve => setTimeout(resolve, 2));
				}
			} else {
				for (let n = 0; n < 12; n++) await withAuthStorageTransaction(directory, async () => {
					const state = JSON.parse(await fs.readFile(target, 'utf8'));
					await new Promise(resolve => setTimeout(resolve, 3));
					state.count++;
					state['worker' + ${index}] = n + 1;
					await fs.writeFile(target, JSON.stringify(state));
				}, {timeoutMs: 5000, pollMs: 3});
			}
			process.disconnect();
		} catch(error) { console.error(error.message); process.exitCode = 1; process.disconnect(); }
	`,
		],
		{ stdio: ["ignore", "pipe", "pipe", "ipc"] },
	);
	children.add(child);
	return child;
}

function message(child: ChildProcess, expected: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const onExit = () => reject(new Error(`Child exited before ${expected}`));
		child.once("exit", onExit);
		const onMessage = (value: unknown) => {
			if (value !== expected) return;
			child.off("exit", onExit);
			child.off("message", onMessage);
			resolve();
		};
		child.on("message", onMessage);
	});
}

function exit(child: ChildProcess): Promise<void> {
	return new Promise((resolve, reject) => {
		let stderr = "";
		child.stderr?.on("data", (chunk) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("exit", (code) =>
			code === 0 ? resolve() : reject(new Error(stderr || `Child exit ${code}`)),
		);
	});
}

async function marker(pid: number, phase: "choosing" | "ticket" = "ticket", number = 1) {
	await fs.mkdir(directory, { recursive: true });
	const nonce = "a".repeat(32);
	const file = path.join(directory, `${pid}-${nonce}.ticket`);
	await fs.writeFile(file, JSON.stringify({ version: 1, pid, nonce, phase, number }));
	return file;
}

it("serializes real processes without losing read-modify-write increments or disjoint keys", async () => {
	await fs.writeFile(path.join(root, "state.json"), JSON.stringify({ count: 0 }));
	const workers = [0, 1, 2].map((index) => launch("increments", index));
	await Promise.all(workers.map((child) => message(child, "ready")));
	const finished = Promise.all(workers.map(exit));
	for (const child of workers) child.send("go");
	await finished;
	expect(JSON.parse(await fs.readFile(path.join(root, "state.json"), "utf8"))).toEqual({
		count: 36,
		worker0: 12,
		worker1: 12,
		worker2: 12,
	});
	expect(await fs.readdir(directory)).toEqual([]);
}, 15000);

it("preserves all verifier writes through the real storage handlers in separate processes", async () => {
	const workers = [0, 1, 2].map((index) => launch("store", index));
	await Promise.all(workers.map((child) => message(child, "ready")));
	const finished = Promise.all(workers.map(exit));
	for (const child of workers) child.send("go");
	await finished;
	const payload = JSON.parse(
		await fs.readFile(path.join(root, "private-auth", "session.enc"), "utf8"),
	);
	expect(payload).toEqual({
		version: 1,
		entries: {
			"sb-recordlytest-auth-token-flow-worker000-code-verifier": "worker0:9",
			"sb-recordlytest-auth-token-flow-worker001-code-verifier": "worker1:9",
			"sb-recordlytest-auth-token-flow-worker002-code-verifier": "worker2:9",
		},
	});
}, 15000);

it("cleans only a proven-dead child owner's unique ticket and then acquires", async () => {
	const child = launch("hold");
	await message(child, "ready");
	const held = message(child, "held");
	child.send("go");
	await held;
	const [oldTicket] = await fs.readdir(directory);
	const stopped = new Promise((resolve) => child.once("exit", resolve));
	child.kill("SIGKILL");
	await stopped;
	expect(await withAuthStorageTransaction(directory, async () => "acquired")).toBe("acquired");
	await expect(fs.access(path.join(directory, oldTicket))).rejects.toMatchObject({
		code: "ENOENT",
	});
	expect(await fs.readdir(directory)).toEqual([]);
});

it("never steals from a live child despite ancient mtime and changed wall clock", async () => {
	const child = launch("hold");
	await message(child, "ready");
	const held = message(child, "held");
	child.send("go");
	await held;
	const [owner] = await fs.readdir(directory);
	const ownerPath = path.join(directory, owner);
	await fs.utimes(ownerPath, new Date(0), new Date(0));
	vi.spyOn(Date, "now").mockReturnValue(Number.MAX_SAFE_INTEGER);
	const operation = vi.fn(async () => undefined);
	await expect(
		withAuthStorageTransaction(directory, operation, { timeoutMs: 60, pollMs: 5 }),
	).rejects.toThrow("busy");
	expect(operation).not.toHaveBeenCalled();
	expect(await fs.readdir(directory)).toEqual([owner]);
	const finished = exit(child);
	child.send("release");
	await finished;
	expect(await withAuthStorageTransaction(directory, async () => true)).toBe(true);
});

it("treats a reused live PID as busy rather than reclaiming its old unique ticket", async () => {
	const existing = await marker(process.pid);
	await expect(
		withAuthStorageTransaction(directory, async () => true, { timeoutMs: 30, pollMs: 5 }),
	).rejects.toThrow("busy");
	expect(await fs.readdir(directory)).toEqual([path.basename(existing)]);
});

it("waits for a live choosing owner without deleting its incomplete acquisition", async () => {
	const existing = await marker(process.pid, "choosing", 0);
	await expect(
		withAuthStorageTransaction(directory, async () => true, { timeoutMs: 30, pollMs: 5 }),
	).rejects.toThrow("busy");
	expect(await fs.readdir(directory)).toEqual([path.basename(existing)]);
});

it("leaves an owner with unknown liveness intact", async () => {
	const unknownPid = 2147483647;
	const existing = await marker(unknownPid);
	const realKill = process.kill.bind(process);
	vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
		if (pid === unknownPid) throw Object.assign(new Error("Denied"), { code: "EPERM" });
		return realKill(pid, signal);
	});
	await expect(
		withAuthStorageTransaction(directory, async () => true, { timeoutMs: 30, pollMs: 5 }),
	).rejects.toThrow("busy");
	expect(await fs.readdir(directory)).toEqual([path.basename(existing)]);
});

it.each([
	0, -1, 2147483648,
])("rejects invalid PID %s before any liveness probe for that PID", async (pid) => {
	const existing = await marker(pid);
	const kill = vi.spyOn(process, "kill");
	await expect(withAuthStorageTransaction(directory, async () => true)).rejects.toThrow("busy");
	expect(kill.mock.calls.some(([candidate]) => candidate === pid)).toBe(false);
	expect(await fs.readdir(directory)).toEqual([path.basename(existing)]);
});

it.each([
	{ phase: "ticket", number: Number.MAX_SAFE_INTEGER },
	{ phase: "ticket", number: 1.5 },
	{ phase: "choosing", number: 1 },
	{ phase: "unknown", number: 1 },
])("does not overwrite malformed or overflow ticket metadata: %j", async ({ phase, number }) => {
	const existing = await marker(process.pid, phase as "ticket", number);
	await expect(withAuthStorageTransaction(directory, async () => true)).rejects.toThrow("busy");
	expect(await fs.readdir(directory)).toEqual([path.basename(existing)]);
});

it("publishes only complete private metadata and removes its own ticket on operation failure", async () => {
	await expect(
		withAuthStorageTransaction(directory, async () => {
			const [name] = await fs.readdir(directory);
			const record = JSON.parse(await fs.readFile(path.join(directory, name), "utf8"));
			expect(Object.keys(record).sort()).toEqual([
				"nonce",
				"number",
				"phase",
				"pid",
				"version",
			]);
			expect(record).toMatchObject({
				version: 1,
				pid: process.pid,
				phase: "ticket",
				number: 1,
			});
			if (process.platform !== "win32") {
				expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
				expect((await fs.stat(path.join(directory, name))).mode & 0o777).toBe(0o600);
			}
			throw new Error("Original operation failure");
		}),
	).rejects.toThrow("Original operation failure");
	expect(await fs.readdir(directory)).toEqual([]);
});
