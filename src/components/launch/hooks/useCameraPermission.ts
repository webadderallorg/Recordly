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
				const result = await window.electronAPI.getMediaPermissionStatus();
				if (!active) return;
				if (!result.success) throw new Error("Camera permission status unavailable");
				if (allowPrompt && result.camera === "not-determined") {
					setStatus("checking");
					pendingRequest.current ??= window.electronAPI
						.requestMediaPermission("camera")
						.finally(() => {
							pendingRequest.current = null;
						});
					const request = await pendingRequest.current;
					if (!request.success) throw new Error("Camera permission request failed");
					if (active) setStatus(request.granted ? "granted" : "denied");
				} else {
					setStatus(result.camera);
				}
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
