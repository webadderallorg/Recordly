export function createInputDeviceLister(kind: "audioinput" | "videoinput") {
	let attempted = false;
	let pending: Promise<MediaDeviceInfo[] | undefined> | undefined;
	const listInputs = async () =>
		(await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === kind);

	return async function listWithLabels(
		isCurrent: () => boolean,
		requestAccess: () => Promise<(() => void) | undefined>,
	): Promise<MediaDeviceInfo[]> {
		const inputs = await listInputs();
		if (!isCurrent() || inputs.some((device) => device.label.trim())) return inputs;
		if (pending) {
			const result = await pending;
			return result ?? listWithLabels(isCurrent, requestAccess);
		}
		if (attempted) return inputs;
		attempted = true;
		pending = (async () => {
			let release: (() => void) | undefined;
			try {
				release = await requestAccess();
				if (!release) {
					attempted = false;
					return undefined;
				}
				return await listInputs();
			} catch (error) {
				if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
				attempted = false;
				return await listInputs();
			} finally {
				release?.();
			}
		})().finally(() => {
			pending = undefined;
		});
		return (await pending) ?? inputs;
	};
}
