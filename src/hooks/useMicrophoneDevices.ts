import { useEffect, useState } from "react";

export interface MicrophoneDevice {
	deviceId: string;
	label: string;
	groupId: string;
}

let hasRequestedMicrophoneLabels = false;

function scoreMicrophoneDevice(device: MicrophoneDevice, index: number): number {
	const label = device.label.toLowerCase();
	let score = 1000 - index;

	if (device.deviceId === "default") score -= 200;
	if (device.deviceId === "communications") score -= 150;
	if (/\b(microphone|mic|array|usb|headset|realtek|logitech|rode|shure|blue)\b/.test(label)) {
		score += 120;
	}
	if (/\b(stereo mix|loopback|monitor|virtual|vb-audio|voicemeeter|cable|blackhole|soundflower|obs)\b/.test(label)) {
		score -= 350;
	}

	return score;
}

export function pickBestMicrophoneDevice(devices: MicrophoneDevice[]): MicrophoneDevice | null {
	if (devices.length === 0) {
		return null;
	}

	return [...devices]
		.map((device, index) => ({ device, score: scoreMicrophoneDevice(device, index) }))
		.sort((a, b) => b.score - a.score)[0]?.device ?? null;
}

export function useMicrophoneDevices(enabled: boolean = true, preferredDeviceId?: string) {
	const [devices, setDevices] = useState<MicrophoneDevice[]>([]);
	const [selectedDeviceId, setSelectedDeviceId] = useState<string>("default");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!enabled) {
			return;
		}

		let mounted = true;

		const loadDevices = async () => {
			let permissionStream: MediaStream | null = null;

			try {
				setIsLoading(true);
				setError(null);

				let allDevices = await navigator.mediaDevices.enumerateDevices();
				let audioInputs = allDevices
					.filter((device) => device.kind === "audioinput")
					.map((device) => ({
						deviceId: device.deviceId,
						label: device.label || `Microphone ${device.deviceId.slice(0, 8)}`,
						groupId: device.groupId,
					}));

				const needsLabelPermission =
					audioInputs.length > 0 && audioInputs.every((device) => !device.label.trim());

				if (needsLabelPermission && !hasRequestedMicrophoneLabels) {
					hasRequestedMicrophoneLabels = true;
					permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
					allDevices = await navigator.mediaDevices.enumerateDevices();
					audioInputs = allDevices
						.filter((device) => device.kind === "audioinput")
						.map((device) => ({
							deviceId: device.deviceId,
							label: device.label || `Microphone ${device.deviceId.slice(0, 8)}`,
							groupId: device.groupId,
						}));
				}

				if (mounted) {
					setDevices(audioInputs);
					setSelectedDeviceId((currentDeviceId) => {
						const normalizedPreferredDeviceId = preferredDeviceId ?? "default";
						if (
							audioInputs.some(
								(device) => device.deviceId === normalizedPreferredDeviceId,
							)
						) {
							return normalizedPreferredDeviceId;
						}

						if (
							currentDeviceId !== "default" &&
							audioInputs.some((device) => device.deviceId === currentDeviceId)
						) {
							return currentDeviceId;
						}

						return (
							pickBestMicrophoneDevice(audioInputs)?.deviceId ??
							"default"
						);
					});
					setIsLoading(false);
				}
			} catch (error) {
				if (mounted) {
					const message =
						error instanceof Error
							? error.message
							: "Failed to enumerate audio devices";
					setError(message);
					setIsLoading(false);
					console.error("Error loading microphone devices:", error);
				}
			} finally {
				permissionStream?.getTracks().forEach((track) => track.stop());
			}
		};

		void loadDevices();

		const handleDeviceChange = () => {
			void loadDevices();
		};

		navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

		return () => {
			mounted = false;
			navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
		};
	}, [enabled, preferredDeviceId]);

	return {
		devices,
		selectedDeviceId,
		setSelectedDeviceId,
		isLoading,
		error,
	};
}
