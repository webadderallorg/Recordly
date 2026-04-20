export {
	createProjectData,
	deriveNextId,
	fromFileUrl,
	resolveVideoUrl,
	toFileUrl,
	validateProjectData,
} from "./projectPersistencePaths";
export { normalizeProjectEditor } from "./projectPersistenceNormalization";
export {
	PROJECT_VERSION,
	clamp,
	isFiniteNumber,
	normalizeExportBackendPreference,
	normalizeExportEncodingMode,
	normalizeExportMp4FrameRate,
	normalizeExportPipelineModel,
} from "./projectPersistenceShared";
export type { EditorProjectData, ProjectEditorState } from "./projectPersistenceShared";
