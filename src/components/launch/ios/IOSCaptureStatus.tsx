import type { IOSCaptureSnapshot } from "@/shared/iosCapture";
import { getIOSCapturePresentation } from "@/lib/iosCapturePresentation";
import { useScopedT } from "@/contexts/I18nContext";
import { Button } from "@/components/ui/button";
export function IOSCaptureStatus({
	snapshot,
	onStop,
	onCancel,
}: {
	snapshot: IOSCaptureSnapshot;
	onStop: () => void;
	onCancel: () => void;
}) {
	const t = useScopedT("launch");
	const presentation = getIOSCapturePresentation(snapshot);
	return (
		<div className="flex items-center gap-3 text-xs">
			<div>
				<span role="status" aria-live="polite">
					{t(presentation.statusKey)}
				</span>
				{snapshot.source && <div>{snapshot.source.displayName}</div>}
				{presentation.errorKey && <p role="alert">{t(presentation.errorKey)}</p>}
				{presentation.warningKeys.length > 0 && (
					<div role="status" aria-live="polite" className="max-w-64 whitespace-normal">
						{presentation.warningKeys.map((key) => (
							<p key={key}>{t(key)}</p>
						))}
					</div>
				)}
			</div>
			{snapshot.phase === "recording" && (
				<>
					<span className="font-mono tabular-nums" aria-label={t("ios.elapsed")}>
						{Math.floor(snapshot.elapsedMs / 60000)}:
						{String(Math.floor(snapshot.elapsedMs / 1000) % 60).padStart(2, "0")}
					</span>
					<span>
						{t(presentation.audioStatusKey)}
						{snapshot.options?.microphoneToken
							? ` · ${t("ios.narrationRequested")}`
							: ""}
					</span>
				</>
			)}
			{presentation.canStop && (
				<Button size="sm" onClick={onStop}>
					{t("recording.stop")}
				</Button>
			)}
			{presentation.canCancel && (
				<Button size="sm" variant="ghost" onClick={onCancel}>
					{t("recording.cancel")}
				</Button>
			)}
		</div>
	);
}
