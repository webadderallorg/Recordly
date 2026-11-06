import { useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/contexts/I18nContext";
import { Button } from "@/components/ui/button";
import { DashboardFilters } from "@/components/video-editor/dashboard/DashboardFilters";
import { DashboardLibraryActions } from "@/components/video-editor/dashboard/DashboardLibraryActions";
import { useDashboardModel } from "@/components/video-editor/dashboard/useDashboardModel";
import type { ProjectLibraryEntry } from "@/components/video-editor/ProjectBrowserDialog";
import "@/index.css";

const thumbnail = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#007aff"/><rect x="20" y="20" width="120" height="80" rx="8" fill="#ffffff"/></svg>')}`;
const day = 86400000;
const now = Date.now();
const entries: ProjectLibraryEntry[] = [
	{ name: "Original copy", age: 60, source: "same" },
	{ name: "Newest copy", age: 40, source: "same" },
	{ name: "Trimmed edit", age: 60, source: "trimmed" },
	{ name: "Recent take", age: 2, source: "recent" },
	{ name: "Open project", age: 60, source: "current" },
].map(({ name, age, source }) => ({
	path: `/projects/${source === "same" ? name : source}.recordly`,
	name,
	updatedAt: now - age * day,
	createdAt: now - 100 * day,
	thumbnailPath: thumbnail,
	isCurrent: source === "current",
	isInProjectsDirectory: true,
}));
const raw = ["same.mp4", "same.mic.wav", "unused.mp4", "duplicate.mp4"].map((name) => ({
	path: `/clips/${name}`,
	name,
	bytes: 1000,
	createdAt: now - 60 * day,
	url: "",
}));
let deleted: string[] = [];
Object.assign(window, {
	electronAPI: {
		reviewProjectDeletion: async () => ({
			success: true,
			sourceCount: 1,
			preservedSourceCount: 1,
		}),
		getAppSetting: () => null,
		getRecordingThumbnail: async () => ({ success: true, value: thumbnail }),
		getProjectPreview: async (path: string) => {
			if (location.search.includes("unreadable") && path.includes("trimmed"))
				return { success: false };
			const source = path.includes("copy")
				? "same"
				: path.split("/").pop()!.replace(".recordly", "");
			return {
				success: true,
				value: {
					project: {
						version: 1,
						videoPath: `/clips/${source}.mp4`,
						editor: {
							clipRegions: [
								{
									id: "clip",
									startMs: 0,
									endMs: source === "trimmed" ? 500 : 1000,
									speed: 1,
								},
							],
						},
					},
				},
			};
		},
		probeNativeVideoMetadata: async () => ({ success: true, metadata: { duration: 1 } }),
		listRecordings: async () => ({ success: true, value: raw }),
		findDuplicateRecordingSources: async () => ({
			success: true,
			value: [["/clips/same.mp4", "/clips/duplicate.mp4"]],
		}),
		trashRecordingSources: async (paths: string[]) => {
			deleted.push(...paths);
			document.documentElement.dataset.deleted = JSON.stringify(deleted);
			return { success: true, value: { deleted: paths, errors: [] } };
		},
	},
});
function Preview() {
	const [projects, setProjects] = useState(entries);
	const model = useDashboardModel({
		open: true,
		entries: projects,
		onOpenChange: () => undefined,
		onOpenProject: async () => undefined,
		onImportFile: async () => undefined,
		error: null,
		onSignIn: () => undefined,
		onDeleteProjects: async (paths) => {
			const removed = location.search.includes("partial") ? paths.slice(0, 1) : paths;
			deleted.push(...removed);
			document.documentElement.dataset.deleted = JSON.stringify(deleted);
			setProjects((previous) => previous.filter((entry) => !removed.includes(entry.path)));
			return removed;
		},
		onRenameProject: async () => "",
		onShareProject: async () => undefined,
	});
	return (
		<main className="mx-auto mt-10 max-w-3xl">
			<DashboardFilters {...model} onCleanup={() => model.setCleanupOpen(true)} />
			<label>
				Search
				<input
					aria-label="Search"
					value={model.query}
					onChange={(event) => model.setQuery(event.target.value)}
				/>
			</label>
			<Button variant="ghost" onClick={() => model.setSection("raw")}>
				Raw files
			</Button>
			<ul aria-label="Library items">
				{model.visible.map((entry) => (
					<li key={entry.path}>
						<Button
							variant="ghost"
							aria-pressed={model.selected.includes(entry.path)}
							onClick={() => model.toggleSelected(entry.path)}
						>
							{entry.name}
						</Button>
					</li>
				))}
			</ul>
			<DashboardLibraryActions model={model} projects={projects} />
		</main>
	);
}
createRoot(document.getElementById("root")!).render(
	<I18nProvider>
		<Preview />
	</I18nProvider>,
);
