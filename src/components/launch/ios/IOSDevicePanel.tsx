import { DeviceMobileIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import { getIOSCapturePresentation } from "@/lib/iosCapturePresentation";
import { cn } from "@/lib/utils";
import type { IOSCaptureSnapshot, IOSDeviceSource, IOSRecordingOptions } from "@/shared/iosCapture";
import { MarqueeText } from "../MarqueeText";

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
			<div className="-mx-1 space-y-0.5">
				{snapshot.devices.map((device, index) => {
					const selected = snapshot.source?.id === device.id;
					const displayName = `${device.displayName}${
						snapshot.devices.filter((item) => item.displayName === device.displayName)
							.length > 1
							? ` (${index + 1})`
							: ""
					}`;
					return (
						<button
							key={device.id}
							type="button"
							className={cn(
								"source-selector-item group min-h-[46px] w-full rounded-[11px] px-3 py-2.5 text-left font-medium flex items-center justify-start gap-3 disabled:pointer-events-none disabled:opacity-50",
								selected && "source-selector-item-selected",
							)}
							aria-label={displayName}
							aria-pressed={selected}
							disabled={presentation.busy}
							onClick={() => onSelectDevice(device)}
						>
							<div className="source-selector-thumb-fallback w-12 h-8 rounded-[8px] flex shrink-0 items-center justify-center">
								<DeviceMobileIcon
									className="w-5 h-5 source-selector-muted"
									aria-hidden="true"
								/>
							</div>
							<div className="flex-1 min-w-0 flex flex-col items-start text-left">
								<div className="text-sm font-medium source-selector-text w-full">
									<MarqueeText text={displayName} />
								</div>
								<div className="text-xs source-selector-subtle truncate w-full text-left">
									{t("ios.category")}
								</div>
							</div>
						</button>
					);
				})}
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
