import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { AGENT_INPUT_MISSING, ensureAgentInputBinary } from "../ipc/paths/binaries";
import type { AgentCommand, AgentEvent, AgentResults } from "./agentProtocol";

export const HELPER_STOPPED = "Recordly's input helper stopped.";

export class HelperUnavailableError extends Error {
	constructor(message = "Recordly's input helper could not start.") {
		super(message);
		this.name = "HelperUnavailableError";
	}
}
const ACTION_MARGIN_MS = 5000;
const STOP_GRACE_MS = 500;

export type HelperProcess = {
	stdin: {
		write(chunk: string): unknown;
		end(): unknown;
		on(event: "error", listener: () => void): unknown;
	} | null;
	stdout: NodeJS.ReadableStream | null;
	on(event: "exit" | "error", listener: () => void): unknown;
	kill(): unknown;
};

export type AgentInputDeps = {
	resolveBinary: () => Promise<string>;
	spawn: (binaryPath: string) => HelperProcess;
	timeoutMs: number;
};

type Pending = {
	resolve: (result: Record<string, unknown>) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

function timeoutFor(command: AgentCommand, fallbackMs: number) {
	if ("ms" in command) return command.ms + ACTION_MARGIN_MS;
	if (command.cmd === "type")
		return (command.text.length / Math.max(command.cps, 1)) * 1000 + ACTION_MARGIN_MS;
	return fallbackMs;
}

export function createAgentInput(overrides: Partial<AgentInputDeps> = {}) {
	const deps: AgentInputDeps = {
		resolveBinary: ensureAgentInputBinary,
		spawn: (binaryPath) =>
			spawn(binaryPath, [], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true }),
		timeoutMs: 15_000,
		...overrides,
	};
	const events = new EventEmitter<{ "user-input": [AgentEvent] }>();
	const pending = new Map<number, Pending>();
	let child: HelperProcess | null = null;
	let starting: Promise<HelperProcess> | null = null;
	const answered = new WeakSet<HelperProcess>();
	let nextId = 0;

	const goneError = (proc: HelperProcess) =>
		answered.has(proc) ? new Error(HELPER_STOPPED) : new HelperUnavailableError();

	function drop(proc: HelperProcess, error = goneError(proc)) {
		if (child !== proc) return;
		child = null;
		for (const entry of pending.values()) {
			clearTimeout(entry.timer);
			entry.reject(error);
		}
		pending.clear();
	}

	function handleLine(line: string) {
		let message: unknown;
		try {
			message = JSON.parse(line);
		} catch {
			return;
		}
		if (!message || typeof message !== "object") return;
		const { id, ok, error, event, ...result } = message as Record<string, unknown>;
		if (event === "user-input") {
			events.emit("user-input", message as AgentEvent);
			return;
		}
		const entry = typeof id === "number" ? pending.get(id) : undefined;
		if (!entry) return;
		pending.delete(id as number);
		clearTimeout(entry.timer);
		if (ok === true) entry.resolve(result);
		else
			entry.reject(
				new Error(typeof error === "string" ? error : "Recordly's input helper failed."),
			);
	}

	async function start() {
		let proc: HelperProcess;
		try {
			proc = deps.spawn(await deps.resolveBinary());
		} catch (error) {
			const message = error instanceof Error ? error.message : "";
			throw new HelperUnavailableError(
				message.startsWith(AGENT_INPUT_MISSING) ? message : undefined,
			);
		}
		proc.on("exit", () => drop(proc));
		proc.on("error", () => drop(proc));
		proc.stdin?.on("error", () => drop(proc));
		if (proc.stdout) {
			createInterface({ input: proc.stdout }).on("line", (line) => {
				answered.add(proc);
				handleLine(line);
			});
		}
		child = proc;
		return proc;
	}

	function ensure() {
		if (child) return Promise.resolve(child);
		starting ??= start().finally(() => {
			starting = null;
		});
		return starting;
	}

	async function request<C extends AgentCommand>(
		command: C,
		options: { timeoutMs?: number } = {},
	): Promise<AgentResults[C["cmd"]]> {
		const proc = await ensure();
		if (child !== proc) throw goneError(proc);
		const id = ++nextId;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(
					new Error(`Recordly's input helper did not answer "${command.cmd}" in time.`),
				);
				drop(proc, new Error(HELPER_STOPPED));
				close(proc);
			}, options.timeoutMs ?? timeoutFor(command, deps.timeoutMs));
			pending.set(id, {
				resolve: resolve as Pending["resolve"],
				reject,
				timer,
			});
			proc.stdin?.write(`${JSON.stringify({ ...command, id })}\n`);
		});
	}

	function close(proc: HelperProcess) {
		const timer = setTimeout(() => proc.kill(), STOP_GRACE_MS);
		timer.unref?.();
		proc.on("exit", () => clearTimeout(timer));
		proc.stdin?.end();
	}

	function kill(proc: HelperProcess) {
		if (child !== proc) return;
		drop(proc, new Error(HELPER_STOPPED));
		close(proc);
	}

	function stop() {
		if (child) kill(child);
		else void starting?.then(kill, () => undefined);
	}

	return { request, events, stop };
}

export type AgentInput = ReturnType<typeof createAgentInput>;

export const agentInput = createAgentInput();
