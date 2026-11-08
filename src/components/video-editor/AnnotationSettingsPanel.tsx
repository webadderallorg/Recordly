import { Card, ToggleButton } from "@heroui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceGroup, ChoiceItem } from "@/components/ui/choice-group";
import { ColorControl, ColorPalette } from "@/components/ui/color-picker";
import {
	ImageSquare as ImageIcon,
	Info,
	BoundingBox as SquareDashed,
	Trash as Trash2,
	TextT as Type,
	UploadSimple as Upload,
} from "@/components/ui/icons";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/components/ui/toast";
import { type CustomFont, getCustomFonts } from "@/lib/customFonts";
import { cn } from "@/lib/utils";
import { useScopedT } from "../../contexts/I18nContext";
import { getArrowComponent } from "./ArrowSvgs";
import { AnnotationTextSettings } from "./settings/AnnotationTextSettings";
import type { AnnotationRegion, AnnotationType, ArrowDirection, FigureData } from "./types";

interface AnnotationSettingsPanelProps {
	annotation: AnnotationRegion;
	onContentChange: (content: string) => void;
	onTypeChange: (type: AnnotationType) => void;
	onStyleChange: (style: Partial<AnnotationRegion["style"]>) => void;
	onFigureDataChange?: (figureData: FigureData) => void;
	onBlurIntensityChange?: (intensity: number) => void;
	onBlurColorChange?: (color: string) => void;
	onDelete: () => void;
}

export const FONT_FAMILY_VALUES = [
	{ value: "system-ui, -apple-system, sans-serif", labelKey: "fontStyles.classic" },
	{ value: "Georgia, serif", labelKey: "fontStyles.editor" },
	{ value: "Impact, Arial Black, sans-serif", labelKey: "fontStyles.strong" },
	{ value: "Courier New, monospace", labelKey: "fontStyles.typewriter" },
	{ value: "Brush Script MT, cursive", labelKey: "fontStyles.deco" },
	{ value: "Arial, sans-serif", labelKey: "fontStyles.simple" },
	{ value: "Verdana, sans-serif", labelKey: "fontStyles.modern" },
	{ value: "Trebuchet MS, sans-serif", labelKey: "fontStyles.clean" },
];

export { FONT_SIZES } from "./settings/AnnotationTextSettings";

export function AnnotationSettingsPanel({
	annotation,
	onContentChange,
	onTypeChange,
	onStyleChange,
	onFigureDataChange,
	onBlurIntensityChange,
	onBlurColorChange,
	onDelete,
}: AnnotationSettingsPanelProps) {
	const te = useScopedT("editing");
	const t = useScopedT("editor");
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);

	const fontFamilies = useMemo(
		() => FONT_FAMILY_VALUES.map((f) => ({ value: f.value, label: t(f.labelKey) })),
		[t],
	);

	// Load custom fonts on mount
	useEffect(() => {
		setCustomFonts(getCustomFonts());
	}, []);

	const colorPalette = [
		"#FF0000", // Red
		"#FFD700", // Yellow/Gold
		"#00FF00", // Green
		"#FFFFFF", // White
		"#0000FF", // Blue
		"#FF6B00", // Orange
		"#9B59B6", // Purple
		"#E91E63", // Pink
		"#00BCD4", // Cyan
		"#FF5722", // Deep Orange
		"#8BC34A", // Light Green
		"#FFC107", // Amber
		"#2563EB", // Brand Blue
		"#000000", // Black
		"#607D8B", // Blue Grey
		"#795548", // Brown
	];

	const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
		const files = event.target.files;
		if (!files || files.length === 0) return;

		const file = files[0];

		// Validate file type
		const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
		if (!validTypes.includes(file.type)) {
			toast.error(t("annotations.imageUploadError"), {
				description: t("annotations.imageUploadErrorDescription"),
			});
			event.target.value = "";
			return;
		}

		const reader = new FileReader();

		reader.onload = (e) => {
			const dataUrl = e.target?.result as string;
			if (dataUrl) {
				onContentChange(dataUrl);
				toast.success(t("annotations.imageUploadSuccess"));
			}
		};

		reader.onerror = () => {
			toast.error(t("annotations.imageUploadFailed"), {
				description: t("annotations.imageUploadFailedDescription"),
			});
		};

		reader.readAsDataURL(file);
		event.target.value = "";
	};

	return (
		<Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden rounded-none bg-transparent p-0 shadow-none">
			<div className="flex-1 min-h-0 px-5 pb-6 pt-1 overflow-y-auto custom-scrollbar">
				<div className="mb-6">
					{/* Type Selector */}
					<div className="space-y-4">
						<ChoiceGroup
							aria-label={te("annotationType", "Annotation type")}
							value={annotation.type}
							onValueChange={(value) => onTypeChange(value as AnnotationType)}
							className="grid grid-cols-4 gap-2"
						>
							<ChoiceItem
								value="text"
								aria-label={t("annotations.text")}
								className="min-w-0 gap-1 px-1 text-xs"
							>
								<Type className="w-4 h-4" />
								{t("annotations.text")}
							</ChoiceItem>
							<ChoiceItem
								value="image"
								aria-label={t("annotations.image")}
								className="min-w-0 gap-1 px-1 text-xs"
							>
								<ImageIcon className="w-4 h-4" />
								{t("annotations.image")}
							</ChoiceItem>
							<ChoiceItem
								value="figure"
								aria-label={t("annotations.arrow")}
								className="min-w-0 gap-1 px-1 text-xs"
							>
								<svg
									className="w-4 h-4"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
								>
									<path
										d="M4 12h16m0 0l-6-6m6 6l-6 6"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
								{t("annotations.arrow")}
							</ChoiceItem>
							<ChoiceItem
								value="blur"
								aria-label={t("annotations.blur")}
								className="min-w-0 gap-1 px-1 text-xs"
							>
								<SquareDashed className="w-4 h-4" />
								{t("annotations.blur")}
							</ChoiceItem>
						</ChoiceGroup>

						{/* Text Content */}
						{annotation.type === "text" && (
							<AnnotationTextSettings
								annotation={annotation}
								onContentChange={onContentChange}
								onStyleChange={onStyleChange}
								customFonts={customFonts}
								fontFamilies={fontFamilies}
								colorPalette={colorPalette}
								onFontAdded={(font) => {
									setCustomFonts(getCustomFonts());
									onStyleChange({ fontFamily: font.fontFamily });
								}}
							/>
						)}

						{/* Image Upload */}
						{annotation.type === "image" && (
							<div className="space-y-4">
								<input
									type="file"
									ref={fileInputRef}
									onChange={handleImageUpload}
									accept=".jpg,.jpeg,.png,.gif,.webp,image/*"
									className="hidden"
								/>
								<Button
									onClick={() => fileInputRef.current?.click()}
									variant="outline"
									className="w-full gap-2 py-8"
								>
									<Upload className="w-5 h-5" />
									{t("annotations.uploadImage")}
								</Button>

								{annotation.content &&
									annotation.content.startsWith("data:image") && (
										<div className="rounded-lg border border-foreground/10 overflow-hidden bg-foreground/5 p-2">
											<img
												src={annotation.content}
												alt={te(
													"uploadedAnnotation",
													"Uploaded annotation",
												)}
												className="w-full h-auto rounded-md"
											/>
										</div>
									)}

								<p className="text-xs text-muted-foreground/70 text-center leading-relaxed">
									{t("annotations.supportedFormats")}
								</p>
							</div>
						)}

						{annotation.type === "figure" && (
							<div className="space-y-4">
								<div>
									<label className="text-sm font-medium text-foreground mb-3 block">
										{t("annotations.arrowDirection")}
									</label>
									<div className="grid grid-cols-4 gap-2">
										{(
											[
												"up",
												"down",
												"left",
												"right",
												"up-right",
												"up-left",
												"down-right",
												"down-left",
											] as ArrowDirection[]
										).map((direction) => {
											const ArrowComponent = getArrowComponent(direction);
											return (
												<ToggleButton
													isSelected={
														annotation.figureData?.arrowDirection ===
														direction
													}
													key={direction}
													onClick={() => {
														const newFigureData: FigureData = {
															...annotation.figureData!,
															arrowDirection: direction,
														};
														onFigureDataChange?.(newFigureData);
													}}
													aria-label={t(
														"annotations.arrowDirectionOption",
														"Arrow direction: {{direction}}",
														{ direction: te(`direction${direction}`) },
													)}
													className={cn(
														"h-16 flex items-center justify-center p-2",
													)}
												>
													<ArrowComponent
														color={
															annotation.figureData
																?.arrowDirection === direction
																? "#ffffff"
																: "#94a3b8"
														}
														strokeWidth={3}
													/>
												</ToggleButton>
											);
										})}
									</div>
								</div>

								<div>
									<label className="text-sm font-medium text-foreground mb-2 block">
										{t("annotations.strokeWidth", undefined, {
											width: annotation.figureData?.strokeWidth || 4,
										})}
									</label>
									<Slider
										aria-label={t("annotations.strokeWidth", undefined, {
											width: annotation.figureData?.strokeWidth || 4,
										})}
										value={[annotation.figureData?.strokeWidth || 4]}
										onValueChange={([value]) => {
											const newFigureData: FigureData = {
												...annotation.figureData!,
												strokeWidth: value,
											};
											onFigureDataChange?.(newFigureData);
										}}
										min={1}
										max={6}
										step={1}
										className="my-3 w-full"
									/>
								</div>

								<div>
									<label className="text-sm font-medium text-foreground mb-2 block">
										{t("annotations.arrowColor")}
									</label>
									<ColorControl
										value={annotation.figureData?.color || "#2563EB"}
										label={t("annotations.arrowColor")}
										onChange={(color) =>
											onFigureDataChange?.({
												...annotation.figureData!,
												color,
											})
										}
										colors={colorPalette}
										compact
									/>
								</div>
							</div>
						)}

						{annotation.type === "blur" && (
							<div className="space-y-4">
								<div className="flex flex-col items-center">
									<div className="w-full space-y-5">
										<div className="flex items-center justify-between">
											<span className="text-sm font-medium text-foreground">
												{t("annotations.blurStrength", undefined, {
													strength: annotation.blurIntensity ?? 20,
												})}
											</span>
										</div>
										<Slider
											aria-label={t("annotations.blurStrength", undefined, {
												strength: annotation.blurIntensity ?? 20,
											})}
											value={[annotation.blurIntensity ?? 20]}
											onValueChange={([value]) =>
												onBlurIntensityChange?.(value)
											}
											min={1}
											max={100}
											step={1}
											className="w-full"
										/>
									</div>

									<div className="w-full space-y-5 mt-4">
										<div className="flex items-center justify-between">
											<span className="text-sm font-medium text-foreground">
												{t(
													"annotations.solidColor",
													"Solid Color (Censorship)",
												)}
											</span>
										</div>
										<div className="flex flex-col gap-3">
											<Button
												variant="secondary"
												aria-pressed={
													!annotation.blurColor ||
													annotation.blurColor === "transparent"
												}
												onClick={() => onBlurColorChange?.("")}
											>
												{t("annotations.none", "None")}
											</Button>
											<ColorPalette
												color={annotation.blurColor || "transparent"}
												colors={colorPalette}
												onChange={({ hex }) => onBlurColorChange?.(hex)}
											/>
											<ColorControl
												label={t("annotations.customColor", "Custom color")}
												value={annotation.blurColor || "#000000"}
												onChange={(color) => onBlurColorChange?.(color)}
											/>
										</div>
									</div>
								</div>
							</div>
						)}
					</div>

					<details className="mt-4 text-muted-foreground">
						<summary className="flex cursor-pointer items-center gap-2 py-2">
							<Info className="w-3.5 h-3.5" />
							<span className="text-xs font-medium">
								{t("annotations.shortcutsAndTips")}
							</span>
						</summary>
						<ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-3 leading-relaxed">
							<li>{t("annotations.tipSelectAnnotation")}</li>
							<li>{t("annotations.tipCycleForward")}</li>
							<li>{t("annotations.tipCycleBackward")}</li>
						</ul>
					</details>
				</div>
			</div>
			<div className="shrink-0 px-5 py-4">
				<Button
					onClick={onDelete}
					variant="destructive-soft"
					size="sm"
					className="w-full gap-2"
				>
					<Trash2 className="w-4 h-4" />
					{annotation.type === "blur"
						? te("deleteMask", "Delete mask")
						: t("annotations.deleteAnnotation")}
				</Button>
			</div>
		</Card>
	);
}
