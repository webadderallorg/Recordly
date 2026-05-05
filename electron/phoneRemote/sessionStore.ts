import crypto from "node:crypto";
import type {
	PhoneRemoteJoinUrls,
	PhoneRemotePublicSession,
	PhoneRemoteSession,
	PhoneRemoteSignalEnvelope,
	PhoneRemoteSignalMessage,
	PhoneRemoteStatusMessage,
	PhoneRemoteStoreEvent,
} from "./types";

const SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_SIGNAL_HISTORY = 200;

const sessions = new Map<string, PhoneRemoteSession>();
const listeners = new Set<(event: PhoneRemoteStoreEvent) => void>();

function createPairingCode(): string {
	let code = "";
	while (code.length < 8) {
		code += crypto
			.randomBytes(6)
			.toString("base64url")
			.replace(/[^A-Z0-9]/gi, "")
			.toUpperCase();
	}
	return code.slice(0, 8);
}

function appendSignal(
	signals: PhoneRemoteSignalEnvelope[],
	message: PhoneRemoteSignalMessage,
): PhoneRemoteSignalEnvelope {
	const previousIndex = signals.length > 0 ? signals[signals.length - 1].index : 0;
	const envelope = {
		index: previousIndex + 1,
		sentAt: Date.now(),
		message,
	};

	signals.push(envelope);
	if (signals.length > MAX_SIGNAL_HISTORY) {
		signals.splice(0, signals.length - MAX_SIGNAL_HISTORY);
	}

	return envelope;
}

function emit(event: PhoneRemoteStoreEvent) {
	for (const listener of listeners) {
		listener(event);
	}
}

export function subscribePhoneRemoteStore(listener: (event: PhoneRemoteStoreEvent) => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function pruneExpiredPhoneRemoteSessions(now = Date.now()) {
	for (const [sessionId, session] of sessions.entries()) {
		if (session.expiresAt <= now) {
			sessions.delete(sessionId);
			emit({
				type: "status",
				sessionId,
				ownerWebContentsId: session.ownerWebContentsId,
				status: {
					status: "disconnected",
					detail: "Phone session expired.",
				},
			});
		}
	}
}

export function createPhoneRemoteSession(
	ownerWebContentsId: number,
	urls: PhoneRemoteJoinUrls,
	now = Date.now(),
): PhoneRemotePublicSession {
	pruneExpiredPhoneRemoteSessions(now);

	const session: PhoneRemoteSession = {
		...urls,
		id: crypto.randomUUID(),
		code: createPairingCode(),
		createdAt: now,
		expiresAt: now + SESSION_TTL_MS,
		ownerWebContentsId,
		status: "waiting",
		laptopSignals: [],
		phoneSignals: [],
	};

	sessions.set(session.id, session);
	return toPublicSession(session);
}

export function getPhoneRemoteSession(sessionId: string): PhoneRemoteSession | null {
	pruneExpiredPhoneRemoteSessions();
	return sessions.get(sessionId) ?? null;
}

export function getPhoneRemoteSessionByCode(code: string): PhoneRemoteSession | null {
	pruneExpiredPhoneRemoteSessions();
	const normalizedCode = code.trim().toUpperCase();

	for (const session of sessions.values()) {
		if (session.code === normalizedCode) {
			return session;
		}
	}

	return null;
}

export function endPhoneRemoteSession(sessionId: string): boolean {
	const session = sessions.get(sessionId);
	if (!session) {
		return false;
	}

	sessions.delete(sessionId);
	emit({
		type: "status",
		sessionId,
		ownerWebContentsId: session.ownerWebContentsId,
		status: {
			status: "disconnected",
			detail: "Phone session ended.",
		},
	});
	return true;
}

export function addLaptopSignal(
	sessionId: string,
	ownerWebContentsId: number,
	message: PhoneRemoteSignalMessage,
): PhoneRemoteSignalEnvelope | null {
	const session = getPhoneRemoteSession(sessionId);
	if (!session || session.ownerWebContentsId !== ownerWebContentsId) {
		return null;
	}

	return appendSignal(session.laptopSignals, message);
}

export function getLaptopSignalsSince(
	session: PhoneRemoteSession,
	afterIndex: number,
): PhoneRemoteSignalEnvelope[] {
	return session.laptopSignals.filter((signal) => signal.index > afterIndex);
}

export function addPhoneSignal(
	session: PhoneRemoteSession,
	message: PhoneRemoteSignalMessage,
): PhoneRemoteSignalEnvelope {
	const envelope = appendSignal(session.phoneSignals, message);
	emit({
		type: "signal",
		sessionId: session.id,
		ownerWebContentsId: session.ownerWebContentsId,
		message,
	});
	return envelope;
}

export function updatePhoneRemoteStatus(
	session: PhoneRemoteSession,
	status: PhoneRemoteStatusMessage,
) {
	session.expiresAt = Date.now() + SESSION_TTL_MS;
	session.status = status.status;
	session.lastStatusDetail = status.detail;
	emit({
		type: "status",
		sessionId: session.id,
		ownerWebContentsId: session.ownerWebContentsId,
		status,
	});
}

export function toPublicSession(session: PhoneRemoteSession): PhoneRemotePublicSession {
	return {
		id: session.id,
		code: session.code,
		expiresAt: session.expiresAt,
		status: session.status,
		joinUrl: session.joinUrl,
		localJoinUrl: session.localJoinUrl,
		lanJoinUrl: session.lanJoinUrl,
		tunnelJoinUrl: session.tunnelJoinUrl,
		urlMode: session.urlMode,
		tunnelError: session.tunnelError,
	};
}

export function clearPhoneRemoteSessionsForTests() {
	sessions.clear();
	listeners.clear();
}
