import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/I18nContext";
import { useEffect, useState } from "react";
import type {
	StorageFolder,
	StorageFolderId,
	StorageFoldersResponse,
} from "@/types/storageFolders";
import { SettingsRow } from "../SettingsRow";

type FolderRow = {
	id: StorageFolderId;
	titleKey: string;
	titleFallback: string;
	descriptionKey: string;
	descriptionFallback: string;
};

/**
 * Listed in the order a creator meets them: where recordings land first, then
 * the files produced from a recording, then background data.
 */
const FOLDER_ROWS: FolderRow[] = [
	{
		id: "recordings",
		titleKey: "settings.storage.recordings",
		titleFallback: "Recordings",
		descriptionKey: "settings.storage.recordingsDescription",
		descriptionFallback:
			"Screen captures, system audio, microphone tracks and cursor data. Existing recordings stay where they are.",
	},
	{
		id: "projects",
		titleKey: "settings.storage.projects",
		titleFallback: "Projects and drafts",
		descriptionKey: "settings.storage.projectsDescription",
		descriptionFallback:
			"Saved .recordly projects, their previews and autosaves. Kept inside the recordings folder.",
	},
	{
		id: "exports",
		titleKey: "settings.storage.exports",
		titleFallback: "Exported videos",
		descriptionKey: "settings.storage.exportsDescription",
		descriptionFallback:
			"Folder the save dialog opens in when you export an MP4 or GIF.",
	},
	{
		id: "temp",
		titleKey: "settings.storage.temp",
		titleFallback: "Temporary files",
		descriptionKey: "settings.storage.tempDescription",
		descriptionFallback:
			"Scratch data while recording and exporting. Point this at a larger drive if your system drive is small.",
	},
	{
		id: "captionModels",
		titleKey: "settings.storage.captionModels",
		titleFallback: "Caption models",
		descriptionKey: "settings.storage.captionModelsDescription",
		descriptionFallback:
			"Downloaded speech-to-text models used for automatic captions.",
	},
	{
		id: "cache",
		titleKey: "settings.storage.cache",
		titleFallback: "Cache",
		descriptionKey: "settings.storage.cacheDescription",
		descriptionFallback:
			"Regenerated data such as wallpaper thumbnails and project previews. Safe to relocate or clear.",
	},
];

/**
 * Every folder Recordly writes into, in one place.
 *
 * The main process owns validation and persistence; this component only reflects
 * the returned folder map so the UI can never show a path the app did not accept.
 */
export function StorageLocationsSettings() {
	const { t } = useI18n();
	const [folders, setFolders] = useState<StorageFoldersResponse["folders"]>();
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState<StorageFolderId | "all" | undefined>();

	const applyResponse = (result: StorageFoldersResponse) => {
		if (!result.success || !result.folders) {
			setError(
				result.error ||
					t("settings.storage.loadFailed", "Could not read storage locations."),
			);
			return;
		}
		setError(undefined);
		setFolders(result.folders);
	};

	useEffect(() => {
		let active = true;
		void window.electronAPI
			.getStorageFolders()
			.then((result) => {
				if (active) applyResponse(result);
			})
			.catch((failure: unknown) => {
				if (active) setError(failure instanceof Error ? failure.message : String(failure));
			});
		return () => {
			active = false;
		};
		// applyResponse only closes over setState and translators, which are stable.
		// biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount.
	}, [t]);

	const run = async (id: StorageFolderId | "all", action: () => Promise<StorageFoldersResponse>) => {
		if (busy) return;
		setBusy(id);
		setError(undefined);
		try {
			applyResponse(await action());
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setBusy(undefined);
		}
	};

	if (error && !folders) {
		return (
			<p role="alert" className="text-xs text-danger">
				{error}
			</p>
		);
	}

	return (
		<div className="settings-group">
			{FOLDER_ROWS.map((row) => {
				const folder: StorageFolder | undefined = folders?.[row.id];
				return (
					<div key={row.id} className="settings-item">
						<SettingsRow
							title={t(row.titleKey, row.titleFallback)}
							descriptionInline
							description={
								<span className="settings-folder-path">
									{folder?.path ??
										t("settings.storage.loading", "Loading folder location…")}
								</span>
							}
							help={
								<>
									{t(row.descriptionKey, row.descriptionFallback)}
									{folder && !folder.configured ? (
										<>
											{" "}
											{t(
												"settings.storage.usingDefault",
												"Currently the default location.",
											)}
										</>
									) : null}
								</>
							}
						>
							<div className="settings-actions">
								<Button
									variant="secondary"
									size="sm"
									disabled={!folder || Boolean(busy)}
									onClick={() =>
										void run(row.id, () =>
											window.electronAPI.chooseStorageFolder(row.id),
										)
									}
								>
									{t("settings.storage.change", "Change…")}
								</Button>
								<Button
									variant="secondary"
									size="sm"
									disabled={!folder || Boolean(busy)}
									onClick={() =>
										void run(row.id, () =>
											window.electronAPI.openStorageFolder(row.id),
										)
									}
								>
									{t("settings.storage.open", "Open")}
								</Button>
								<Button
									variant="secondary"
									size="sm"
									disabled={!folder?.configured || Boolean(busy)}
									onClick={() =>
										void run(row.id, () =>
											window.electronAPI.resetStorageFolder(row.id),
										)
									}
								>
									{t("settings.storage.reset", "Reset")}
								</Button>
							</div>
						</SettingsRow>
					</div>
				);
			})}
			{error && (
				<p role="alert" className="settings-inline-feedback text-danger">
					{error}
				</p>
			)}
			<div className="settings-actions">
				<Button
					variant="secondary"
					size="sm"
					disabled={Boolean(busy)}
					onClick={() =>
						void run("all", () => window.electronAPI.resetAllStorageFolders())
					}
				>
					{t("settings.storage.resetAll", "Restore all default locations")}
				</Button>
			</div>
		</div>
	);
}
