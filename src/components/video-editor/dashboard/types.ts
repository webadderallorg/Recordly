import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";
import type { AnnouncementConfig } from "./announcementConfig";
export type DashboardProps = {
	open: boolean;
	getProtectedSourcePaths?: () => string[];
	loading?: boolean;
	libraryError?: string | null;
	onRetryLibraryLoad?: () => Promise<void>;
	onOpenChange: (open: boolean) => void;
	entries: ProjectLibraryEntry[];
	onOpenProject: (path: string) => Promise<unknown>;
	onImportFile: () => Promise<void>;
	error: string | null;
	errorSource?: string;
	errorRecordingSource?: string;
	onSignIn: () => void;
	onDeleteProjects: (
		paths: string[],
		options?: { includeSources?: boolean; protectedSources?: string[] },
	) => Promise<string[]>;
	onRenameProject: (path: string, name: string) => Promise<string>;
	onShareProject: (path: string) => Promise<void>;
	accountLabel?: string;
	accountId?: string;
	authToken?: string;
	initialSection?: "projects" | "settings";
	announcementConfig?: AnnouncementConfig;
	editorTitle?: string;
	headerLeftControlsPaddingClass?: string;
};
