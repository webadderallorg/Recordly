import { BookmarkSimple, CaretDown, Check, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { useI18n } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import type { useVideoEditorPresets } from "../presets/useVideoEditorPresets";

type Props = {
	t: ReturnType<typeof useI18n>["t"];
	presets: ReturnType<typeof useVideoEditorPresets>;
};

export function EditorPresetMenu({ t, presets }: Props) {
	const {
		editorPresets,
		presetPopoverOpen,
		setPresetPopoverOpen,
		presetNameDraft,
		setPresetNameDraft,
		currentEditorPreset,
		handleApplyEditorPreset,
		handleDeleteEditorPreset,
		handleSavePresetSubmit,
	} = presets;

	return (
		<Popover open={presetPopoverOpen} onOpenChange={setPresetPopoverOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					title={t("editor.presets.open", "Open presets")}
					aria-label={t("editor.presets.open", "Open presets")}
					className="inline-flex items-center gap-1.5 bg-transparent p-0 text-sm font-medium tracking-tight text-foreground outline-none transition-opacity hover:opacity-80"
				>
					<span className="flex items-center gap-1.5">
						<BookmarkSimple weight="fill" className="h-4 w-4" />
						<span>
							{currentEditorPreset?.name ?? t("editor.presets.label", "Presets")}
						</span>
					</span>
					<CaretDown className="h-3.5 w-3.5 text-foreground" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				sideOffset={10}
				className="w-[300px] rounded-2xl border border-foreground/10 bg-editor-surface-alt p-3 shadow-xl"
			>
				<div className="space-y-3">
					<form
						onSubmit={(event) => {
							event.preventDefault();
							handleSavePresetSubmit();
						}}
						className="space-y-2"
					>
						<p className="text-[11px] font-medium text-foreground">
							{t("editor.presets.saveCurrentAs", "Save current preset as")}
						</p>
						<div className="flex items-center gap-2">
							<Input
								value={presetNameDraft}
								onChange={(event) => setPresetNameDraft(event.target.value)}
								className="h-9 rounded-xl border-foreground/10 bg-background/70 text-sm"
								placeholder={t("editor.presets.namePlaceholder", "Preset name")}
								aria-label={t("editor.presets.namePlaceholder", "Preset name")}
							/>
							<Button
								type="submit"
								size="sm"
								className="h-9 rounded-xl bg-primary px-3 text-white hover:bg-[#1d4ed8]"
							>
								{t("common.actions.save", "Save")}
							</Button>
						</div>
					</form>
					<div className="space-y-2">
						<p className="text-[11px] font-medium text-foreground">
							{t("editor.presets.savedList", "Saved presets")}
						</p>
						<div className="max-h-56 space-y-1 overflow-y-auto pr-1 custom-scrollbar">
							{editorPresets.length === 0 ? (
								<div className="rounded-xl border border-dashed border-foreground/10 px-3 py-4 text-center text-[11px] text-muted-foreground">
									{t("editor.presets.empty", "No presets yet.")}
								</div>
							) : (
								editorPresets.map((preset) => {
									const isActive = preset.id === currentEditorPreset?.id;
									return (
										<div
											key={preset.id}
											className={cn(
												"flex items-center gap-2 rounded-xl border px-2 py-2 text-sm transition-colors",
												isActive
													? "border-primary/20 bg-primary/10 text-foreground"
													: "border-foreground/8 bg-foreground/[0.03] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
											)}
										>
											<button
												type="button"
												onClick={() => handleApplyEditorPreset(preset.id)}
												className="flex min-w-0 flex-1 items-center justify-between text-left"
											>
												<span className="truncate pr-3">{preset.name}</span>
												{isActive ? (
													<Check className="h-3.5 w-3.5 shrink-0 text-primary" />
												) : null}
											</button>
											<button
												type="button"
												onClick={() => handleDeleteEditorPreset(preset.id)}
												className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground"
												aria-label={t(
													"editor.presets.deleteAriaLabel",
													"Delete preset {{name}}",
													{ name: preset.name },
												)}
												title={t(
													"editor.presets.deleteAriaLabel",
													"Delete preset {{name}}",
													{ name: preset.name },
												)}
											>
												<X className="h-3.5 w-3.5" />
											</button>
										</div>
									);
								})
							)}
						</div>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
