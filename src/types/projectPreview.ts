import type { EditorProjectData } from "@/components/video-editor/projectPersistence";
export type ProjectPreviewData = {
	project: EditorProjectData;
	/** Opaque source revision used only for guarded thumbnail cache writes. */
	revision?: string;
	videoUrl: string;
	webcamUrl: string | null;
	/** Filesystem-resolved dependencies for cleanup; includes audio and webcam. */
	sourcePaths?: string[];
	sourcePathsComplete?: boolean;
};
