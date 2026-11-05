import { useI18n } from "@/contexts/I18nContext";
import { useEffect, useState } from "react";

export interface VideoDevice {
	deviceId: string;
	label: string;
	groupId: string;
}

export function useVideoDevices(enabled: boolean = true, preferredDeviceId?: string) {
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

			try {
				if (mounted && loadId === activeLoadId) {
					setIsLoading(true);
					setError(null);
				}

				const allDevices = await navigator.mediaDevices.enumerateDevices();
				const videoInputs = allDevices
					.filter((device) => device.kind === "videoinput")
					.map((device, index) => ({
						deviceId: device.deviceId,
						label:
							device.label ||
							t("notifications.camera", "Camera {{index}}", { index: index + 1 }),
						groupId: device.groupId,
					}));

				if (mounted && loadId === activeLoadId) {
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
				if (mounted && loadId === activeLoadId) {
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
	}, [enabled, preferredDeviceId, t]);

	return {
		devices,
		selectedDeviceId,
		setSelectedDeviceId,
		isLoading,
		error,
	};
}
