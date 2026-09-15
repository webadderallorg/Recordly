const WEBCAM_WIDTH_IDEAL = 1280;
const WEBCAM_HEIGHT_IDEAL = 720;

interface WebcamAcquisition {
	promise: Promise<MediaStream>;
	deviceId: string | undefined;
	refCount: number;
}

let active: WebcamAcquisition | null = null;

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

/**
 * Many UVC webcams only support a single open handle at the OS/driver level,
 * so two concurrent getUserMedia() calls for the same physical camera can
 * freeze one another or silently fail to deliver frames. This coordinator
 * dedupes concurrent webcam acquisitions across every consumer (the device
 * picker's label-unlock probe, the HUD's live preview, and the recorder) so
 * only one open request against the camera is ever in flight, and the
 * underlying track is only stopped once every consumer has released it.
 */
export function acquireSharedWebcamStream(deviceId?: string): Promise<MediaStream> {
	if (active && (!deviceId || !active.deviceId || active.deviceId === deviceId)) {
		active.refCount += 1;
		return active.promise;
	}

	const acquisition: WebcamAcquisition = {
		deviceId,
		refCount: 1,
		promise: null as unknown as Promise<MediaStream>,
	};
	acquisition.promise = navigator.mediaDevices
		.getUserMedia({ video: buildVideoConstraints(deviceId), audio: false })
		.catch((error: unknown) => {
			if (active === acquisition) {
				active = null;
			}
			throw error;
		});
	active = acquisition;
	return acquisition.promise;
}

/** Releases one reference obtained from {@link acquireSharedWebcamStream}. */
export function releaseSharedWebcamStream(acquisitionPromise: Promise<MediaStream>): void {
	if (!active || active.promise !== acquisitionPromise) {
		return;
	}

	active.refCount -= 1;
	if (active.refCount > 0) {
		return;
	}

	const acquisition = active;
	active = null;
	void acquisition.promise
		.then((stream) => {
			stream.getTracks().forEach((track) => track.stop());
		})
		.catch(() => {
			// Acquisition failed; nothing to stop.
		});
}
