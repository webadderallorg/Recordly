import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { BookmarkSimple, CaretDown, Check, Pen, Plus, Trash } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import type { useI18n } from "@/contexts/I18nContext";
import type { useVideoEditorPresets } from "../presets/useVideoEditorPresets";

type Props = {
	t: ReturnType<typeof useI18n>["t"];
	presets: ReturnType<typeof useVideoEditorPresets>;
};

type View =
	| { kind: "browse" }
	| { kind: "save" }
	| { kind: "edit" }
	| { kind: "delete"; id: string; name: string };

function PresetOption({
	name,
	current,
	onSelect,
}: {
	name: string;
	current: boolean;
	onSelect: () => void;
}) {
	return (
		<Button
			type="button"
			variant={current ? "secondary" : "ghost"}
			size="sm"
			aria-current={current || undefined}
			className="h-8 w-full min-w-0 justify-start gap-2 px-2.5 text-sm"
			onPress={onSelect}
		>
			<Check
				className={current ? "size-3.5 shrink-0" : "invisible size-3.5 shrink-0"}
				aria-hidden="true"
			/>
			<span className="truncate" title={name}>
				{name}
			</span>
		</Button>
	);
}

export function EditorPresetMenu({ t, presets }: Props) {
	const {
		editorPresets,
		currentEditorPreset,
		isDefaultPresetCurrent,
		handleApplyDefaultPreset,
		handleApplyEditorPreset,
		handleDeleteEditorPreset,
		handleSaveEditorPreset,
	} = presets;
	const [open, setOpen] = useState(false);
	const [view, setView] = useState<View>({ kind: "browse" });
	const [name, setName] = useState("");
	const nameRef = useRef<HTMLInputElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);
	const editRef = useRef<HTMLButtonElement>(null);
	const saveRef = useRef<HTMLButtonElement>(null);
	const deleteButtons = useRef(new Map<string, HTMLButtonElement>());
	const previousView = useRef<View>({ kind: "browse" });
	const label = t("editor.presets.label", "Presets");
	const saveLabel = t("editor.presets.saveCurrentAs", "Save current as new");
	const editLabel = t("editor.presets.edit", "Edit");
	const nameLabel = t("editor.presets.namePlaceholder", "Preset name");
	const cancelLabel = t("common.actions.cancel", "Cancel");
	const doneLabel = t("common.actions.done", "Done");
	const editing = view.kind === "edit";

	useEffect(() => {
		const previous = previousView.current;
		if (open && previous.kind !== view.kind) {
			if (view.kind === "save") nameRef.current?.focus();
			if (view.kind === "delete") cancelRef.current?.focus();
			if (view.kind === "edit") {
				const button =
					previous.kind === "delete" ? deleteButtons.current.get(previous.id) : null;
				(button ?? editRef.current)?.focus();
			}
			if (view.kind === "browse") {
				const action = previous.kind === "edit" ? editRef : saveRef;
				action.current?.focus();
			}
		}
		previousView.current = view;
	}, [open, view]);

	const showPresets = () => {
		setView({ kind: "browse" });
		setName("");
	};
	const changeOpen = (nextOpen: boolean) => {
		setOpen(nextOpen);
		if (!nextOpen) showPresets();
	};

	return (
		<Popover open={open} onOpenChange={changeOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					type="button"
					title={t("editor.presets.open", "Open presets")}
					className="editor-header-icon-button h-9 shrink-0 gap-1.5 px-2.5 text-xs"
				>
					<BookmarkSimple className="size-4 shrink-0" weight="fill" aria-hidden="true" />
					<span className="editor-header-button-label">{label}</span>
					<CaretDown
						className="editor-header-button-label size-3 shrink-0"
						aria-hidden="true"
					/>
				</Button>
			</PopoverTrigger>

			<PopoverContent align="end" aria-label={label} className="w-[272px] p-2">
				{view.kind === "delete" ? (
					<div className="space-y-3 p-2">
						<h3 className="break-words text-sm font-medium">
							{t("editor.presets.deleteAriaLabel", "Delete preset {{name}}", {
								name: view.name,
							})}
						</h3>
						<div className="flex justify-end gap-2">
							<Button
								ref={cancelRef}
								size="sm"
								variant="ghost"
								onPress={() => setView({ kind: "edit" })}
							>
								{cancelLabel}
							</Button>
							<Button
								size="sm"
								variant="destructive"
								onPress={() => {
									if (handleDeleteEditorPreset(view.id)) {
										setView({
											kind: editorPresets.length > 1 ? "edit" : "browse",
										});
									}
								}}
							>
								{t("common.actions.delete", "Delete")}
							</Button>
						</div>
					</div>
				) : (
					<>
						{!editing && (
							<>
								<PresetOption
									name={t("editor.presets.default", "Default")}
									current={isDefaultPresetCurrent}
									onSelect={() => {
										handleApplyDefaultPreset();
										changeOpen(false);
									}}
								/>
								{editorPresets.length > 0 && <Separator className="my-1" />}
							</>
						)}
						{editorPresets.length > 0 && (
							<ul
								aria-label={t("editor.presets.savedList", "Saved presets")}
								className="custom-scrollbar max-h-56 space-y-0.5 overflow-y-auto overscroll-contain"
							>
								{editorPresets.map(({ id, name: presetName }) => {
									const current = id === currentEditorPreset?.id;
									return (
										<li key={id} className="flex min-w-0 items-center gap-1">
											{editing ? (
												<>
													<span
														className="min-w-0 flex-1 truncate px-2.5 text-sm"
														title={presetName}
													>
														{presetName}
													</span>
													<Button
														ref={(button) => {
															if (button)
																deleteButtons.current.set(
																	id,
																	button,
																);
															else deleteButtons.current.delete(id);
														}}
														type="button"
														variant="destructive-soft"
														size="icon"
														className="size-8 min-w-8 shrink-0 p-0"
														title={t(
															"editor.presets.deleteAriaLabel",
															"Delete preset {{name}}",
															{ name: presetName },
														)}
														onPress={() =>
															setView({
																kind: "delete",
																id,
																name: presetName,
															})
														}
													>
														<Trash
															className="size-3.5"
															aria-hidden="true"
														/>
													</Button>
												</>
											) : (
												<PresetOption
													name={presetName}
													current={current}
													onSelect={() => {
														handleApplyEditorPreset(id);
														changeOpen(false);
													}}
												/>
											)}
										</li>
									);
								})}
							</ul>
						)}

						{view.kind === "save" ? (
							<form
								className="space-y-2 px-1 pt-2"
								onSubmit={(event) => {
									event.preventDefault();
									if (handleSaveEditorPreset(name)) showPresets();
								}}
							>
								<Input
									ref={nameRef}
									value={name}
									onChange={(event) => setName(event.target.value)}
									className="w-full text-sm"
									placeholder={nameLabel}
									aria-label={nameLabel}
								/>
								<div className="flex justify-end gap-1">
									<Button
										type="button"
										size="sm"
										variant="ghost"
										onPress={showPresets}
									>
										{cancelLabel}
									</Button>
									<Button type="submit" size="sm" disabled={!name.trim()}>
										{t("common.actions.save", "Save")}
									</Button>
								</div>
							</form>
						) : (
							<div className="mt-1 flex min-w-0 items-center justify-between gap-1 border-t border-border/70 pt-1">
								{!editing && (
									<Button
										ref={saveRef}
										type="button"
										size="icon"
										variant="ghost"
										title={saveLabel}
										className="size-8 min-w-8 p-0"
										onPress={() => setView({ kind: "save" })}
									>
										<Plus className="size-4" aria-hidden="true" />
									</Button>
								)}
								{editorPresets.length > 0 && (
									<Button
										ref={editRef}
										type="button"
										size={editing ? "sm" : "icon"}
										variant="ghost"
										title={editing ? undefined : editLabel}
										className={
											editing ? "ml-auto" : "ml-auto size-8 min-w-8 p-0"
										}
										onPress={() =>
											editing ? showPresets() : setView({ kind: "edit" })
										}
									>
										{editing ? (
											doneLabel
										) : (
											<Pen className="size-4" aria-hidden="true" />
										)}
									</Button>
								)}
							</div>
						)}
					</>
				)}
			</PopoverContent>
		</Popover>
	);
}
