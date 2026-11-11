// A private type keeps file/text drops from being mistaken for library projects.
export const PROJECT_DRAG_TYPE = "application/x-recordly-project";

export function isProjectDrag(data: DataTransfer) {
	return Array.from(data.types).includes(PROJECT_DRAG_TYPE);
}
