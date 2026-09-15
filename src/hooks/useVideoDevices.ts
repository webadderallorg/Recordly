import { useEffect, useState } from "react";

export interface VideoDevice {
	deviceId: string;
	label: string;
	groupId: string;
}

let hasRequestedVideoLabels = false;

export function useVideoDevices(enabled: boolean = true) {
	const [devices, setDevices] = useState<VideoDevice[]>([]);
	const [selectedDeviceId, setSelectedDeviceId] = useState<string>("default");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!enabled) {
			return;
		}

		let mounted = true;
		let activeLoadId = 0;

		const loadDevices = async () => {
			const loadId = ++activeLoadId;
			let permissionStream: MediaStream | null = null;

			try {
				if (mounted && loadId === activeLoadId) {
					setIsLoading(true);
					setError(null);
				}

				let allDevices = await navigator.mediaDevices.enumerateDevices();
				let videoInputs = allDevices
					.filter((device) => device.kind === "videoinput")
					.map((device, index) => ({
						deviceId: device.deviceId,
						label: device.label || `Camera ${index + 1}`,
						groupId: device.groupId,
					}));

				// Chromium can report zero video inputs at all (not just unlabeled ones)
				// until getUserMedia() has been called at least once for this app's
				// profile. Probe with getUserMedia whenever we don't yet have a labeled
				// device list, not only when placeholder entries are present.
				const needsLabelPermission =
					videoInputs.length === 0 || videoInputs.every((device) => !device.label.trim());

				if (needsLabelPermission && !hasRequestedVideoLabels) {
					permissionStream = await navigator.mediaDevices.getUserMedia({
						video: true,
						audio: false,
					});
					allDevices = await navigator.mediaDevices.enumerateDevices();
					videoInputs = allDevices
						.filter((device) => device.kind === "videoinput")
						.map((device, index) => ({
							deviceId: device.deviceId,
							label: device.label || `Camera ${index + 1}`,
							groupId: device.groupId,
						}));
					hasRequestedVideoLabels = true;
				}

				if (mounted && loadId === activeLoadId) {
					setDevices(videoInputs);
					setSelectedDeviceId((currentDeviceId) => {
						if (currentDeviceId === "default" && videoInputs.length > 0) {
							return videoInputs[0].deviceId;
						}

						if (
							currentDeviceId !== "default" &&
							videoInputs.some((device) => device.deviceId === currentDeviceId)
						) {
							return currentDeviceId;
						}

						return videoInputs[0]?.deviceId ?? "default";
					});
				}
			} catch (error) {
				if (mounted && loadId === activeLoadId) {
					const message =
						error instanceof Error
							? error.message
							: "Failed to enumerate video devices";
					setError(message);
					console.error("Error loading video devices:", error);
				}
			} finally {
				permissionStream?.getTracks().forEach((track) => track.stop());
				if (mounted && loadId === activeLoadId) {
					setIsLoading(false);
				}
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
	}, [enabled]);

	return {
		devices,
		selectedDeviceId,
		setSelectedDeviceId,
		isLoading,
		error,
	};
}
