import type { CaptureMetadata } from "@/shared/iosCapture";
import { useState } from "react";
import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";
import type { EditorProjectData } from "../projectPersistence";

export function useProjectState() {
	const [captureMetadata, setCaptureMetadata] = useState<CaptureMetadata | undefined>();
	const [videoPath, setVideoPath] = useState<string | null>(null);
	const [videoSourcePath, setVideoSourcePath] = useState<string | null>(null);
	const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
	const [projectLibraryEntries, setProjectLibraryEntries] = useState<ProjectLibraryEntry[]>([]);
	const [projectBrowserOpen, setProjectBrowserOpen] = useState(false);
	const [isEditingProjectName, setIsEditingProjectName] = useState(false);
	const [projectNameDraft, setProjectNameDraft] = useState("");
	const [isSavingProjectName, setIsSavingProjectName] = useState(false);
	const [projectSaveDialogOpen, setProjectSaveDialogOpen] = useState(false);
	const [projectSaveDialogDraft, setProjectSaveDialogDraft] = useState("");
	const [isSavingProjectDialog, setIsSavingProjectDialog] = useState(false);
	const [unsavedChangesDialogOpen, setUnsavedChangesDialogOpen] = useState(false);
	const [unsavedChangesDialogActionLabel, setUnsavedChangesDialogActionLabel] =
		useState("continue");
	const [lastSavedSnapshot, setLastSavedSnapshot] = useState<EditorProjectData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	return {
		captureMetadata,
		setCaptureMetadata,
		videoPath,
		setVideoPath,
		videoSourcePath,
		setVideoSourcePath,
		currentProjectPath,
		setCurrentProjectPath,
		projectLibraryEntries,
		setProjectLibraryEntries,
		projectBrowserOpen,
		setProjectBrowserOpen,
		isEditingProjectName,
		setIsEditingProjectName,
		projectNameDraft,
		setProjectNameDraft,
		isSavingProjectName,
		setIsSavingProjectName,
		projectSaveDialogOpen,
		setProjectSaveDialogOpen,
		projectSaveDialogDraft,
		setProjectSaveDialogDraft,
		isSavingProjectDialog,
		setIsSavingProjectDialog,
		unsavedChangesDialogOpen,
		setUnsavedChangesDialogOpen,
		unsavedChangesDialogActionLabel,
		setUnsavedChangesDialogActionLabel,
		lastSavedSnapshot,
		setLastSavedSnapshot,
		loading,
		setLoading,
		error,
		setError,
	};
}
