import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo } from "react";
import { toast } from "@/components/ui/toast";
import {
	type EditorPreset,
	type EditorPresetSnapshot,
	saveEditorPresets,
	serializeEditorPresetSnapshot,
} from "../editorPreferences";

type Translator = (
	key: string,
	fallback?: string,
	params?: Record<string, string | number>,
) => string;

interface UseEditorPresetsParams {
	t: Translator;
	currentSnapshot: EditorPresetSnapshot;
	applySnapshot: (snapshot: EditorPresetSnapshot) => void;
	editorPresets: EditorPreset[];
	setEditorPresets: Dispatch<SetStateAction<EditorPreset[]>>;
	activePresetId: string | null;
	setActivePresetId: Dispatch<SetStateAction<string | null>>;
	presetPopoverOpen: boolean;
	presetNameDraft: string;
	setPresetNameDraft: Dispatch<SetStateAction<string>>;
}

export function useEditorPresets({
	t,
	currentSnapshot,
	applySnapshot,
	editorPresets,
	setEditorPresets,
	activePresetId,
	setActivePresetId,
	presetPopoverOpen,
	presetNameDraft,
	setPresetNameDraft,
}: UseEditorPresetsParams) {
	const currentSignature = useMemo(
		() => serializeEditorPresetSnapshot(currentSnapshot),
		[currentSnapshot],
	);
	const currentEditorPreset = useMemo(
		() => editorPresets.find((preset) => preset.id === activePresetId) ?? null,
		[activePresetId, editorPresets],
	);

	useEffect(() => {
		if (
			currentEditorPreset &&
			serializeEditorPresetSnapshot(currentEditorPreset.snapshot) === currentSignature
		) {
			return;
		}

		const matchingPreset =
			editorPresets.find(
				(preset) => serializeEditorPresetSnapshot(preset.snapshot) === currentSignature,
			) ?? null;
		const nextActiveId = matchingPreset?.id ?? null;
		if (nextActiveId !== activePresetId) setActivePresetId(nextActiveId);
	}, [activePresetId, currentEditorPreset, currentSignature, editorPresets, setActivePresetId]);

	useEffect(() => {
		if (!presetPopoverOpen) setPresetNameDraft("");
	}, [presetPopoverOpen, setPresetNameDraft]);

	const handleApplyEditorPreset = useCallback(
		(presetId: string) => {
			const preset = editorPresets.find((item) => item.id === presetId);
			if (!preset) return;
			setActivePresetId(preset.id);
			applySnapshot(preset.snapshot);
			toast.success(
				t("editor.presets.toasts.applied", 'Applied preset "{{name}}"', {
					name: preset.name,
				}),
			);
		},
		[applySnapshot, editorPresets, setActivePresetId, t],
	);

	const handleSaveEditorPreset = useCallback(
		(name: string) => {
			const normalizedName = name.trim().replace(/\s+/g, " ");
			if (!normalizedName) {
				toast.error(t("editor.presets.errors.nameRequired", "Enter a preset name."));
				return false;
			}
			if (
				editorPresets.some(
					(preset) =>
						preset.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase(),
				)
			) {
				toast.error(
					t(
						"editor.presets.errors.duplicateName",
						"A preset with that name already exists.",
					),
				);
				return false;
			}

			const timestamp = new Date().toISOString();
			const nextPreset: EditorPreset = {
				id: crypto.randomUUID(),
				name: normalizedName,
				createdAt: timestamp,
				updatedAt: timestamp,
				snapshot: currentSnapshot,
			};
			const nextPresets = [nextPreset, ...editorPresets];
			if (!saveEditorPresets(nextPresets)) {
				toast.error(
					t(
						"editor.presets.errors.saveFailed",
						"Could not save that preset. Check your browser storage settings and try again.",
					),
				);
				return false;
			}
			setEditorPresets(nextPresets);
			setActivePresetId(nextPreset.id);
			toast.success(
				t("editor.presets.toasts.saved", 'Saved preset "{{name}}"', {
					name: normalizedName,
				}),
			);
			return true;
		},
		[currentSnapshot, editorPresets, setActivePresetId, setEditorPresets, t],
	);

	const handleDeleteEditorPreset = useCallback(
		(presetId: string) => {
			const preset = editorPresets.find((item) => item.id === presetId);
			if (!preset) return;
			const nextPresets = editorPresets.filter((item) => item.id !== presetId);
			if (!saveEditorPresets(nextPresets)) {
				toast.error(
					t(
						"editor.presets.errors.deleteFailed",
						"Could not delete that preset. Check your browser storage settings and try again.",
					),
				);
				return;
			}
			setEditorPresets(nextPresets);
			if (preset.id === activePresetId) setActivePresetId(null);
			toast.success(
				t("editor.presets.toasts.deleted", 'Deleted preset "{{name}}"', {
					name: preset.name,
				}),
			);
		},
		[activePresetId, editorPresets, setActivePresetId, setEditorPresets, t],
	);

	const handleSavePresetSubmit = useCallback(() => {
		if (handleSaveEditorPreset(presetNameDraft)) setPresetNameDraft("");
	}, [handleSaveEditorPreset, presetNameDraft, setPresetNameDraft]);

	return {
		currentEditorPreset,
		handleApplyEditorPreset,
		handleDeleteEditorPreset,
		handleSavePresetSubmit,
	};
}
