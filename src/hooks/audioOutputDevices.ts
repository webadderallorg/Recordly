import { useEffect, useState } from "react";

export interface AudioOutputDevice {
	deviceId: string;
	label: string;
	groupId: string;
}

export interface AudioOutputDeviceSelection {
	deviceId: string;
	label: string;
}

export interface NativeAudioOutputDevice {
	deviceId: string;
	label: string;
}

export function isLatestAudioOutputDeviceRequest(
	requestId: number,
	latestRequestId: number,
): boolean {
	return requestId === latestRequestId;
}

const DEFAULT_OUTPUT_DEVICE: AudioOutputDevice = {
	deviceId: "default",
	label: "Default output",
	groupId: "",
};

export function resolveAudioOutputDeviceSelection(
	devices: AudioOutputDevice[],
	preferredDeviceId?: string,
	preferredLabel?: string,
): AudioOutputDeviceSelection {
	if (preferredDeviceId) {
		const exactMatch = devices.find((device) => device.deviceId === preferredDeviceId);
		if (exactMatch) {
			return { deviceId: exactMatch.deviceId, label: exactMatch.label };
		}
	}

	if (preferredLabel) {
		const labelMatch = devices.find((device) => device.label === preferredLabel);
		if (labelMatch) {
			return { deviceId: labelMatch.deviceId, label: labelMatch.label };
		}
	}

	const defaultDevice = devices.find((device) => device.deviceId === "default");
	if (defaultDevice) {
		return { deviceId: defaultDevice.deviceId, label: defaultDevice.label };
	}

	const firstDevice = devices[0];
	return firstDevice
		? { deviceId: firstDevice.deviceId, label: firstDevice.label }
		: { deviceId: DEFAULT_OUTPUT_DEVICE.deviceId, label: DEFAULT_OUTPUT_DEVICE.label };
}

function mapAudioOutputDevices(mediaDevices: MediaDeviceInfo[]): AudioOutputDevice[] {
	return mediaDevices
		.filter((device) => device.kind === "audiooutput")
		.map((device) => ({
			deviceId: device.deviceId,
			label: device.label || `Output ${device.deviceId.slice(0, 8)}`,
			groupId: device.groupId,
		}));
}

const AUDIO_OUTPUT_ROLE_PREFIX = /^(?:default|communications)\s*-\s*/i;
const AUDIO_OUTPUT_USB_ID_SUFFIX = /\s+\(([0-9a-f]{4}):([0-9a-f]{4})\)$/i;

function normalizeBrowserAudioOutputLabel(label: string): string | null {
	const withoutRolePrefix = label.trim().replace(AUDIO_OUTPUT_ROLE_PREFIX, "");
	const usbIdMatch = withoutRolePrefix.match(AUDIO_OUTPUT_USB_ID_SUFFIX);
	if (!usbIdMatch || usbIdMatch.index === undefined) {
		return null;
	}

	const baseLabel = withoutRolePrefix.slice(0, usbIdMatch.index).trim();
	return `${baseLabel} (${usbIdMatch[1].toLowerCase()}:${usbIdMatch[2].toLowerCase()})`;
}

export function getDefaultAudioOutputLabel(browserDevices: AudioOutputDevice[]): string {
	const browserDefaultDevice = browserDevices.find(
		(device) => device.deviceId === "default" || /^default\s*-\s*/i.test(device.label),
	);
	if (!browserDefaultDevice) {
		return DEFAULT_OUTPUT_DEVICE.label;
	}

	const rawLabel = browserDefaultDevice.label.trim();
	if (!rawLabel || /^output\s+default$/i.test(rawLabel)) {
		return DEFAULT_OUTPUT_DEVICE.label;
	}

	const normalizedLabel =
		normalizeBrowserAudioOutputLabel(browserDefaultDevice.label) ??
		browserDefaultDevice.label.trim().replace(AUDIO_OUTPUT_ROLE_PREFIX, "").trim();
	return `Default - ${normalizedLabel}`;
}

export function enrichNativeAudioOutputLabels(
	nativeDevices: NativeAudioOutputDevice[],
	browserDevices: AudioOutputDevice[],
): NativeAudioOutputDevice[] {
	return nativeDevices.map((nativeDevice) => {
		const nativeLabel = nativeDevice.label.trim();
		const matchingBrowserDevice = browserDevices.find((browserDevice) => {
			const enrichedLabel = normalizeBrowserAudioOutputLabel(browserDevice.label);
			if (!enrichedLabel) {
				return false;
			}

			const usbIdStart = enrichedLabel.lastIndexOf(" (");
			return enrichedLabel.slice(0, usbIdStart).trim() === nativeLabel;
		});

		if (!matchingBrowserDevice) {
			return nativeDevice;
		}

		return {
			...nativeDevice,
			label:
				normalizeBrowserAudioOutputLabel(matchingBrowserDevice.label) ?? nativeDevice.label,
		};
	});
}

function mapNativeAudioOutputDevices(
	devices: NativeAudioOutputDevice[],
	browserDevices: AudioOutputDevice[],
): AudioOutputDevice[] {
	return enrichNativeAudioOutputLabels(devices, browserDevices).map((device) => ({
		deviceId: device.deviceId,
		label: device.label,
		groupId: "",
	}));
}

export function useAudioOutputDevices(
	enabled: boolean = true,
	preferredDeviceId?: string,
	preferredLabel?: string,
) {
	const [devices, setDevices] = useState<AudioOutputDevice[]>([]);
	const [selectedDeviceId, setSelectedDeviceId] = useState("default");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!enabled || !navigator.mediaDevices) {
			return;
		}

		let mounted = true;
		let latestRequestId = 0;
		const loadDevices = async () => {
			const requestId = ++latestRequestId;
			try {
				setIsLoading(true);
				setError(null);
				const browserOutputs = mapAudioOutputDevices(
					await navigator.mediaDevices.enumerateDevices(),
				);
				let outputs = browserOutputs;
				try {
					const nativeOutputs = await window.electronAPI?.getNativeAudioOutputDevices?.();
					if (nativeOutputs && nativeOutputs.length > 0) {
						outputs = mapNativeAudioOutputDevices(nativeOutputs, browserOutputs);
					}
				} catch {
					// Browser enumeration remains a usable fallback when the native helper is unavailable.
				}

				if (!outputs.some((device) => device.deviceId === "default")) {
					outputs = [
						{
							...DEFAULT_OUTPUT_DEVICE,
							label: getDefaultAudioOutputLabel(browserOutputs),
						},
						...outputs,
					];
				}

				if (!mounted || !isLatestAudioOutputDeviceRequest(requestId, latestRequestId)) {
					return;
				}

				setDevices(outputs);
				setSelectedDeviceId((currentDeviceId) => {
					const selection = resolveAudioOutputDeviceSelection(
						outputs,
						preferredDeviceId ?? currentDeviceId,
						preferredLabel,
					);
					return selection.deviceId;
				});
				setIsLoading(false);
			} catch (loadError) {
				if (!mounted || !isLatestAudioOutputDeviceRequest(requestId, latestRequestId)) {
					return;
				}
				const message =
					loadError instanceof Error
						? loadError.message
						: "Failed to enumerate audio output devices";
				setError(message);
				setIsLoading(false);
				console.error("Error loading audio output devices:", loadError);
			}
		};

		void loadDevices();
		const handleDeviceChange = () => {
			void loadDevices();
		};
		navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

		return () => {
			mounted = false;
			latestRequestId += 1;
			navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
		};
	}, [enabled, preferredDeviceId, preferredLabel]);

	const selectedDevice = resolveAudioOutputDeviceSelection(
		devices,
		selectedDeviceId,
		preferredLabel,
	);

	return {
		devices,
		selectedDeviceId: selectedDevice.deviceId,
		selectedDevice,
		setSelectedDeviceId,
		isLoading,
		error,
	};
}
