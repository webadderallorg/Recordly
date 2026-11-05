type UpdatePhase = "available" | "downloading" | "ready" | "error";

export function getUpdatePresentation({
	phase,
	recording,
	editorVisible,
	notifyOnOpen,
	platform,
	notificationVisible = false,
	automaticDownloads = false,
}: {
	phase?: UpdatePhase;
	recording: boolean;
	editorVisible: boolean;
	notifyOnOpen: boolean;
	platform: string;
	notificationVisible?: boolean;
	automaticDownloads?: boolean;
}): "silent" | "inline" | "notification" | "native" {
	if (!phase || recording) return "silent";
	if (notificationVisible && platform === "darwin") return "notification";
	if (phase === "downloading") return editorVisible ? "inline" : "silent";
	if (notifyOnOpen && (phase === "ready" || (phase === "available" && !automaticDownloads))) {
		return platform === "darwin" ? "notification" : "native";
	}
	if (editorVisible) return "inline";
	return "silent";
}
