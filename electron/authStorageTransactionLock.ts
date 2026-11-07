import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

type Ticket = {
	version: 1;
	pid: number;
	nonce: string;
	phase: "choosing" | "ticket";
	number: number;
};

const MAX_RECORD_BYTES = 512;
const TICKET_NAME = /^([1-9][0-9]{0,9})-([0-9a-f]{32})\.ticket$/;

export class AuthStorageBusyError extends Error {
	constructor() {
		super("Saved authentication is busy. Try again shortly.");
		this.name = "AuthStorageBusyError";
	}
}

function validTicket(value: unknown, name: string): value is Ticket {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const ticket = value as Ticket;
	return (
		Object.keys(ticket).length === 5 &&
		ticket.version === 1 &&
		Number.isSafeInteger(ticket.pid) &&
		ticket.pid > 0 &&
		ticket.pid <= 0x7fffffff &&
		typeof ticket.nonce === "string" &&
		/^[0-9a-f]{32}$/.test(ticket.nonce) &&
		name === `${ticket.pid}-${ticket.nonce}.ticket` &&
		Number.isSafeInteger(ticket.number) &&
		((ticket.phase === "choosing" && ticket.number === 0) ||
			(ticket.phase === "ticket" && ticket.number > 0))
	);
}

async function readTicket(filePath: string): Promise<Ticket | null> {
	let file: Awaited<ReturnType<typeof fs.open>> | undefined;
	try {
		file = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const stat = await file.stat();
		if (!stat.isFile() || stat.size > MAX_RECORD_BYTES) throw new AuthStorageBusyError();
		const value: unknown = JSON.parse(await file.readFile("utf8"));
		if (!validTicket(value, path.basename(filePath))) throw new AuthStorageBusyError();
		return value;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw new AuthStorageBusyError();
	} finally {
		await file?.close();
	}
}

function provenDead(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return false;
	} catch (error) {
		// EPERM and other unknown outcomes never authorize removing an owner's ticket.
		return (error as NodeJS.ErrnoException).code === "ESRCH";
	}
}

async function liveTickets(directory: string): Promise<Ticket[]> {
	const tickets: Ticket[] = [];
	for (const name of await fs.readdir(directory)) {
		if (name.startsWith(".publish-")) continue;
		if (!TICKET_NAME.test(name)) throw new AuthStorageBusyError();
		const filePath = path.join(directory, name);
		const ticket = await readTicket(filePath);
		if (!ticket) continue;
		if (provenDead(ticket.pid)) {
			// This name contains the dead operation's random nonce and is never reused.
			await fs.unlink(filePath).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== "ENOENT") throw new AuthStorageBusyError();
			});
		} else tickets.push(ticket);
	}
	return tickets;
}

async function publish(directory: string, ticket: Ticket, initial: boolean): Promise<void> {
	const destination = path.join(directory, `${ticket.pid}-${ticket.nonce}.ticket`);
	const temporary = path.join(
		directory,
		`.publish-${ticket.pid}-${randomBytes(16).toString("hex")}`,
	);
	try {
		const file = await fs.open(temporary, "wx", 0o600);
		try {
			await file.writeFile(JSON.stringify(ticket), "utf8");
		} finally {
			await file.close();
		}
		// Readers see either the whole choosing record or the whole numbered record.
		// The exclusive link also prevents replacing another operation's initial claim.
		if (initial) await fs.link(temporary, destination);
		else await fs.rename(temporary, destination);
	} finally {
		await fs.unlink(temporary).catch(() => undefined);
	}
}

/**
 * A dynamic bakery queue for short local file transactions. A choosing marker is
 * published before inspecting numbers; after publishing our number we inspect
 * contenders again. New arrivals must either be seen in that inspection or see
 * our published number and choose a later one. A sleeping live owner never expires.
 */
export async function withAuthStorageTransaction<T>(
	directory: string,
	operation: () => Promise<T>,
	options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<T> {
	const timeoutMs = options.timeoutMs ?? 3000;
	const pollMs = options.pollMs ?? 15;
	if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(pollMs) || pollMs <= 0)
		throw new AuthStorageBusyError();
	const deadline = performance.now() + timeoutMs;
	await fs.mkdir(directory, { recursive: true, mode: 0o700 });
	if (process.platform !== "win32") await fs.chmod(directory, 0o700);
	const own: Ticket = {
		version: 1,
		pid: process.pid,
		nonce: randomBytes(16).toString("hex"),
		phase: "choosing",
		number: 0,
	};
	const ownPath = path.join(directory, `${own.pid}-${own.nonce}.ticket`);
	let published = false;
	try {
		await publish(directory, own, true);
		published = true;
		const contenders = await liveTickets(directory);
		const maximum = Math.max(0, ...contenders.map((ticket) => ticket.number));
		if (maximum >= Number.MAX_SAFE_INTEGER) throw new AuthStorageBusyError();
		own.number = maximum + 1;
		own.phase = "ticket";
		await publish(directory, own, false);
		for (;;) {
			const tickets = await liveTickets(directory);
			const blocked = tickets.some(
				(ticket) =>
					ticket.nonce !== own.nonce &&
					(ticket.phase === "choosing" ||
						ticket.number < own.number ||
						(ticket.number === own.number && ticket.nonce < own.nonce)),
			);
			if (!blocked) return await operation();
			const remaining = deadline - performance.now();
			if (remaining <= 0) throw new AuthStorageBusyError();
			await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, remaining)));
		}
	} finally {
		if (published) await fs.unlink(ownPath).catch(() => undefined);
	}
}
