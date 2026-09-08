import type { IOSCaptureSnapshot, IOSDeviceSource, IOSRecordingOptions } from "@/shared/iosCapture";
import { useScopedT } from "@/contexts/I18nContext";
import { Button } from "@/components/ui/button";
import { getIOSCapturePresentation } from "@/lib/iosCapturePresentation";

export function IOSDevicePanel({
	snapshot,
	previewUrl,
	onSelectDevice,
	onOptionsChange,
	onRetry,
	onRelease,
}: {
	snapshot: IOSCaptureSnapshot;
	previewUrl: string | null;
	onSelectDevice: (source: IOSDeviceSource) => void;
	onOptionsChange: (options: IOSRecordingOptions) => void;
	onRetry: () => void;
	onRelease: () => void;
}) {
	const t = useScopedT("launch");
	const presentation = getIOSCapturePresentation(snapshot);
	const options = snapshot.options ?? { deviceAudio: true, microphoneToken: null };
	const unavailable = snapshot.source?.deviceAudio === "unavailable";
	return (
		<section
			className="p-3 space-y-3 text-sm source-selector-text"
			aria-label={t("ios.category")}
		>
			<p role="status" aria-live="polite">
				{t(presentation.statusKey)}
			</p>
			{presentation.errorKey && <p role="alert">{t(presentation.errorKey)}</p>}
			{presentation.warningKeys.length > 0 && (
				<div role="status" aria-live="polite">
					{presentation.warningKeys.map((key) => (
						<p key={key}>{t(key)}</p>
					))}
				</div>
			)}
			{snapshot.devices.length === 0 && <p>{t("ios.empty")}</p>}
			<div className="space-y-1">
				{snapshot.devices.map((device, index) => (
					<Button
						key={device.id}
						variant="ghost"
						className="w-full justify-start"
						aria-pressed={snapshot.source?.id === device.id}
						disabled={presentation.busy}
						onClick={() => onSelectDevice(device)}
					>
						{device.displayName}
						{snapshot.devices.filter((item) => item.displayName === device.displayName)
							.length > 1
							? ` (${index + 1})`
							: ""}
					</Button>
				))}
			</div>
			{snapshot.source && (
				<>
					{previewUrl && (
						<img
							src={previewUrl}
							alt={t("ios.previewAlt")}
							className="max-h-52 w-full object-contain rounded-lg bg-black"
						/>
					)}
					<p className="text-xs source-selector-muted">{t("ios.previewQuality")}</p>
					{snapshot.format && (
						<p>
							{snapshot.format.displayWidth} × {snapshot.format.displayHeight}
							{snapshot.format.observedFrameRate !== null
								? ` · ${t("ios.observedRate", undefined, { rate: snapshot.format.observedFrameRate.toFixed(1) })}`
								: ""}
						</p>
					)}
					{snapshot.mode && <p className="text-xs">{t(`ios.mode.${snapshot.mode}`)}</p>}
					<p className="text-xs">{t("ios.orientation")}</p>
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={options.deviceAudio && !unavailable}
							disabled={presentation.busy || unavailable}
							onChange={(event) =>
								onOptionsChange({ ...options, deviceAudio: event.target.checked })
							}
						/>
						{t("ios.deviceAudio")} ·{" "}
						{t(`ios.availability.${snapshot.source.deviceAudio}`)}
					</label>
					<label className="block">
						{t("ios.narration")}
						<select
							className="mt-1 w-full rounded border border-[var(--launch-border)] bg-[var(--launch-surface)] p-2"
							value={options.microphoneToken ?? ""}
							disabled={presentation.busy}
							onChange={(event) =>
								onOptionsChange({
									...options,
									microphoneToken: event.target.value || null,
								})
							}
						>
							<option value="">{t("ios.narrationOff")}</option>
							{snapshot.microphones.map((mic) => (
								<option key={mic.token} value={mic.token}>
									{mic.label}
								</option>
							))}
						</select>
					</label>
					<p className="text-xs source-selector-muted">{t("ios.unsupportedControls")}</p>
				</>
			)}
			<details>
				<summary className="cursor-pointer focus-visible:outline">
					{t("ios.connectionHelp")}
				</summary>
				<p className="mt-2">{t("ios.help")}</p>
			</details>
			<div className="flex gap-2">
				<Button variant="outline" onClick={onRetry} disabled={presentation.busy}>
					{t("ios.refresh")}
				</Button>
				{presentation.canRelease && (
					<Button variant="ghost" onClick={onRelease}>
						{t("ios.release")}
					</Button>
				)}
			</div>
		</section>
	);
}
