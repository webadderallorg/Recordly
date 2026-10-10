import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SettingsRow } from "@/components/video-editor/SettingsRow";

export function RecordingPermissionsSettings({ onReview }: { onReview?: () => void }) {
	const [status, setStatus] = useState<{
		mac: boolean;
		screen: boolean;
		accessibility: boolean;
	}>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const refresh = useCallback(async () => {
		setBusy(true);
		try {
			const mac = (await window.electronAPI.getPlatform()) === "darwin";
			if (mac) {
				const [screen, accessibility] = await Promise.all([
					window.electronAPI.getScreenRecordingPermissionStatus(),
					window.electronAPI.getAccessibilityPermissionStatus(),
				]);
				if (!screen.success || !accessibility.success)
					throw new Error("Could not check permissions. Please try again.");
				setStatus({
					mac,
					screen: screen.status === "granted",
					accessibility: accessibility.trusted,
				});
			} else setStatus({ mac, screen: true, accessibility: true });
			setError(undefined);
		} catch (error) {
			setError(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	}, []);
	useEffect(() => {
		void refresh();
		const check = () => void refresh();
		window.addEventListener("focus", check);
		return () => window.removeEventListener("focus", check);
	}, [refresh]);

	return (
		<div className="space-y-6">
			{!status && !error && (
				<p role="status" className="text-xs text-muted">
					Checking permissions…
				</p>
			)}
			{status?.mac && (
				<>
					{[
						{
							title: "Screen Recording",
							description: "Capture your screen, windows and selected areas.",
							granted: status.screen,
						},
						{
							title: "Accessibility",
							description: "Track your cursor and highlight clicks.",
							granted: status.accessibility,
						},
					].map(({ title, description, granted }) => (
						<SettingsRow key={title} title={title} description={description}>
							<span
								className={`text-xs font-medium ${granted ? "text-success" : "text-muted"}`}
							>
								{granted ? "Allowed" : "Required"}
							</span>
						</SettingsRow>
					))}
					<Button
						variant="secondary"
						size="sm"
						disabled={busy}
						onClick={() => void refresh()}
					>
						Check again
					</Button>
				</>
			)}
			{status && !status.mac && (
				<p className="text-xs leading-relaxed text-muted">
					Choose what to capture when you start a recording.
				</p>
			)}
			<SettingsRow
				title="Microphone and camera"
				description="Access is requested when you enable a microphone or camera for recording."
				stacked
			>
				<span className="text-xs text-muted">Requested when needed</span>
			</SettingsRow>
			{error && (
				<div className="space-y-3">
					<p role="alert" className="text-xs text-danger">
						{error}
					</p>
					<Button
						variant="secondary"
						size="sm"
						disabled={busy}
						onClick={() => void refresh()}
					>
						Try again
					</Button>
				</div>
			)}
			{onReview && (
				<SettingsRow
					title="Permission setup"
					description="Review access and open system permission settings."
					stacked
				>
					<Button variant="secondary" size="sm" onClick={onReview}>
						Review permissions
					</Button>
				</SettingsRow>
			)}
		</div>
	);
}
