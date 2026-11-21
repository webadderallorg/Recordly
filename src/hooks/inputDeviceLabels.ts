export function createInputDeviceLister(kind: "audioinput" | "videoinput") {
	let attempted = false;
	let pending: Promise<MediaDeviceInfo[]> | undefined;
	const listInputs = async () =>
		(await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === kind);

	return async (
		isCurrent: () => boolean,
		requestAccess: () => Promise<() => void>,
	): Promise<MediaDeviceInfo[]> => {
		const inputs = await listInputs();
		if (!isCurrent() || inputs.some((device) => device.label.trim())) return inputs;
		if (pending) return pending;
		if (attempted) return inputs;
		attempted = true;
		pending = (async () => {
			let release: (() => void) | undefined;
			try {
				release = await requestAccess();
				return await listInputs();
			} catch (error) {
				if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
				attempted = false;
				return inputs;
			} finally {
				release?.();
			}
		})().finally(() => {
			pending = undefined;
		});
		return pending;
	};
}
