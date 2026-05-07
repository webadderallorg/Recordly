import { ipcMain, webContents } from "electron";
import { getPhoneRemoteJoinUrls } from "../../phoneRemote/server";
import {
	addLaptopSignal,
	createPhoneRemoteSession,
	endPhoneRemoteSession,
	subscribePhoneRemoteStore,
} from "../../phoneRemote/sessionStore";
import type { PhoneRemoteSignalMessage } from "../../phoneRemote/types";

let subscribed = false;

function sendToOwner(ownerWebContentsId: number, channel: string, payload: unknown) {
	const target = webContents.fromId(ownerWebContentsId);
	if (!target || target.isDestroyed()) {
		return;
	}
	target.send(channel, payload);
}

function parseSignalMessage(value: unknown): PhoneRemoteSignalMessage | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}

	const record = value as Record<string, unknown>;
	if (record.type === "offer" || record.type === "answer") {
		const description = record.description as Record<string, unknown> | null;
		if (
			!description ||
			typeof description.type !== "string" ||
			typeof description.sdp !== "string"
		) {
			return null;
		}
		if (description.type !== "offer" && description.type !== "answer") {
			return null;
		}
		if (description.type !== record.type) {
			return null;
		}
		return {
			type: record.type,
			description: {
				type: description.type,
				sdp: description.sdp,
			},
		};
	}

	if (record.type === "ice-candidate") {
		if (record.candidate === null) {
			return {
				type: "ice-candidate",
				candidate: null,
			};
		}
		if (
			!record.candidate ||
			typeof record.candidate !== "object" ||
			Array.isArray(record.candidate)
		) {
			return null;
		}
		const candidate = record.candidate as Record<string, unknown>;
		if (typeof candidate.candidate !== "string") {
			return null;
		}
		return {
			type: "ice-candidate",
			candidate: {
				candidate: candidate.candidate,
				sdpMid: typeof candidate.sdpMid === "string" ? candidate.sdpMid : null,
				sdpMLineIndex:
					typeof candidate.sdpMLineIndex === "number" ? candidate.sdpMLineIndex : null,
				usernameFragment:
					typeof candidate.usernameFragment === "string"
						? candidate.usernameFragment
						: undefined,
			},
		};
	}

	return null;
}

export function registerPhoneRemoteHandlers() {
	if (subscribed) {
		return;
	}

	subscribed = true;
	subscribePhoneRemoteStore((event) => {
		if (event.type === "signal") {
			sendToOwner(event.ownerWebContentsId, "phone-remote-signal", {
				sessionId: event.sessionId,
				message: event.message,
			});
			return;
		}

		sendToOwner(event.ownerWebContentsId, "phone-remote-status", {
			sessionId: event.sessionId,
			status: event.status,
		});
	});

	ipcMain.handle("phone-remote:create-session", async (event) => {
		const urls = await getPhoneRemoteJoinUrls();
		const session = createPhoneRemoteSession(event.sender.id, {
			...urls,
			joinUrl: `${urls.joinUrl}?code=`,
			localJoinUrl: `${urls.localJoinUrl}?code=`,
			lanJoinUrl: `${urls.lanJoinUrl}?code=`,
			tunnelJoinUrl: urls.tunnelJoinUrl ? `${urls.tunnelJoinUrl}?code=` : undefined,
		});

		return {
			success: true,
			session: {
				...session,
				joinUrl: `${session.joinUrl}${encodeURIComponent(session.code)}`,
				localJoinUrl: `${session.localJoinUrl}${encodeURIComponent(session.code)}`,
				lanJoinUrl: `${session.lanJoinUrl}${encodeURIComponent(session.code)}`,
				tunnelJoinUrl: session.tunnelJoinUrl
					? `${session.tunnelJoinUrl}${encodeURIComponent(session.code)}`
					: undefined,
			},
		};
	});

	ipcMain.handle("phone-remote:end-session", (_event, sessionId: string) => {
		return { success: endPhoneRemoteSession(sessionId) };
	});

	ipcMain.handle("phone-remote:send-signal", (event, sessionId: string, value: unknown) => {
		const message = parseSignalMessage(value);
		if (!message) {
			return {
				success: false,
				error: "Invalid phone remote signal payload.",
			};
		}

		const envelope = addLaptopSignal(sessionId, event.sender.id, message);
		return envelope
			? { success: true, index: envelope.index }
			: { success: false, error: "Phone remote session was not found." };
	});
}
