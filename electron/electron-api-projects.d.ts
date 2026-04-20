interface ElectronAPIProjects {
	setCurrentVideoPath: (path: string) => Promise<{ success: boolean }>;
	setCurrentRecordingSession: (session: {
		videoPath: string;
		webcamPath?: string | null;
		timeOffsetMs?: number;
	}) => Promise<{ success: boolean }>;
	getCurrentRecordingSession: () => Promise<{
		success: boolean;
		session?: { videoPath: string; webcamPath?: string | null; timeOffsetMs?: number };
	}>;
	getCurrentVideoPath: () => Promise<{ success: boolean; path?: string }>;
	clearCurrentVideoPath: () => Promise<{ success: boolean }>;
	deleteRecordingFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
	getLocalMediaUrl: (filePath: string) => Promise<{ success: true; url: string } | { success: false }>;
	saveProjectFile: (
		projectData: unknown,
		suggestedName?: string,
		existingProjectPath?: string,
		thumbnailDataUrl?: string | null,
	) => Promise<{
		success: boolean;
		path?: string;
		message?: string;
		canceled?: boolean;
		error?: string;
	}>;
	loadProjectFile: () => Promise<{
		success: boolean;
		path?: string;
		project?: unknown;
		message?: string;
		canceled?: boolean;
		error?: string;
	}>;
	loadCurrentProjectFile: () => Promise<{
		success: boolean;
		path?: string;
		project?: unknown;
		message?: string;
		canceled?: boolean;
		error?: string;
	}>;
	getProjectsDirectory: () => Promise<{ success: boolean; path?: string; error?: string }>;
	listProjectFiles: () => Promise<{
		success: boolean;
		projectsDir?: string | null;
		entries: Array<{
			path: string;
			name: string;
			updatedAt: number;
			thumbnailPath: string | null;
			isCurrent: boolean;
			isInProjectsDirectory: boolean;
		}>;
		error?: string;
	}>;
	openProjectFileAtPath: (filePath: string) => Promise<{
		success: boolean;
		path?: string;
		project?: unknown;
		message?: string;
		canceled?: boolean;
		error?: string;
	}>;
	openProjectsDirectory: () => Promise<{
		success: boolean;
		path?: string;
		message?: string;
		error?: string;
	}>;
	getPlatform: () => Promise<string>;
	revealInFolder: (filePath: string) => Promise<{ success: boolean; error?: string; message?: string }>;
	openRecordingsFolder: () => Promise<{ success: boolean; error?: string; message?: string }>;
	getRecordingsDirectory: () => Promise<{
		success: boolean;
		path: string;
		isDefault: boolean;
		error?: string;
	}>;
	chooseRecordingsDirectory: () => Promise<{
		success: boolean;
		canceled?: boolean;
		path?: string;
		isDefault?: boolean;
		message?: string;
		error?: string;
	}>;
	getShortcuts: () => Promise<Record<string, unknown> | null>;
	saveShortcuts: (shortcuts: unknown) => Promise<{ success: boolean; error?: string }>;
	setHasUnsavedChanges: (hasChanges: boolean) => void;
	onRequestSaveBeforeClose: (callback: () => Promise<boolean>) => () => void;
	getAppVersion: () => Promise<string>;
}