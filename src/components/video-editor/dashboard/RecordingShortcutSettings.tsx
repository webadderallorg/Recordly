import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
	DEFAULT_RECORDING_SHORTCUTS,
	RECORDING_SHORTCUT_LABELS,
	type RecordingShortcutAction,
	type RecordingShortcutStatus,
} from "@/lib/recordingShortcuts";

export function RecordingShortcutSettings() {
	const [status, setStatus] = useState<RecordingShortcutStatus | null>(null);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		let active = true;
		window.electronAPI
			.getRecordingShortcuts()
			.then((value) => {
				if (active) setStatus(value);
			})
			.catch((error) => toast.error(String(error)));
		return () => {
			active = false;
		};
	}, []);
	if (!status) return null;
	const save = async (settings = status.settings) => {
		setBusy(true);
		try {
			const result = await window.electronAPI.setRecordingShortcuts(settings);
			if (!result.success) throw new Error(result.error);
			setStatus(result);
			if (!result.errors.length) toast.success("Recording shortcuts saved.");
		} catch (error) {
			toast.error(String(error));
		} finally {
			setBusy(false);
		}
	};
	return (
		<fieldset className="my-4 space-y-3" disabled={busy}>
			<legend className="text-sm font-medium">Global recording shortcuts</legend>
			<p className="text-xs text-muted-foreground">
				Work while Recordly is running, even without focus. Use Control+Alt+R,
				CommandOrControl+Alt+R, or F9. Leave blank to disable. Remote desktop must forward
				the keys.
			</p>
			{(Object.keys(RECORDING_SHORTCUT_LABELS) as RecordingShortcutAction[]).map((action) => (
				<label key={action} className="flex items-center justify-between gap-3 text-sm">
					{RECORDING_SHORTCUT_LABELS[action]}
					<input
						className="w-72 min-w-0 max-w-[50%] rounded border border-border bg-background px-2 py-1 text-xs"
						title={status.settings[action]}
						aria-label={RECORDING_SHORTCUT_LABELS[action]}
						value={status.settings[action]}
						onChange={(event) =>
							setStatus({
								...status,
								settings: { ...status.settings, [action]: event.target.value },
							})
						}
					/>
				</label>
			))}
			{status.errors.map((error) => (
				<p role="alert" key={error} className="text-xs text-danger">
					{error}
				</p>
			))}
			<div className="flex gap-2">
				<Button size="sm" variant="secondary" onClick={() => void save()}>
					Save shortcuts
				</Button>
				<Button
					size="sm"
					variant="ghost"
					onClick={() => void save({ ...DEFAULT_RECORDING_SHORTCUTS })}
				>
					Reset shortcuts
				</Button>
			</div>
		</fieldset>
	);
}
