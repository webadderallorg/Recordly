import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";
export type DashboardProps = {
	open: boolean;
	loading?: boolean;
	onOpenChange: (open: boolean) => void;
	entries: ProjectLibraryEntry[];
	onOpenProject: (path: string) => Promise<unknown>;
	onImportFile: () => Promise<void>;
	error: string | null;
	onSignIn: () => void;
	onDeleteProjects: (paths: string[]) => Promise<string[]>;
	onRenameProject: (path: string, name: string) => Promise<string>;
	onShareProject: (path: string) => Promise<void>;
	accountLabel?: string;
	authToken?: string;
};
