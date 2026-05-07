import { afterEach, describe, expect, it, vi } from "vitest";
import {
	addLaptopSignal,
	addPhoneSignal,
	clearPhoneRemoteSessionsForTests,
	createPhoneRemoteSession,
	getLaptopSignalsSince,
	getPhoneRemoteSession,
	subscribePhoneRemoteStore,
	updatePhoneRemoteStatus,
} from "./sessionStore";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const urls = {
	joinUrl: "https://example.test/phone",
	localJoinUrl: "http://127.0.0.1:1234/phone",
	lanJoinUrl: "http://192.168.1.2:1234/phone",
	urlMode: "secure-tunnel" as const,
};

afterEach(() => {
	vi.useRealTimers();
	clearPhoneRemoteSessionsForTests();
});

describe("phone remote session store", () => {
	it("creates an expiring pairing session with a code", () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		const now = NOW.getTime();
		const session = createPhoneRemoteSession(42, urls, now);

		expect(session.id).toBeTruthy();
		expect(session.code).toMatch(/^[A-Z0-9]+$/);
		expect(session.code).toHaveLength(8);
		expect(session.status).toBe("waiting");
		expect(session.expiresAt).toBe(now + 600_000);
	});

	it("accepts laptop signals only from the owning webContents", () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		const session = createPhoneRemoteSession(42, urls, NOW.getTime());
		const offer = {
			type: "offer" as const,
			description: { type: "offer" as const, sdp: "v=0" },
		};

		expect(addLaptopSignal(session.id, 7, offer)).toBeNull();

		const envelope = addLaptopSignal(session.id, 42, offer);
		const storedSession = getPhoneRemoteSession(session.id);

		expect(envelope?.index).toBe(1);
		expect(storedSession ? getLaptopSignalsSince(storedSession, 0) : []).toHaveLength(1);
	});

	it("emits phone signal and status updates to the session owner", () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		const listener = vi.fn();
		subscribePhoneRemoteStore(listener);
		const publicSession = createPhoneRemoteSession(42, urls, NOW.getTime());
		const session = getPhoneRemoteSession(publicSession.id);

		expect(session).not.toBeNull();
		if (!session) {
			return;
		}

		addPhoneSignal(session, {
			type: "answer",
			description: { type: "answer", sdp: "v=0" },
		});
		updatePhoneRemoteStatus(session, {
			status: "mic-active",
			hasAudio: true,
			hasVideo: true,
		});

		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "signal",
				sessionId: publicSession.id,
				ownerWebContentsId: 42,
			}),
		);
		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "status",
				sessionId: publicSession.id,
				ownerWebContentsId: 42,
				status: expect.objectContaining({ status: "mic-active" }),
			}),
		);
	});

	it("refreshes the session expiry on phone status heartbeats", () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		const createdAt = NOW.getTime();
		const session = createPhoneRemoteSession(42, urls, createdAt);

		vi.setSystemTime(createdAt + 300_000);
		updatePhoneRemoteStatus(session, {
			status: "preview-live",
			hasAudio: true,
			hasVideo: true,
		});

		expect(session.expiresAt).toBe(createdAt + 900_000);
	});
});
