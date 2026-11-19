import { SharedRecordings } from "@/components/video-editor/cloud/SharedRecordings";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/contexts/I18nContext";
import { DashboardFilters } from "@/components/video-editor/dashboard/DashboardFilters";
import { useDashboardModel } from "@/components/video-editor/dashboard/useDashboardModel";
import type { ProjectLibraryEntry } from "@/components/video-editor/ProjectBrowserDialog";
import "@/index.css";

const names = ["Short voice", "Long silent", "Medium audio", "Unavailable"];
const entries: ProjectLibraryEntry[] = names.map((name, index) => ({
	path: `/projects/${index}.recordly`,
	name,
	updatedAt: 100 - index,
	createdAt: [100, 200, 400, 300][index],
	thumbnailPath: null,
	isCurrent: false,
	isInProjectsDirectory: true,
}));
let probes = 0,
	active = 0,
	maximum = 0;

function audioUrl(seconds: number) {
	const bytes = new Uint8Array(44 + seconds * 8000).fill(128);
	const view = new DataView(bytes.buffer);
	const text = (offset: number, value: string) =>
		[...value].forEach((letter, i) => {
			bytes[offset + i] = letter.charCodeAt(0);
		});
	text(0, "RIFF");
	view.setUint32(4, bytes.length - 8, true);
	text(8, "WAVE");
	text(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, 8000, true);
	view.setUint32(28, 8000, true);
	view.setUint16(32, 1, true);
	view.setUint16(34, 8, true);
	text(36, "data");
	view.setUint32(40, bytes.length - 44, true);
	return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}
const rawEntries = [
	{
		path: "/source/1.mp4",
		name: "Silent video",
		createdAt: 5,
		bytes: 100,
		url: "unused-video-url",
	},
	{
		path: "/source/voice.wav",
		name: "Short voice",
		createdAt: 4,
		bytes: 16044,
		url: audioUrl(2),
	},
	{ path: "/source/music.wav", name: "Long voice", createdAt: 3, bytes: 40044, url: audioUrl(5) },
];
Object.assign(window, {
	electronAPI: {
		// This isolated harness supplies the native auth-store contract without a session.
		authStorageAvailable: async () => true,
		authStorageMigrate: async () => undefined,
		authStorageGetItem: async () => null,
		authStorageSetItem: async () => undefined,
		authStorageRemoveItem: async () => undefined,
		getProjectPreview: async (path: string) => {
			const id = Number(path.match(/(\d+)\.recordly$/)?.[1]);
			if (id === 3) return { success: false, error: "Offline project" };
			return {
				success: true,
				value: {
					project: {
						version: 1,
						videoPath: `/source/${id}.mp4`,
						editor: {
							clipRegions: [
								{
									id: "clip",
									startMs: 0,
									endMs: [5000, 90000, 20000][id],
									speed: 1,
								},
							],
						},
					},
				},
			};
		},
		probeNativeVideoMetadata: async (path: string) => {
			probes++;
			active++;
			maximum = Math.max(maximum, active);
			document.documentElement.dataset.probes = String(probes);
			document.documentElement.dataset.maxConcurrentProbes = String(maximum);
			await new Promise((resolve) => setTimeout(resolve, 100));
			active--;
			return {
				success: true,
				metadata: { duration: 100, hasAudio: path === "/source/0.mp4" },
			};
		},
		getVideoAudioFallbackPaths: async (path: string) => ({
			success: true,
			paths: path === "/source/2.mp4" ? ["/source/2.mic.wav"] : [],
		}),
		listRecordings: async () => ({ success: true, value: rawEntries }),
		cloudShareManage: async () => ({
			success: true,
			videos: [
				{
					code: "old",
					title: "Alpha",
					createdAt: "2026-01-01T00:00:00Z",
					size: 5,
					ready: false,
					url: `${location.origin}/s/old`,
				},
				{
					code: "new",
					title: "Beta",
					createdAt: "2026-03-01T00:00:00Z",
					size: 5,
					ready: false,
					url: `${location.origin}/s/new`,
				},
				{
					code: "mid",
					title: "Gamma",
					createdAt: "2026-02-01T00:00:00Z",
					size: 5,
					ready: false,
					url: `${location.origin}/s/mid`,
				},
			],
		}),
	},
});
document.documentElement.dataset.probes = "0";

function Preview() {
	const model = useDashboardModel({
		open: true,
		entries,
		onOpenChange: () => undefined,
		onOpenProject: async () => undefined,
		onImportFile: async () => undefined,
		error: null,
		onSignIn: () => undefined,
		onDeleteProjects: async () => [],
		onRenameProject: async () => "",
		onShareProject: async () => undefined,
	});
	return (
		<main style={{ width: 760, margin: "40px auto" }}>
			<DashboardFilters {...model} />
			<button type="button" onClick={() => model.setSection("raw")}>
				Raw files
			</button>
			<label>
				Search projects{" "}
				<input
					aria-label="Search projects"
					value={model.query}
					onChange={(event) => model.setQuery(event.target.value)}
				/>
			</label>
			<ol aria-label="Visible projects">
				{model.visible.map((entry) => (
					<li key={entry.path}>{entry.name}</li>
				))}
			</ol>
		</main>
	);
}
createRoot(document.getElementById("root")!).render(
	<I18nProvider>
		{location.search.includes("shared") ? (
			<main style={{ width: 960, margin: "40px auto" }}>
				<SharedRecordings token="test-token" endpoint={location.origin} standalone />
			</main>
		) : (
			<Preview />
		)}
	</I18nProvider>,
);
