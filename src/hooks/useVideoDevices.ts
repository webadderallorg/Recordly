import { useEffect, useState } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { createInputDeviceLister } from "./inputDeviceLabels";
import { acquireWebcamCapture } from "./webcamCapture";

export interface VideoDevice {
	deviceId: string;
	label: string;
	groupId: string;
}

const listCameras = createInputDeviceLister("videoinput");

export function useVideoDevices(
	enabled: boolean,
	preferredDeviceId: string | undefined,
	canRequestLabels: boolean,
) {
	const { t } = useI18n();
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
			const isCurrent = () => mounted && loadId === activeLoadId;

			try {
				if (isCurrent()) {
					setIsLoading(true);
					setError(null);
				}

				const rawVideoInputs = await listCameras(
					() => canRequestLabels && isCurrent(),
					async () => {
						try {
							return (await acquireWebcamCapture(preferredDeviceId)).release;
						} catch (error) {
							if (
								!preferredDeviceId ||
								!(error instanceof DOMException) ||
								(error.name !== "OverconstrainedError" &&
									error.name !== "NotFoundError")
							) {
								throw error;
							}
							// A newer enumeration in this effect can still be waiting for this probe.
							if (!mounted || !canRequestLabels) return undefined;
							return (await acquireWebcamCapture()).release;
						}
					},
				);

				if (isCurrent()) {
					const videoInputs = rawVideoInputs.map((device, index) => ({
						deviceId: device.deviceId,
						label:
							device.label ||
							t("notifications.camera", "Camera {{index}}", { index: index + 1 }),
						groupId: device.groupId,
					}));
					setDevices(videoInputs);
					setSelectedDeviceId((currentDeviceId) => {
						if (
							preferredDeviceId &&
							videoInputs.some((device) => device.deviceId === preferredDeviceId)
						) {
							return preferredDeviceId;
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
				if (isCurrent()) {
					const message =
						error instanceof Error
							? error.message
							: t(
									"notifications.cameraDevicesFailed",
									"Failed to enumerate video devices",
								);
					setError(message);
					console.error("Error loading video devices:", error);
				}
			} finally {
				if (isCurrent()) {
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
	}, [enabled, preferredDeviceId, canRequestLabels, t]);

	return {
		devices,
		selectedDeviceId,
		setSelectedDeviceId,
		isLoading,
		error,
	};
}
