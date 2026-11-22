import { useEffect, useRef, useState } from "react";

export function useCameraPermission(
	platform: string | null,
	settingsOpen: boolean,
	enabled: boolean,
) {
	const [status, setStatus] = useState("checking");
	const pendingRequest = useRef<ReturnType<
		typeof window.electronAPI.requestMediaPermission
	> | null>(null);

	useEffect(() => {
		if (platform !== "darwin" || (!enabled && !settingsOpen)) return;
		let active = true;
		let checking = false;
		const refresh = async (allowPrompt: boolean) => {
			if (checking) return;
			checking = true;
			try {
				let request = pendingRequest.current;
				if (!request) {
					const result = await window.electronAPI.getMediaPermissionStatus();
					if (!active) return;
					if (!result.success) throw new Error("Camera permission status unavailable");
					if (allowPrompt && result.camera === "not-determined") {
						pendingRequest.current ??= window.electronAPI
							.requestMediaPermission("camera")
							.finally(() => {
								pendingRequest.current = null;
							});
					}
					request = pendingRequest.current;
					if (!request) {
						setStatus(result.camera);
						return;
					}
				}
				setStatus("checking");
				const result = await request;
				if (!result.success) throw new Error("Camera permission request failed");
				if (active) setStatus(result.granted ? "granted" : "denied");
			} catch {
				if (active) setStatus("unknown");
			} finally {
				checking = false;
			}
		};
		const onFocus = () => void refresh(false);
		void refresh(settingsOpen);
		window.addEventListener("focus", onFocus);
		return () => {
			active = false;
			window.removeEventListener("focus", onFocus);
		};
	}, [platform, settingsOpen, enabled]);

	if (platform === null) return "checking";
	return platform === "darwin" ? status : "granted";
}
