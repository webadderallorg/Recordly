import { useEffect, useState } from "react";
import { toast } from "@/components/ui/toast";
export const FOLDER_COLORS = ["#929292", "#de85ac", "#d6ad58", "#70ad8a", "#759bd2", "#a68ccc"];
export type ProjectFolder = { id: string; name: string; color: string; paths: string[] };
const KEY = "recordly.project-folders.v1";
export function moveProjectFolderReferences(previous: string, next: string) {
	const folders = JSON.parse(localStorage.getItem(KEY) || "[]") as ProjectFolder[];
	if (!Array.isArray(folders)) return;
	const updated = folders.map((folder) => ({
		...folder,
		paths: folder.paths.map((path) => (path === previous ? next : path)),
	}));
	localStorage.setItem(KEY, JSON.stringify(updated));
	window.dispatchEvent(new CustomEvent("recordly-folders-changed", { detail: updated }));
}
export function useProjectFolders() {
	const [folders, setFolders] = useState<ProjectFolder[]>(() => {
		try {
			const value = JSON.parse(localStorage.getItem(KEY) || "[]");
			return Array.isArray(value)
				? value.filter(
						(f) =>
							f &&
							typeof f.id === "string" &&
							typeof f.name === "string" &&
							/^#[0-9a-f]{6}$/i.test(f.color) &&
							Array.isArray(f.paths) &&
							f.paths.every((p: unknown) => typeof p === "string"),
					)
				: [];
		} catch {
			return [];
		}
	});
	useEffect(() => {
		const refresh = (event: Event) =>
			setFolders((event as CustomEvent<ProjectFolder[]>).detail);
		window.addEventListener("recordly-folders-changed", refresh);
		return () => window.removeEventListener("recordly-folders-changed", refresh);
	}, []);
	const save = (next: ProjectFolder[]) => {
		try {
			localStorage.setItem(KEY, JSON.stringify(next));
			setFolders(next);
			window.dispatchEvent(new CustomEvent("recordly-folders-changed", { detail: next }));
		} catch {
			toast.error("Could not save folders");
		}
	};
	return { folders, save };
}
