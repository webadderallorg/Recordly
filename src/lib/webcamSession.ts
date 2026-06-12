/**
 * Shared webcam session manager.
 *
 * The camera must be opened exactly once per (device, frame rate) and shared
 * between every consumer (floating preview, recorder). Opening a second
 * getUserMedia with different constraints — or stopping one of two concurrent
 * sessions — makes Chromium restart the physical capture device to
 * renegotiate its format. During that restart the surviving tracks deliver no
 * frames; slow-to-renegotiate cameras (iPhone Continuity Camera in
 * particular) stall for 3–12 seconds, which previously left multi-second
 * frame gaps baked into recorded webcam files.
 *
 * Consumers acquire a handle and release it when done. The underlying stream
 * is only stopped once every handle has been released, so a recorder holding
 * the session keeps the device alive across preview hide/show and popover
 * open/close transitions.
 */

export type WebcamFrameRate = 24 | 30 | 60;

export const DEFAULT_WEBCAM_FRAME_RATE: WebcamFrameRate = 30;

export const WEBCAM_FRAME_RATE_OPTIONS: WebcamFrameRate[] = [24, 30, 60];

export function coerceWebcamFrameRate(value: unknown): WebcamFrameRate {
	return WEBCAM_FRAME_RATE_OPTIONS.includes(value as WebcamFrameRate)
		? (value as WebcamFrameRate)
		: DEFAULT_WEBCAM_FRAME_RATE;
}

const WEBCAM_IDEAL_WIDTH = 3840;
const WEBCAM_IDEAL_HEIGHT = 2160;

export function createWebcamSessionConstraints(
	webcamDeviceId: string | undefined,
	frameRate: WebcamFrameRate,
): MediaTrackConstraints {
	return {
		...(webcamDeviceId ? { deviceId: { exact: webcamDeviceId } } : {}),
		aspectRatio: { ideal: 16 / 9 },
		resizeMode: "none",
		width: { ideal: WEBCAM_IDEAL_WIDTH, min: 1920 },
		height: { ideal: WEBCAM_IDEAL_HEIGHT, min: 1080 },
		frameRate: { ideal: frameRate, max: frameRate },
	} as MediaTrackConstraints;
}

export interface WebcamSessionHandle {
	/** The shared camera stream. Do NOT stop its tracks; call release(). */
	stream: MediaStream;
	release: () => void;
}

type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

interface ActiveSession {
	key: string;
	stream: MediaStream | null;
	refCount: number;
	/** Pending acquire shared by concurrent callers before the stream exists. */
	pending: Promise<MediaStream> | null;
}

let activeSession: ActiveSession | null = null;

function sessionKey(deviceId: string | undefined, frameRate: WebcamFrameRate): string {
	return `${deviceId ?? "default"}@${frameRate}`;
}

function stopSession(session: ActiveSession): void {
	for (const track of session.stream?.getTracks() ?? []) {
		track.stop();
	}
	if (activeSession === session) {
		activeSession = null;
	}
}

/**
 * Acquire the shared webcam stream for the given device and frame rate.
 *
 * Concurrent and repeated acquires with the same parameters share one
 * underlying getUserMedia stream. Acquiring with different parameters while
 * no other consumer holds the session restarts it; if other consumers still
 * hold the old session the new acquire reuses it instead of forcing a device
 * renegotiation mid-use (the recorder's format wins for the session's
 * lifetime).
 */
export async function acquireWebcamSession(
	webcamDeviceId: string | undefined,
	frameRate: WebcamFrameRate,
	getUserMediaImpl?: GetUserMedia,
): Promise<WebcamSessionHandle> {
	const getUserMedia =
		getUserMediaImpl ??
		((constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints));
	const key = sessionKey(webcamDeviceId, frameRate);

	if (activeSession) {
		const keyMatches = activeSession.key === key;
		// A session whose tracks have ended (camera unplugged, Continuity
		// Camera phone locked or out of range) must never be reused — handing
		// out the dead stream would black-screen every consumer until restart.
		const streamAlive =
			activeSession.pending !== null ||
			(activeSession.stream?.getVideoTracks().some((track) => track.readyState === "live") ??
				false);
		// Reuse a live mismatched session rather than opening a second camera
		// pipeline — a parallel session with different constraints is exactly
		// what triggers the device renegotiation stall this module prevents.
		const reusable = streamAlive && (keyMatches || activeSession.refCount > 0);
		if (reusable) {
			const session = activeSession;
			session.refCount += 1;
			try {
				const stream = session.pending ? await session.pending : session.stream;
				if (!stream) {
					throw new Error("Webcam session has no active stream");
				}
				return createHandle(session, stream);
			} catch (error) {
				session.refCount -= 1;
				throw error;
			}
		}
		stopSession(activeSession);
	}

	const session: ActiveSession = {
		key,
		stream: null,
		refCount: 1,
		pending: null,
	};
	activeSession = session;

	session.pending = getUserMedia({
		video: createWebcamSessionConstraints(webcamDeviceId, frameRate),
		audio: false,
	});

	let stream: MediaStream;
	try {
		stream = await session.pending;
	} catch (error) {
		if (activeSession === session) {
			activeSession = null;
		}
		throw error;
	}

	session.stream = stream;
	session.pending = null;

	// Every consumer may have released while getUserMedia was in flight.
	if (session.refCount <= 0) {
		stopSession(session);
		return createHandle(session, stream, { alreadyReleased: true });
	}

	return createHandle(session, stream);
}

function createHandle(
	session: ActiveSession,
	stream: MediaStream,
	{ alreadyReleased = false }: { alreadyReleased?: boolean } = {},
): WebcamSessionHandle {
	let released = alreadyReleased;
	return {
		stream,
		release: () => {
			if (released) {
				return;
			}
			released = true;
			session.refCount -= 1;
			if (session.refCount <= 0 && !session.pending) {
				stopSession(session);
			}
		},
	};
}

/** Test-only: drop the module-level session state. */
export function resetWebcamSessionForTests(): void {
	if (activeSession) {
		stopSession(activeSession);
	}
	activeSession = null;
}
