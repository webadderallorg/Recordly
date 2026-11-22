import { useEffect, useState } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { createInputDeviceLister } from "./inputDeviceLabels";

export interface MicrophoneDevice {
	deviceId: string;
	label: string;
	groupId: string;
}

const listMicrophones = createInputDeviceLister("audioinput");

export function useMicrophoneDevices(enabled: boolean = true, preferredDeviceId?: string) {
	const { t } = useI18n();
	const [devices, setDevices] = useState<MicrophoneDevice[]>([]);
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
				setIsLoading(true);
				setError(null);

				const rawAudioInputs = await listMicrophones(isCurrent, async () => {
					const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
					return () => stream.getTracks().forEach((track) => track.stop());
				});

				if (isCurrent()) {
					const audioInputs = rawAudioInputs.map((device) => ({
						deviceId: device.deviceId,
						label:
							device.label ||
							t("notifications.microphone", "Microphone {{id}}", {
								id: device.deviceId.slice(0, 8),
							}),
						groupId: device.groupId,
					}));
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
							audioInputs.find((device) => device.deviceId !== "default")?.deviceId ??
							audioInputs[0]?.deviceId ??
							"default"
						);
					});
					setIsLoading(false);
				}
			} catch (error) {
				if (isCurrent()) {
					const message =
						error instanceof Error
							? error.message
							: t(
									"notifications.microphoneDevicesFailed",
									"Failed to enumerate audio devices",
								);
					setError(message);
					setIsLoading(false);
					console.error("Error loading microphone devices:", error);
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
