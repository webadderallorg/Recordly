import { useI18n } from "@/contexts/I18nContext";
import { useEffect, useState } from "react";

export interface MicrophoneDevice {
	deviceId: string;
	label: string;
	groupId: string;
}

let hasRequestedMicrophoneLabels = false;

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
						label:
							device.label ||
							t("notifications.microphone", "Microphone {{id}}", {
								id: device.deviceId.slice(0, 8),
							}),
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
							label:
								device.label ||
								t("notifications.microphone", "Microphone {{id}}", {
									id: device.deviceId.slice(0, 8),
								}),
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
							audioInputs.find((device) => device.deviceId !== "default")?.deviceId ??
							audioInputs[0]?.deviceId ??
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
							: t(
									"notifications.microphoneDevicesFailed",
									"Failed to enumerate audio devices",
								);
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
	}, [enabled, preferredDeviceId, t]);

	return {
		devices,
		selectedDeviceId,
		setSelectedDeviceId,
		isLoading,
		error,
	};
}
