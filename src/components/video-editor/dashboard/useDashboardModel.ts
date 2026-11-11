import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { useI18n as useUiLocale } from "@/contexts/I18nContext";
import { removeProjectShareLinks } from "../cloud/projectShareLinks";
import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";
import type { SettingsSection } from "../SettingsSections";
import { deleteLibraryProjectsWithMedia } from "./deleteLibraryProjects";
import {
	compareLibraryEntries,
	defaultLibrarySortDirection,
	type LibrarySort,
	type LibrarySortDirection,
} from "./librarySort";
import type { DashboardProps } from "./types";
import { useDashboardMetadata } from "./useDashboardMetadata";
import { useLibrarySortMetadata } from "./useLibrarySortMetadata";
import { useProjectFolders } from "./useProjectFolders";
import { useRawLibrary } from "./useRawLibrary";
export function useDashboardModel({
	entries,
	loading = false,
	libraryError,
	getProtectedSourcePaths,
	onOpenChange,
	onOpenProject,
	onRenameProject,
	onDeleteProjects,
	accountId,
	authToken,
	open,
	initialSection = "projects",
}: DashboardProps) {
	const { locale, t: uiText } = useUiLocale();
	const [libraryResolved, setLibraryResolved] = useState(!loading && !libraryError);
	useEffect(() => {
		if (!loading && !libraryError) setLibraryResolved(true);
	}, [loading, libraryError]);
	const protectionGetterRef = useRef(getProtectedSourcePaths);
	protectionGetterRef.current = getProtectedSourcePaths;
	const readProtectedSources = useCallback(() => protectionGetterRef.current?.() ?? [], []);
	const { metadata, update } = useDashboardMetadata();
	const [selecting, setSelecting] = useState(false);
	const [cleanupOpen, setCleanupOpen] = useState(false);
	const [pendingDelete, setPendingDelete] = useState<ProjectLibraryEntry[]>([]);
	const [checkingDeletion, setCheckingDeletion] = useState(false);
	const [deletionReview, setDeletionReview] = useState({
		sourceCount: 0,
		preservedSourceCount: 0,
	});
	const [selected, setSelected] = useState<string[]>([]);
	const toggleSelected = (path: string) =>
		setSelected((prev) =>
			prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
		);
	const { folders, save } = useProjectFolders();
	const addToFolder = (path: string, id: string) => {
		if (busy || !entries.some((entry) => entry.path === path)) return;
		const target = folders.find((folder) => folder.id === id);
		if (!target || target.paths.includes(path)) return;
		save(
			folders.map((folder) =>
				folder.id === id ? { ...folder, paths: [...folder.paths, path] } : folder,
			),
		);
	};
	const assignFolder = (path: string, id: string) =>
		save(
			folders.map((f) => ({
				...f,
				paths:
					f.id === id
						? f.paths.includes(path)
							? f.paths.filter((p) => p !== path)
							: [...f.paths, path]
						: id === "none"
							? f.paths.filter((p) => p !== path)
							: f.paths,
			})),
		);
	const [query, setQuery] = useState("");
	const [period, setPeriod] = useState("all");
	const [sort, setSortCriterion] = useState<LibrarySort>("recent");
	const [sortDirection, setSortDirection] = useState<LibrarySortDirection>("desc");
	const setSort = (next: LibrarySort) => {
		setSortCriterion(next);
		setSortDirection(defaultLibrarySortDirection(next));
	};
	const [settingsRequest, setSettingsRequest] = useState(0);
	const [settingsCategory, setSettingsCategory] = useState<SettingsSection>("general");
	const [section, changeSection] = useState("projects");
	const [library, setLibrary] = useState("projects");
	useEffect(() => {
		if (!open) return;
		changeSection(initialSection);
		setLibrary("projects");
		setQuery("");
		setSelecting(false);
		setSelected([]);
		setCleanupOpen(false);
		setPendingDelete([]);
	}, [open, initialSection]);
	const raw = useRawLibrary(open && library === "raw", readProtectedSources);
	const [rawPreview, setRawPreview] = useState<ProjectLibraryEntry | null>(null);
	const isRaw = library === "raw";
	const setSection = (next: string) => {
		if (next === "projects" || next === "raw") setLibrary(next);
		changeSection(next);
		setQuery("");
		setSelecting(false);
		setSelected([]);
		setCleanupOpen(false);
		setPendingDelete([]);
	};
	const openSettings = (category: SettingsSection = "general") => {
		setSettingsCategory(category);
		setSettingsRequest((request) => request + 1);
		setSection("settings");
	};
	const libraryEntries = isRaw ? raw.entries : entries;
	const sortMedia = useLibrarySortMetadata(libraryEntries, sort, open);
	const activeFolder = folders.find((folder) => folder.id === section);
	const hasContentFilters = Boolean(query.trim()) || period !== "all";
	const clearFilters = () => {
		setQuery("");
		setPeriod("all");
		if (activeFolder) setSection(library);
	};
	const [busy, setBusy] = useState(false);
	const visible = useMemo(
		() =>
			libraryEntries
				.filter((entry) => {
					const cutoff =
						period === "week"
							? Date.now() - 7 * 86400000
							: period === "month"
								? Date.now() - 30 * 86400000
								: 0;
					const folder = folders.find((f) => f.id === section);
					return (
						entry.updatedAt >= cutoff &&
						entry.name
							.toLocaleLowerCase(locale)
							.includes(query.trim().toLocaleLowerCase(locale)) &&
						(!folder || folder.paths.includes(entry.path))
					);
				})
				.sort((a, b) =>
					compareLibraryEntries(
						a,
						b,
						sortMedia.loading ? "recent" : sort,
						locale,
						sortMedia.metadata,
						sortDirection,
					),
				),
		[
			libraryEntries,
			query,
			period,
			sort,
			sortDirection,
			folders,
			section,
			locale,
			sortMedia.loading,
			sortMedia.metadata,
		],
	);
	const run = async (action: () => Promise<void>) => {
		if (busy) return;
		setBusy(true);
		try {
			await action();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : uiText("ui.couldNotCompleteAction"));
		} finally {
			setBusy(false);
		}
	};
	// Selections always describe the visible result set, never hidden matches.
	useEffect(() => {
		const paths = new Set(visible.map((entry) => entry.path));
		setSelected((previous) =>
			previous.some((path) => !paths.has(path))
				? previous.filter((path) => paths.has(path))
				: previous,
		);
	}, [visible]);
	const reviewDeletion = async (paths: string[]) => {
		const counts = { sourceCount: 0, preservedSourceCount: 0 };
		for (let index = 0; index < paths.length; index += 500) {
			const result = await window.electronAPI.reviewProjectDeletion(
				paths.slice(index, index + 500),
				readProtectedSources(),
			);
			if (!result.success)
				throw new Error(result.error || uiText("ui.cleanup.deletionCheckFailed"));
			counts.sourceCount += result.sourceCount ?? 0;
			counts.preservedSourceCount += result.preservedSourceCount ?? 0;
		}
		return counts;
	};
	const deleteEntries = (paths: string[]) =>
		run(async () => {
			const items = visible.filter((entry) => paths.includes(entry.path));
			if (!items.length) return;
			setPendingDelete(items);
			if (!isRaw) {
				setCheckingDeletion(true);
				try {
					setDeletionReview(await reviewDeletion(items.map((entry) => entry.path)));
				} catch (error) {
					setPendingDelete([]);
					throw error;
				} finally {
					setCheckingDeletion(false);
				}
			}
		});
	const confirmDelete = () =>
		run(async () => {
			if (!pendingDelete.length) return;
			if (
				pendingDelete.some(
					(reviewed) =>
						!libraryEntries.some(
							(entry) =>
								entry.path === reviewed.path &&
								entry.updatedAt === reviewed.updatedAt,
						),
				)
			) {
				setPendingDelete([]);
				throw new Error(
					uiText(
						"ui.cleanup.changed",
						"The library changed. Review your selection again.",
					),
				);
			}
			const paths = pendingDelete.map((entry) => entry.path);
			const deleted: string[] = [];
			try {
				if (isRaw) {
					for (let index = 0; index < paths.length; index += 500)
						deleted.push(...(await raw.remove(paths.slice(index, index + 500))));
				} else {
					// Recheck local references before any permanent cloud mutation.
					await reviewDeletion(paths);
					const result = await deleteLibraryProjectsWithMedia({
						paths,
						allProjectPaths: entries.map((entry) => entry.path),
						accountId,
						token: authToken,
						removeLocal: async (eligible, options) => {
							const removed: string[] = [];
							for (let index = 0; index < eligible.length; index += 500) {
								const batch = await onDeleteProjects(
									eligible.slice(index, index + 500),
									{ ...options, protectedSources: readProtectedSources() },
								);
								removed.push(...batch);
								deleted.push(...batch);
							}
							return removed;
						},
					});
					if (result.errors.length) toast.error(result.errors.join("\n"));
				}
			} finally {
				if (!isRaw) removeProjectShareLinks(deleted);
				save(
					folders.map((folder) => ({
						...folder,
						paths: folder.paths.filter((path) => !deleted.includes(path)),
					})),
				);
				setSelected((current) => current.filter((path) => !deleted.includes(path)));
				if (selected.every((path) => deleted.includes(path))) setSelecting(false);
				setPendingDelete([]);
			}
		});

	const openEntry = (entry: ProjectLibraryEntry) =>
		entry.rawSource
			? setRawPreview(entry)
			: entry.isCurrent
				? onOpenChange(false)
				: void run(async () => {
						await onOpenProject(entry.path);
					});
	const navClass = (active: boolean) =>
		`h-10 w-full justify-start gap-3 px-3 text-[13px] ${active ? "bg-default/50 font-medium" : "text-muted-foreground"}`;

	return {
		initialLibraryLoading: loading && !libraryResolved && !entries.length,
		cleanupOpen,
		setCleanupOpen,
		pendingDelete,
		deletionReview,
		checkingDeletion,
		setPendingDelete,
		confirmDelete,
		libraryEntries,
		settingsCategory,
		settingsRequest,
		openSettings,
		setSettingsCategory,
		isRaw,
		rawPreview,
		setRawPreview,
		rawLoading: raw.loading,
		rawError: raw.error,
		refreshRaw: raw.refresh,
		onRenameProject: isRaw ? raw.rename : onRenameProject,
		onDeleteProjects: isRaw ? raw.remove : onDeleteProjects,
		metadata,
		update,
		selecting,
		setSelecting,
		selected,
		setSelected,
		deleteEntries,
		toggleSelected,
		assignFolder,
		addToFolder,
		query,
		hasActiveFilters: hasContentFilters || Boolean(activeFolder),
		hasContentFilters,
		activeFolder,
		clearFilters,
		setQuery,
		period,
		setPeriod,
		sort,
		sortDirection,
		setSortDirection,
		sortMetadataLoading: sortMedia.loading,
		setSort,
		section,
		setSection,
		busy,
		folders,
		save,
		visible,
		run,
		openEntry,
		navClass,
	};
}
export type DashboardModel = ReturnType<typeof useDashboardModel>;
