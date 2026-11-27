import { type Dispatch, type SetStateAction, useCallback, useMemo, useState } from "react";
import { toast } from "@/components/ui/toast";
import {
	type EditorPreset,
	type EditorPresetSnapshot,
	normalizeEditorPresetSnapshot,
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
	defaultSnapshot: EditorPresetSnapshot;
	applySnapshot: (
		snapshot: EditorPresetSnapshot,
		options?: { useDefaultWallpaper: boolean },
	) => void;
	editorPresets: EditorPreset[];
	setEditorPresets: Dispatch<SetStateAction<EditorPreset[]>>;
}

export function useEditorPresets({
	t,
	currentSnapshot,
	defaultSnapshot,
	applySnapshot,
	editorPresets,
	setEditorPresets,
}: UseEditorPresetsParams) {
	const [activePresetId, setActivePresetId] = useState<string | null>(null);
	const currentSignatures = useMemo(
		() => ({
			withWebcam: serializeEditorPresetSnapshot(currentSnapshot),
			withoutWebcam: serializeEditorPresetSnapshot({ ...currentSnapshot, webcam: undefined }),
		}),
		[currentSnapshot],
	);
	const defaultSignature = useMemo(
		() => serializeEditorPresetSnapshot(defaultSnapshot),
		[defaultSnapshot],
	);
	const savedSignatures = useMemo(
		() =>
			new Map(
				editorPresets.map(({ id, snapshot }) => [
					id,
					serializeEditorPresetSnapshot(snapshot),
				]),
			),
		[editorPresets],
	);
	const matchesDefault = currentSignatures.withoutWebcam === defaultSignature;
	const currentEditorPreset = useMemo(() => {
		const matches = ({ id, snapshot }: EditorPreset) =>
			savedSignatures.get(id) ===
			(snapshot.webcam ? currentSignatures.withWebcam : currentSignatures.withoutWebcam);
		const selected = editorPresets.find((preset) => preset.id === activePresetId);
		if (selected && matches(selected)) return selected;
		return matchesDefault ? null : (editorPresets.find(matches) ?? null);
	}, [activePresetId, currentSignatures, editorPresets, matchesDefault, savedSignatures]);

	const handleApplyDefaultPreset = useCallback(() => {
		setActivePresetId(null);
		applySnapshot(defaultSnapshot, { useDefaultWallpaper: true });
	}, [applySnapshot, defaultSnapshot]);

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
		[applySnapshot, editorPresets, t],
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
				snapshot: normalizeEditorPresetSnapshot(currentSnapshot),
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
		[currentSnapshot, editorPresets, setEditorPresets, t],
	);

	const handleDeleteEditorPreset = useCallback(
		(presetId: string) => {
			const preset = editorPresets.find((item) => item.id === presetId);
			if (!preset) return false;
			const nextPresets = editorPresets.filter((item) => item.id !== presetId);
			if (!saveEditorPresets(nextPresets)) {
				toast.error(
					t(
						"editor.presets.errors.deleteFailed",
						"Could not delete that preset. Check your browser storage settings and try again.",
					),
				);
				return false;
			}
			setEditorPresets(nextPresets);
			if (preset.id === activePresetId) setActivePresetId(null);
			toast.success(
				t("editor.presets.toasts.deleted", 'Deleted preset "{{name}}"', {
					name: preset.name,
				}),
			);
			return true;
		},
		[activePresetId, editorPresets, setEditorPresets, t],
	);

	return {
		currentEditorPreset,
		isDefaultPresetCurrent: matchesDefault && !currentEditorPreset,
		handleApplyDefaultPreset,
		handleApplyEditorPreset,
		handleDeleteEditorPreset,
		handleSaveEditorPreset,
	};
}
