import { ToggleButton } from "@heroui/react";
import { Card } from "@heroui/react";
import { TextArea } from "@/components/ui/input";
import {
	AlignCenterHorizontal as AlignCenter,
	AlignLeft,
	AlignRight,
	TextB as Bold,
	ImageSquare as ImageIcon,
	Info,
	TextItalic as Italic,
	BoundingBox as SquareDashed,
	Trash as Trash2,
	TextT as Type,
	TextUnderline as Underline,
	UploadSimple as Upload,
} from "@/components/ui/icons";
import { ColorControl, ColorPalette } from "@/components/ui/color-picker";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ChoiceGroup, ChoiceItem } from "@/components/ui/choice-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type CustomFont, getCustomFonts } from "@/lib/customFonts";
import { cn } from "@/lib/utils";
import { useScopedT } from "../../contexts/I18nContext";
import { AddCustomFontDialog } from "./AddCustomFontDialog";
import { getArrowComponent } from "./ArrowSvgs";
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

export const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 128];

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
							aria-label="Annotation type"
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
							<div className="space-y-4">
								<div>
									<label className="text-sm font-medium text-foreground mb-2 block">
										{t("annotations.textContent")}
									</label>
									<TextArea
										value={annotation.textContent || annotation.content}
										onChange={(e) => onContentChange(e.target.value)}
										placeholder={t("annotations.textPlaceholder")}
										rows={3}
										className="w-full px-3 py-2 text-sm resize-none"
									/>
								</div>

								{/* Styling Controls */}
								<div className="space-y-4">
									{/* Font Family & Size */}
									<div className="grid grid-cols-2 gap-2">
										<div>
											<label className="text-sm font-medium text-foreground mb-2 block">
												{t("annotations.fontStyle")}
											</label>
											<Select
												value={annotation.style.fontFamily}
												onValueChange={(value) =>
													onStyleChange({ fontFamily: value })
												}
											>
												<SelectTrigger className="w-full h-9 text-xs">
													<SelectValue
														placeholder={t("annotations.selectStyle")}
													/>
												</SelectTrigger>
												<SelectContent className="max-h-[300px]">
													{!fontFamilies.some(
														(font) =>
															font.value ===
															annotation.style.fontFamily,
													) &&
														!customFonts.some(
															(font) =>
																font.fontFamily ===
																annotation.style.fontFamily,
														) && (
															<SelectItem
																value={annotation.style.fontFamily}
															>
																{annotation.style.fontFamily
																	.split(",")[0]
																	.replace(/"/g, "")}
															</SelectItem>
														)}
													{fontFamilies.map((font) => (
														<SelectItem
															key={font.value}
															value={font.value}
															style={{ fontFamily: font.value }}
														>
															{font.label}
														</SelectItem>
													))}
													{customFonts.length > 0 && (
														<>
															<div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
																Custom Fonts
															</div>
															{customFonts.map((font) => (
																<SelectItem
																	key={font.id}
																	value={font.fontFamily}
																	style={{
																		fontFamily: font.fontFamily,
																	}}
																>
																	{font.name}
																</SelectItem>
															))}
														</>
													)}
												</SelectContent>
											</Select>
										</div>
										<div>
											<label className="text-sm font-medium text-foreground mb-2 block">
												{t("annotations.size")}
											</label>
											<Select
												value={annotation.style.fontSize.toString()}
												onValueChange={(value) =>
													onStyleChange({ fontSize: parseInt(value) })
												}
											>
												<SelectTrigger className="w-full h-9 text-xs">
													<SelectValue
														placeholder={t("annotations.size")}
													/>
												</SelectTrigger>
												<SelectContent className="max-h-[200px]">
													{FONT_SIZES.map((size) => (
														<SelectItem
															key={size}
															value={size.toString()}
														>
															{size}px
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
									</div>

									{/* Add Custom Font Button */}
									<div>
										<AddCustomFontDialog
											onFontAdded={(font) => {
												setCustomFonts(getCustomFonts());
												onStyleChange({ fontFamily: font.fontFamily });
											}}
										/>
									</div>

									{/* Formatting Toggles */}
									<div className="flex flex-wrap items-center justify-between gap-2">
										<ToggleGroup
											type="multiple"
											value={[
												...(annotation.style.fontWeight === "bold"
													? ["bold"]
													: []),
												...(annotation.style.fontStyle === "italic"
													? ["italic"]
													: []),
												...(annotation.style.textDecoration === "underline"
													? ["underline"]
													: []),
											]}
											size="sm"
											className="justify-start"
										>
											<ToggleGroupItem
												value="bold"
												aria-label={t("annotations.toggleBold")}
												onClick={() =>
													onStyleChange({
														fontWeight:
															annotation.style.fontWeight === "bold"
																? "normal"
																: "bold",
													})
												}
												className="h-8 w-8 min-w-8 p-0"
											>
												<Bold className="h-4 w-4" />
											</ToggleGroupItem>
											<ToggleGroupItem
												value="italic"
												aria-label={t("annotations.toggleItalic")}
												onClick={() =>
													onStyleChange({
														fontStyle:
															annotation.style.fontStyle === "italic"
																? "normal"
																: "italic",
													})
												}
												className="h-8 w-8 min-w-8 p-0"
											>
												<Italic className="h-4 w-4" />
											</ToggleGroupItem>
											<ToggleGroupItem
												value="underline"
												aria-label={t("annotations.toggleUnderline")}
												onClick={() =>
													onStyleChange({
														textDecoration:
															annotation.style.textDecoration ===
															"underline"
																? "none"
																: "underline",
													})
												}
												className="h-8 w-8 min-w-8 p-0"
											>
												<Underline className="h-4 w-4" />
											</ToggleGroupItem>
										</ToggleGroup>

										<ToggleGroup
											type="single"
											value={annotation.style.textAlign}
											size="sm"
											className="justify-start"
										>
											<ToggleGroupItem
												value="left"
												aria-label={t("annotations.alignLeft")}
												onClick={() => onStyleChange({ textAlign: "left" })}
												className="h-8 w-8 min-w-8 p-0"
											>
												<AlignLeft className="h-4 w-4" />
											</ToggleGroupItem>
											<ToggleGroupItem
												value="center"
												aria-label={t("annotations.alignCenter")}
												onClick={() =>
													onStyleChange({ textAlign: "center" })
												}
												className="h-8 w-8 min-w-8 p-0"
											>
												<AlignCenter className="h-4 w-4" />
											</ToggleGroupItem>
											<ToggleGroupItem
												value="right"
												aria-label={t("annotations.alignRight")}
												onClick={() =>
													onStyleChange({ textAlign: "right" })
												}
												className="h-8 w-8 min-w-8 p-0"
											>
												<AlignRight className="h-4 w-4" />
											</ToggleGroupItem>
										</ToggleGroup>
									</div>

									{/* Colors */}
									<div className="grid grid-cols-2 gap-4">
										<div>
											<label className="text-sm font-medium text-foreground mb-2 block">
												{t("annotations.textColor")}
											</label>
											<ColorControl
												value={annotation.style.color}
												label={t("annotations.textColor")}
												onChange={(color) => onStyleChange({ color })}
												colors={colorPalette}
												compact
											/>
										</div>
										<div>
											<label className="text-sm font-medium text-foreground mb-2 block">
												{t("annotations.background")}
											</label>
											<ColorControl
												value={annotation.style.backgroundColor}
												label={t("annotations.background")}
												onChange={(color) =>
													onStyleChange({ backgroundColor: color })
												}
												colors={colorPalette}
												compact
												onClear={() =>
													onStyleChange({
														backgroundColor: "transparent",
													})
												}
											/>
										</div>
									</div>
								</div>
							</div>
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
												alt="Uploaded annotation"
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
														{ direction: direction.replace(/-/g, " ") },
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
					{t("annotations.deleteAnnotation")}
				</Button>
			</div>
		</Card>
	);
}
