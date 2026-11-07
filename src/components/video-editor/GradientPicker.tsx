import { Button, ToggleButton } from "@heroui/react";
import { Fragment, useEffect, useState } from "react";
import { ColorControl } from "@/components/ui/color-picker";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Plus, X } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import {
	createCustomGradient,
	DEFAULT_CUSTOM_GRADIENT,
	MAX_GRADIENT_COLORS,
	normalizeCustomGradients,
	parseCustomGradient,
} from "./customGradients";
import { loadEditorPreferences, saveEditorPreferences } from "./editorPreferences";
import { SliderControl } from "./SliderControl";
import { WallpaperGlassGrid } from "./WallpaperGlassGrid";

export function GradientPicker({
	value,
	presets,
	onChange,
	onCustomChange,
	tileClassName,
	embedded = false,
	open: controlledOpen,
	onOpenChange,
}: {
	embedded?: boolean;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	value: string;
	presets: readonly string[];
	onChange: (gradient: string) => void;
	tileClassName: (selected: boolean) => string;
	onCustomChange?: () => void;
}) {
	const te = useScopedT("editing");
	const [custom, setCustom] = useState(() => loadEditorPreferences().customGradients);
	const [localOpen, setLocalOpen] = useState(false);
	const open = controlledOpen ?? localOpen;
	const setOpen = onOpenChange ?? setLocalOpen;
	const Grid = embedded ? Fragment : WallpaperGlassGrid;
	const [draft, setDraft] = useState(DEFAULT_CUSTOM_GRADIENT);
	useEffect(() => {
		if (open) setDraft(parseCustomGradient(value) ?? DEFAULT_CUSTOM_GRADIENT);
	}, [open, value]);
	const preview = createCustomGradient(draft);
	const customOptions =
		!presets.includes(value) &&
		(value.startsWith("linear-gradient(") || value.startsWith("radial-gradient(")) &&
		!custom.includes(value)
			? [...custom, value]
			: custom;
	const saveCustom = (next: string[]) => {
		const normalized = normalizeCustomGradients(next);
		setCustom(normalized);
		saveEditorPreferences({ customGradients: normalized });
		onCustomChange?.();
	};
	return (
		<>
			<Grid {...(embedded ? {} : { "aria-label": te("gradients", "Gradients") })}>
				{!embedded && (
					<Button
						variant="secondary"
						isIconOnly
						aria-label={te("createCustomGradient", "Create custom gradient")}
						className="wallpaper-tile aspect-[4/3] h-auto w-full min-w-0 overflow-hidden rounded-md p-0 text-muted"
						onPress={() => {
							setDraft(parseCustomGradient(value) ?? DEFAULT_CUSTOM_GRADIENT);
							setOpen(true);
						}}
					>
						<span
							aria-hidden="true"
							className="wallpaper-swatch wallpaper-add-surface"
						/>
						<Plus className="relative z-10 size-4" />
					</Button>
				)}
				{[
					...customOptions.map((gradient, index) => ({
						gradient,
						label: te("customGradientNumber", "Custom gradient {{number}}", {
							number: index + 1,
						}),
						removable: true,
					})),
					...presets.map((gradient, index) => ({
						gradient,
						label: te("gradientNumber", "Gradient {{number}}", { number: index + 1 }),
						removable: false,
					})),
				].map((item) => (
					<div
						key={`${item.removable ? "custom" : "preset"}-${item.gradient}`}
						className="group relative min-w-0"
					>
						<ToggleButton
							aria-label={item.label}
							isSelected={value === item.gradient}
							onChange={() => onChange(item.gradient)}
							className={`wallpaper-tile ${tileClassName(value === item.gradient)}`}
						>
							<span
								className="wallpaper-swatch absolute inset-0 rounded-[inherit]"
								style={{ background: item.gradient }}
							/>
						</ToggleButton>
						{item.removable && (
							<Button
								isIconOnly
								variant="secondary"
								aria-label={te("removeGradient", "Remove {{name}}", {
									name: item.label,
								})}
								onPress={() => {
									saveCustom(custom.filter((g) => g !== item.gradient));
									if (value === item.gradient) onChange(presets[0]);
								}}
								className="absolute right-0.5 top-0.5 z-10 size-5 min-w-0 rounded-full bg-overlay p-0 text-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
							>
								<X className="size-3" />
							</Button>
						)}
					</div>
				))}
			</Grid>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>{te("customGradient", "Custom gradient")}</DialogTitle>
					</DialogHeader>
					<div
						role="img"
						aria-label={te("gradientPreview", "Gradient preview")}
						className="h-32 rounded-xl ring-1 ring-inset ring-foreground/10"
						style={{ background: preview }}
					/>
					<div className="flex flex-col gap-2">
						{draft.colors.map((color, index) => (
							<div key={index} className="flex items-center justify-between gap-2">
								<span className="text-sm text-muted">
									{te("color", "Color")}
									{index + 1}
								</span>
								<div className="flex items-center gap-1">
									<ColorControl
										compact
										label={te("colorNumber", "Color {{number}}", {
											number: index + 1,
										})}
										value={color}
										onChange={(next) =>
											setDraft((current) => ({
												...current,
												colors: current.colors.map((c, i) =>
													i === index ? next : c,
												),
											}))
										}
									/>
									{draft.colors.length > 2 && (
										<Button
											isIconOnly
											variant="ghost"
											aria-label={te(
												"removeColorNumber",
												"Remove color {{number}}",
												{ number: index + 1 },
											)}
											className="size-8 min-w-8"
											onPress={() =>
												setDraft((current) => ({
													...current,
													colors: current.colors.filter(
														(_, i) => i !== index,
													),
												}))
											}
										>
											<X className="size-4" />
										</Button>
									)}
								</div>
							</div>
						))}
						<Button
							variant="secondary"
							size="sm"
							isDisabled={draft.colors.length >= MAX_GRADIENT_COLORS}
							onPress={() =>
								setDraft((current) => ({
									...current,
									colors: [...current.colors, "#fb7185"],
								}))
							}
						>
							<Plus className="size-4" />
							{te("addColor", "Add color")}
						</Button>
					</div>
					<SliderControl
						label={te("angle", "Angle")}
						value={draft.angle}
						min={0}
						max={360}
						step={1}
						onChange={(angle) => setDraft((current) => ({ ...current, angle }))}
						formatValue={(angle) => `${angle}°`}
					/>
					<DialogFooter>
						<Button variant="secondary" onPress={() => setOpen(false)}>
							{te("cancel", "Cancel")}
						</Button>
						<Button
							onPress={() => {
								saveCustom([preview, ...custom]);
								onChange(preview);
								setOpen(false);
							}}
						>
							{te("saveGradient", "Save gradient")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
