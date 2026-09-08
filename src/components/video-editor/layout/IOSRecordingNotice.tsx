import { useScopedT } from "@/contexts/I18nContext";
import type { CaptureMetadata } from "@/shared/iosCapture";

const NOTICE_REASONS = new Set([
	"AUDIO_INTERRUPTED",
	"DISK_SPACE_LOW",
	"FORMAT_CHANGED",
	"DEVICE_DISCONNECTED",
	"HELPER_EXITED",
]);

/** Persistent source provenance: survives the handoff and reopening a saved project. */
export function IOSRecordingNotice({ metadata }: { metadata?: CaptureMetadata }) {
	const t = useScopedT("launch");
	if (metadata?.sourceKind !== "ios-device") return null;
	const reason = NOTICE_REASONS.has(metadata.stopReason)
		? `ios.recordingNotice.${metadata.stopReason}`
		: null;
	return (
		<section
			role="status"
			aria-live="polite"
			aria-label={t("ios.recordingNotice.label")}
			className="shrink-0 border-b border-border bg-muted/40 px-4 py-2 text-xs text-foreground"
		>
			<p className="font-medium">
				{t(
					metadata.interrupted
						? "ios.recordingNotice.interrupted"
						: "ios.recordingNotice.saved",
				)}
				{reason ? ` ${t(reason)}` : ""}
			</p>
			<p className="mt-1 text-muted-foreground">
				{t(
					metadata.deviceAudioRecorded
						? "ios.recordingNotice.deviceAudioRecorded"
						: "ios.recordingNotice.deviceAudioMissing",
				)}{" "}
				·{" "}
				{t(
					metadata.narrationRecorded
						? "ios.recordingNotice.narrationRecorded"
						: "ios.recordingNotice.narrationMissing",
				)}
			</p>
		</section>
	);
}
