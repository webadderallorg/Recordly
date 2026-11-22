export interface WebcamCapture {
	stream: MediaStream;
	release: () => void;
}

interface ActiveWebcam {
	request: Promise<MediaStream>;
	stream?: MediaStream;
	users: number;
}

const activeWebcams = new Map<string | undefined, ActiveWebcam>();

export async function acquireWebcamCapture(deviceId?: string): Promise<WebcamCapture> {
	if (deviceId === "default") deviceId = undefined;
	let capture = activeWebcams.get(deviceId);
	if (!capture && deviceId) {
		capture = [...activeWebcams.values()].find(
			(candidate) =>
				candidate.stream?.active &&
				candidate.stream.getVideoTracks()[0]?.getSettings().deviceId === deviceId,
		);
		const defaultCapture = activeWebcams.get(undefined);
		if (!capture && defaultCapture && !defaultCapture.stream) {
			const pendingDefault = await retainWebcam(defaultCapture).catch(() => undefined);
			if (
				pendingDefault?.stream.active &&
				pendingDefault.stream.getVideoTracks()[0]?.getSettings().deviceId === deviceId
			) {
				return pendingDefault;
			}
			pendingDefault?.release();
			return acquireWebcamCapture(deviceId);
		}
	}
	if (!capture || capture.stream?.active === false) {
		capture = {
			request: navigator.mediaDevices.getUserMedia({
				audio: false,
				video: {
					...(deviceId && { deviceId: { exact: deviceId } }),
					width: { ideal: 1280 },
					height: { ideal: 720 },
					frameRate: { ideal: 60, max: 60 },
				},
			}),
			users: 0,
		};
		activeWebcams.set(deviceId, capture);
	}
	return retainWebcam(capture);
}

async function retainWebcam(shared: ActiveWebcam): Promise<WebcamCapture> {
	shared.users++;
	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		shared.users--;
		if (shared.users !== 0) return;
		for (const [id, webcam] of activeWebcams) {
			if (webcam === shared) activeWebcams.delete(id);
		}
		shared.stream?.getTracks().forEach((track) => track.stop());
	};

	try {
		shared.stream = await shared.request;
		return { stream: shared.stream, release };
	} catch (error) {
		release();
		throw error;
	}
}
