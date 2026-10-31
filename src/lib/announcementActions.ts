import type { AnnouncementAction, AnnouncementEditorSection } from "./announcements";

export const OPEN_EDITOR_SECTION_EVENT = "recordly:open-editor-section";

export function openEditorSection(section: AnnouncementEditorSection): void {
	window.dispatchEvent(
		new CustomEvent<AnnouncementEditorSection>(OPEN_EDITOR_SECTION_EVENT, {
			detail: section,
		}),
	);
}

export async function runAnnouncementAction(
	action: AnnouncementAction,
): Promise<{ success: boolean; error?: string }> {
	if (action.section) {
		openEditorSection(action.section);
		return { success: true };
	}

	return window.electronAPI.openExternalUrl(action.url);
}
