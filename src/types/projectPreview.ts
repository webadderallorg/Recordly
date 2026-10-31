import type { EditorProjectData } from "@/components/video-editor/projectPersistence";
export type ProjectPreviewData = {
	project: EditorProjectData;
	videoUrl: string;
	webcamUrl: string | null;
};
