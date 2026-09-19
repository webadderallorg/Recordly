const WEBCAM_WIDTH_IDEAL = 1280;
const WEBCAM_HEIGHT_IDEAL = 720;

interface WebcamAcquisition {
	promise: Promise<MediaStream>;
	deviceId: string | undefined;
	refCount: number;
	settled: boolean;
	pendingStop: boolean;
}

const acquisitions = new Set<WebcamAcquisition>();

function buildVideoConstraints(deviceId: string | undefined): MediaTrackConstraints {
	return deviceId
		? {
				deviceId: { exact: deviceId },
				width: { ideal: WEBCAM_WIDTH_IDEAL },
				height: { ideal: WEBCAM_HEIGHT_IDEAL },
			}
		: {
				width: { ideal: WEBCAM_WIDTH_IDEAL },
				height: { ideal: WEBCAM_HEIGHT_IDEAL },
			};
}

/** An unspecified request may reuse any open camera; a specific device may only reuse a match. */
function findCompatibleAcquisition(deviceId: string | undefined): WebcamAcquisition | undefined {
	for (const acquisition of acquisitions) {
		if (!deviceId || acquisition.deviceId === deviceId) {
			return acquisition;
		}
	}
	return undefined;
}

/**
 * Many UVC webcams only support a single open handle at the OS/driver level,
 * so two concurrent getUserMedia() calls for the same physical camera can
 * freeze one another or silently fail to deliver frames. This coordinator
 * dedupes concurrent webcam acquisitions across every consumer (the device
 * picker's label-unlock probe, the HUD's live preview, and the recorder) so
 * only one open request per distinct device is ever in flight, and a track is
 * only stopped once every consumer holding it has released their reference
 * *and* its getUserMedia() call has actually settled — a release that lands
 * while the call is still pending just marks it for a deferred stop, so a new
 * compatible acquire() in the meantime can cancel that and reuse the same
 * in-flight request instead of starting a competing one.
 */
export function acquireSharedWebcamStream(deviceId?: string): Promise<MediaStream> {
	const existing = findCompatibleAcquisition(deviceId);
	if (existing) {
		existing.refCount += 1;
		existing.pendingStop = false;
		return existing.promise;
	}

	const acquisition: WebcamAcquisition = {
		deviceId,
		refCount: 1,
		settled: false,
		pendingStop: false,
		promise: null as unknown as Promise<MediaStream>,
	};
	acquisition.promise = navigator.mediaDevices
		.getUserMedia({ video: buildVideoConstraints(deviceId), audio: false })
		.then((stream) => {
			acquisition.settled = true;
			if (acquisition.pendingStop) {
				acquisitions.delete(acquisition);
				stream.getTracks().forEach((track) => track.stop());
			}
			return stream;
		})
		.catch((error: unknown) => {
			acquisition.settled = true;
			acquisitions.delete(acquisition);
			throw error;
		});
	acquisitions.add(acquisition);
	return acquisition.promise;
}

/** Releases one reference obtained from {@link acquireSharedWebcamStream}. */
export function releaseSharedWebcamStream(acquisitionPromise: Promise<MediaStream>): void {
	let target: WebcamAcquisition | undefined;
	for (const acquisition of acquisitions) {
		if (acquisition.promise === acquisitionPromise) {
			target = acquisition;
			break;
		}
	}
	if (!target) {
		return;
	}

	target.refCount -= 1;
	if (target.refCount > 0) {
		return;
	}

	if (!target.settled) {
		target.pendingStop = true;
		return;
	}

	acquisitions.delete(target);
	void target.promise
		.then((stream) => {
			stream.getTracks().forEach((track) => track.stop());
		})
		.catch(() => {
			// Acquisition failed; nothing to stop.
		});
}
