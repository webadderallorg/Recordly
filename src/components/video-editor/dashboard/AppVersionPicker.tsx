import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/contexts/I18nContext";

type Version = Awaited<
	ReturnType<Window["electronAPI"]["listReleaseVersions"]>
>["versions"][number];

export function AppVersionPicker({
	currentVersion,
	disabled,
}: {
	currentVersion: string;
	disabled: boolean;
}) {
	const { t } = useI18n();
	const [open, setOpen] = useState(false);
	const [versions, setVersions] = useState<Version[]>([]);
	const [selected, setSelected] = useState("");
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(false);
	const [retry, setRetry] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly restarts a failed release lookup.
	useEffect(() => {
		if (!open) return;
		let active = true;
		setLoading(true);
		setError(false);
		void window.electronAPI
			.listReleaseVersions()
			.then((result) => {
				if (!active) return;
				if (!result.success) {
					setError(true);
					return;
				}
				setVersions(result.versions);
				setSelected(
					result.versions.find((item) => item.version === currentVersion)?.tag ??
						result.versions[0]?.tag ??
						"",
				);
			})
			.catch(() => {
				if (active) setError(true);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [open, currentVersion, retry]);
	const download = async () => {
		if (busy || loading || error || !open || !selected) return;
		setBusy(true);
		setError(false);
		try {
			const result = await window.electronAPI.downloadReleaseVersion(selected);
			if (!result.success) throw new Error("Download could not open");
			setOpen(false);
		} catch {
			setError(true);
		} finally {
			setBusy(false);
		}
	};
	return (
		<>
			<Button
				size="sm"
				variant="ghost"
				disabled={disabled || busy}
				onClick={() => setOpen(true)}
			>
				{t("settings.updates.changeVersion", "Change version")}
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>
							{t("settings.updates.changeVersion", "Change version")}
						</DialogTitle>
						<DialogDescription>
							{t(
								"settings.updates.versionInstallHint",
								"Download a release, then open its installer to change versions.",
							)}
						</DialogDescription>
					</DialogHeader>
					{loading ? (
						<p role="status">
							{t("settings.updates.loadingVersions", "Loading versions…")}
						</p>
					) : versions.length ? (
						<Select
							aria-label={t("settings.updates.version", "Version")}
							value={selected}
							onValueChange={setSelected}
							disabled={busy}
						>
							<SelectTrigger className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{versions.map((version) => (
									<SelectItem
										key={version.tag}
										value={version.tag}
										textValue={version.version}
									>
										{version.version}
										{version.prerelease
											? ` · ${t("settings.updates.prereleaseVersion", "Pre-release")}`
											: ""}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					) : (
						!error && (
							<p>
								{t(
									"settings.updates.noVersions",
									"No compatible versions are available for this installation.",
								)}
							</p>
						)
					)}
					{error && (
						<div role="alert" className="text-sm text-danger">
							{t(
								"settings.updates.versionFailed",
								"Could not load or download this version. Try again.",
							)}{" "}
							<Button
								size="sm"
								variant="ghost"
								disabled={busy || loading}
								onClick={() => setRetry((value) => value + 1)}
							>
								{t("common.actions.retry", "Try again")}
							</Button>
						</div>
					)}
					<DialogFooter>
						<Button
							disabled={loading || busy || !selected || error}
							onClick={() => void download()}
						>
							{t("settings.updates.downloadInstaller", "Download installer")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
