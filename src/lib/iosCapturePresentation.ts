import type { IOSCaptureSnapshot } from "@/shared/iosCapture";
const VISIBLE_WARNINGS = new Set([
	"AUDIO_INTERRUPTED",
	"DISK_SPACE_LOW",
	"FORMAT_CHANGED",
	"DEVICE_DISCONNECTED",
	"NO_VIDEO_SAMPLES",
	"HELPER_EXITED",
]);

export function getIOSCapturePresentation(snapshot: IOSCaptureSnapshot) {
	const ready =
		snapshot.phase === "ready" && !!snapshot.format && !!snapshot.mode && !!snapshot.sessionId;
	const phase = snapshot.phase === "ready" && !ready ? "preparing" : snapshot.phase;
	return {
		statusKey:
			phase === "idle" && snapshot.devices.length > 0
				? "ios.status.connected"
				: `ios.status.${phase}`,
		warningKeys: [
			...new Set(
				snapshot.warningCodes.map((code) =>
					VISIBLE_WARNINGS.has(code) ? `ios.warnings.${code}` : "ios.warnings.other",
				),
			),
		],
		audioStatusKey:
			snapshot.warningCodes.includes("AUDIO_INTERRUPTED") ||
			snapshot.error?.code === "AUDIO_INTERRUPTED"
				? "ios.audioInterrupted"
				: snapshot.options?.deviceAudio
					? "ios.deviceAudioRequested"
					: "ios.videoOnly",
		errorKey: snapshot.error ? `ios.errors.${snapshot.error.code}` : null,
		tone: snapshot.error ? "error" : phase === "recording" ? "recording" : "neutral",
		canRecord: ready,
		canStop: phase === "starting" || phase === "recording",
		canCancel: ["preparing", "ready", "starting", "recording"].includes(phase),
		canRelease: ["ready", "failed", "interrupted", "cancelled"].includes(phase),
		busy: ["preparing", "starting", "recording", "stopping", "finalising"].includes(phase),
	};
}
