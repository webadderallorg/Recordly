import {
	AlignCenterHorizontal as AlignCenter,
	AlignLeft,
	AlignRight,
	TextB as Bold,
	CaretDown as ChevronDown,
	ImageSquare as ImageIcon,
	Info,
	TextItalic as Italic,
	BoundingBox as SquareDashed,
	Trash as Trash2,
	TextT as Type,
	TextUnderline as Underline,
	UploadSimple as Upload,
} from "@phosphor-icons/react";
import Block from "@uiw/react-color-block";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
		<div className="flex-[2] min-w-0 bg-editor-panel border border-foreground/10 rounded-2xl p-4 flex flex-col shadow-xl h-full overflow-y-auto custom-scrollbar">
			<div className="mb-6">
				<div className="flex items-center justify-between mb-4">
					<span className="text-sm font-medium text-foreground">
						{t("annotations.settings")}
					</span>
					<span className="text-[10px] uppercase tracking-wider font-medium text-[#2563EB] bg-[#2563EB]/10 px-2 py-1 rounded-full">
						{t("annotations.active")}
					</span>
				</div>

				{/* Type Selector */}
				<Tabs
					value={annotation.type}
					onValueChange={(value) => onTypeChange(value as AnnotationType)}
					className="mb-6"
				>
					<TabsList className="mb-4 bg-foreground/5 border border-foreground/5 p-1 w-full grid grid-cols-4 h-auto rounded-xl">
						<TabsTrigger
							value="text"
							className="data-[state=active]:bg-[#2563EB] data-[state=active]:text-white text-muted-foreground py-2 rounded-lg transition-all gap-2"
						>
							<Type className="w-4 h-4" />
							{t("annotations.text")}
						</TabsTrigger>
						<TabsTrigger
							value="image"
							className="data-[state=active]:bg-[#2563EB] data-[state=active]:text-white text-muted-foreground py-2 rounded-lg transition-all gap-2"
						>
							<ImageIcon className="w-4 h-4" />
							{t("annotations.image")}
						</TabsTrigger>
						<TabsTrigger
							value="figure"
							className="data-[state=active]:bg-[#2563EB] data-[state=active]:text-white text-muted-foreground py-2 rounded-lg transition-all gap-2"
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
						</TabsTrigger>
						<TabsTrigger
							value="blur"
							className="data-[state=active]:bg-[#2563EB] data-[state=active]:text-white text-muted-foreground py-2 rounded-lg transition-all gap-2"
						>
							<SquareDashed className="w-4 h-4" />
							{t("annotations.blur")}
						</TabsTrigger>
					</TabsList>

					{/* Text Content */}
					<TabsContent value="text" className="mt-0 space-y-4">
						<div>
							<label className="text-xs font-medium text-foreground mb-2 block">
								{t("annotations.textContent")}
							</label>
							<textarea
								value={annotation.textContent || annotation.content}
								onChange={(e) => onContentChange(e.target.value)}
								placeholder={t("annotations.textPlaceholder")}
								rows={5}
								className="w-full px-3 py-2 bg-foreground/5 border border-foreground/10 rounded-lg text-foreground text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent resize-none"
							/>
						</div>

						{/* Styling Controls */}
						<div className="space-y-4">
							{/* Font Family & Size */}
							<div className="grid grid-cols-2 gap-2">
								<div>
									<label className="text-xs font-medium text-foreground mb-2 block">
										{t("annotations.fontStyle")}
									</label>
									<Select
										value={annotation.style.fontFamily}
										onValueChange={(value) =>
											onStyleChange({ fontFamily: value })
										}
									>
										<SelectTrigger className="w-full bg-foreground/5 border-foreground/10 text-foreground h-9 text-xs">
											<SelectValue
												placeholder={t("annotations.selectStyle")}
											/>
										</SelectTrigger>
										<SelectContent className="bg-editor-surface-alt border-foreground/10 text-foreground max-h-[300px]">
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
															style={{ fontFamily: font.fontFamily }}
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
									<label className="text-xs font-medium text-foreground mb-2 block">
										{t("annotations.size")}
									</label>
									<Select
										value={annotation.style.fontSize.toString()}
										onValueChange={(value) =>
											onStyleChange({ fontSize: parseInt(value) })
										}
									>
										<SelectTrigger className="w-full bg-foreground/5 border-foreground/10 text-foreground h-9 text-xs">
											<SelectValue placeholder={t("annotations.size")} />
										</SelectTrigger>
										<SelectContent className="bg-editor-surface-alt border-foreground/10 text-foreground max-h-[200px]">
											{FONT_SIZES.map((size) => (
												<SelectItem key={size} value={size.toString()}>
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
							<div className="flex items-center justify-between gap-2">
								<ToggleGroup
									type="multiple"
									className="justify-start bg-foreground/5 p-1 rounded-lg border border-foreground/5"
								>
									<ToggleGroupItem
										value="bold"
										aria-label={t("annotations.toggleBold")}
										data-state={
											annotation.style.fontWeight === "bold" ? "on" : "off"
										}
										onClick={() =>
											onStyleChange({
												fontWeight:
													annotation.style.fontWeight === "bold"
														? "normal"
														: "bold",
											})
										}
										className="h-8 w-8 data-[state=on]:bg-[#2563EB] data-[state=on]:text-white text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
									>
										<Bold className="h-4 w-4" />
									</ToggleGroupItem>
									<ToggleGroupItem
										value="italic"
										aria-label={t("annotations.toggleItalic")}
										data-state={
											annotation.style.fontStyle === "italic" ? "on" : "off"
										}
										onClick={() =>
											onStyleChange({
												fontStyle:
													annotation.style.fontStyle === "italic"
														? "normal"
														: "italic",
											})
										}
										className="h-8 w-8 data-[state=on]:bg-[#2563EB] data-[state=on]:text-white text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
									>
										<Italic className="h-4 w-4" />
									</ToggleGroupItem>
									<ToggleGroupItem
										value="underline"
										aria-label={t("annotations.toggleUnderline")}
										data-state={
											annotation.style.textDecoration === "underline"
												? "on"
												: "off"
										}
										onClick={() =>
											onStyleChange({
												textDecoration:
													annotation.style.textDecoration === "underline"
														? "none"
														: "underline",
											})
										}
										className="h-8 w-8 data-[state=on]:bg-[#2563EB] data-[state=on]:text-white text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
									>
										<Underline className="h-4 w-4" />
									</ToggleGroupItem>
								</ToggleGroup>

								<ToggleGroup
									type="single"
									value={annotation.style.textAlign}
									className="justify-start bg-foreground/5 p-1 rounded-lg border border-foreground/5"
								>
									<ToggleGroupItem
										value="left"
										aria-label={t("annotations.alignLeft")}
										onClick={() => onStyleChange({ textAlign: "left" })}
										className="h-8 w-8 data-[state=on]:bg-[#2563EB] data-[state=on]:text-white text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
									>
										<AlignLeft className="h-4 w-4" />
									</ToggleGroupItem>
									<ToggleGroupItem
										value="center"
										aria-label={t("annotations.alignCenter")}
										onClick={() => onStyleChange({ textAlign: "center" })}
										className="h-8 w-8 data-[state=on]:bg-[#2563EB] data-[state=on]:text-white text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
									>
										<AlignCenter className="h-4 w-4" />
									</ToggleGroupItem>
									<ToggleGroupItem
										value="right"
										aria-label={t("annotations.alignRight")}
										onClick={() => onStyleChange({ textAlign: "right" })}
										className="h-8 w-8 data-[state=on]:bg-[#2563EB] data-[state=on]:text-white text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
									>
										<AlignRight className="h-4 w-4" />
									</ToggleGroupItem>
								</ToggleGroup>
							</div>

							{/* Colors */}
							<div className="grid grid-cols-2 gap-4">
								<div>
									<label className="text-xs font-medium text-foreground mb-2 block">
										{t("annotations.textColor")}
									</label>
									<Popover>
										<PopoverTrigger asChild>
											<Button
												variant="outline"
												className="w-full h-9 justify-start gap-2 bg-foreground/5 border-foreground/10 hover:bg-foreground/10 px-2"
											>
												<div
													className="w-4 h-4 rounded-full border border-foreground/20"
													style={{
														backgroundColor: annotation.style.color,
													}}
												/>
												<span className="text-xs text-muted-foreground truncate flex-1 text-start">
													{annotation.style.color}
												</span>
												<ChevronDown className="h-3 w-3 opacity-50" />
											</Button>
										</PopoverTrigger>
										<PopoverContent className="w-[260px] p-3 bg-editor-surface-alt border border-foreground/10 rounded-xl shadow-xl">
											<Block
												color={annotation.style.color}
												colors={colorPalette}
												onChange={(color) => {
													onStyleChange({ color: color.hex });
												}}
												style={{
													borderRadius: "8px",
												}}
											/>
										</PopoverContent>
									</Popover>
								</div>
								<div>
									<label className="text-xs font-medium text-foreground mb-2 block">
										{t("annotations.background")}
									</label>
									<Popover>
										<PopoverTrigger asChild>
											<Button
												variant="outline"
												className="w-full h-9 justify-start gap-2 bg-foreground/5 border-foreground/10 hover:bg-foreground/10 px-2"
											>
												<div className="w-4 h-4 rounded-full border border-foreground/20 relative overflow-hidden">
													<div className="absolute inset-0 checkerboard-bg opacity-50" />
													<div
														className="absolute inset-0"
														style={{
															backgroundColor:
																annotation.style.backgroundColor,
														}}
													/>
												</div>
												<span className="text-xs text-muted-foreground truncate flex-1 text-start">
													{annotation.style.backgroundColor ===
													"transparent"
														? t("annotations.none")
														: "Color"}
												</span>
												<ChevronDown className="h-3 w-3 opacity-50" />
											</Button>
										</PopoverTrigger>
										<PopoverContent className="w-[260px] p-3 bg-editor-surface-alt border border-foreground/10 rounded-xl shadow-xl">
											<Block
												color={
													annotation.style.backgroundColor ===
													"transparent"
														? "#000000"
														: annotation.style.backgroundColor
												}
												colors={colorPalette}
												onChange={(color) => {
													onStyleChange({ backgroundColor: color.hex });
												}}
												style={{
													borderRadius: "8px",
												}}
											/>
											<Button
												variant="ghost"
												size="sm"
												className="w-full mt-2 text-xs h-7 hover:bg-foreground/5 text-muted-foreground"
												onClick={() => {
													onStyleChange({
														backgroundColor: "transparent",
													});
												}}
											>
												{t("annotations.clearBackground")}
											</Button>
										</PopoverContent>
									</Popover>
								</div>
							</div>
						</div>
					</TabsContent>

					{/* Image Upload */}
					<TabsContent value="image" className="mt-0 space-y-4">
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
							className="w-full gap-2 bg-foreground/5 text-foreground border-foreground/10 hover:bg-[#2563EB] hover:text-white hover:border-[#2563EB] transition-all py-8"
						>
							<Upload className="w-5 h-5" />
							{t("annotations.uploadImage")}
						</Button>

						{annotation.content && annotation.content.startsWith("data:image") && (
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
					</TabsContent>

					<TabsContent value="figure" className="mt-0 space-y-4">
						<div>
							<label className="text-xs font-medium text-foreground mb-3 block">
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
										<button
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
												"h-16 rounded-lg border flex items-center justify-center transition-all p-2",
												annotation.figureData?.arrowDirection === direction
													? "bg-[#2563EB] border-[#2563EB]"
													: "bg-foreground/5 border-foreground/10 hover:bg-foreground/10 hover:border-foreground/20",
											)}
										>
											<ArrowComponent
												color={
													annotation.figureData?.arrowDirection ===
													direction
														? "#ffffff"
														: "#94a3b8"
												}
												strokeWidth={3}
											/>
										</button>
									);
								})}
							</div>
						</div>

						<div>
							<label className="text-xs font-medium text-foreground mb-2 block">
								{t("annotations.strokeWidth", undefined, {
									width: annotation.figureData?.strokeWidth || 4,
								})}
							</label>
							<Slider
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
								className="w-full"
							/>
						</div>

						<div>
							<label className="text-xs font-medium text-foreground mb-2 block">
								{t("annotations.arrowColor")}
							</label>
							<Popover>
								<PopoverTrigger asChild>
									<Button
										variant="outline"
										className="w-full h-10 justify-start gap-2 bg-foreground/5 border-foreground/10 hover:bg-foreground/10"
									>
										<div
											className="w-5 h-5 rounded-full border border-foreground/20"
											style={{
												backgroundColor:
													annotation.figureData?.color || "#2563EB",
											}}
										/>
										<span className="text-xs text-muted-foreground truncate flex-1 text-start">
											{annotation.figureData?.color || "#2563EB"}
										</span>
										<ChevronDown className="h-3 w-3 opacity-50" />
									</Button>
								</PopoverTrigger>
								<PopoverContent className="w-[260px] p-3 bg-editor-surface-alt border border-foreground/10 rounded-xl shadow-xl">
									<Block
										color={annotation.figureData?.color || "#2563EB"}
										colors={colorPalette}
										onChange={(color) => {
											const newFigureData: FigureData = {
												...annotation.figureData!,
												color: color.hex,
											};
											onFigureDataChange?.(newFigureData);
										}}
										style={{
											borderRadius: "8px",
										}}
									/>
								</PopoverContent>
							</Popover>
						</div>
					</TabsContent>

					<TabsContent value="blur" className="mt-0 space-y-4">
						<div className="p-4 bg-foreground/5 rounded-xl border border-foreground/10 flex flex-col items-center">
							<div className="w-full space-y-3">
								<div className="flex items-center justify-between">
									<span className="text-xs font-medium text-foreground">
										{t("annotations.blurStrength", undefined, {
											strength: annotation.blurIntensity ?? 20,
										})}
									</span>
								</div>
								<Slider
									value={[annotation.blurIntensity ?? 20]}
									onValueChange={([value]) => onBlurIntensityChange?.(value)}
									min={1}
									max={100}
									step={1}
									className="w-full"
								/>
							</div>

							<div className="w-full space-y-3 mt-4">
								<div className="flex items-center justify-between">
									<span className="text-xs font-medium text-foreground">
										{t("annotations.solidColor", "Solid Color (Censorship)")}
									</span>
								</div>
								<div className="flex flex-wrap gap-2">
									<button
										onClick={() => onBlurColorChange?.("")}
										className={cn(
											"w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all",
											!annotation.blurColor ||
												annotation.blurColor === "transparent"
												? "border-[#2563EB] scale-110"
												: "border-transparent hover:border-foreground/20",
										)}
										title={t("annotations.none", "None")}
									>
										<div className="w-5 h-5 rounded-full bg-editor-bg flex items-center justify-center overflow-hidden relative">
											<div className="absolute w-full h-0.5 bg-red-500 rotate-45" />
										</div>
									</button>
									<button
										onClick={() => onBlurColorChange?.("#000000")}
										className={cn(
											"w-8 h-8 rounded-full border-2 transition-all bg-black",
											annotation.blurColor === "#000000"
												? "border-[#2563EB] scale-110"
												: "border-transparent hover:border-foreground/20",
										)}
										title="Black"
									/>
									<button
										onClick={() => onBlurColorChange?.("#FFFFFF")}
										className={cn(
											"w-8 h-8 rounded-full border-2 transition-all bg-white",
											annotation.blurColor === "#FFFFFF"
												? "border-[#2563EB] scale-110"
												: "border-transparent hover:border-foreground/20",
										)}
										title="White"
									/>

									<Popover>
										<PopoverTrigger asChild>
											<button
												className={cn(
													"w-8 h-8 rounded-full border-2 transition-all flex items-center justify-center overflow-hidden relative",
													annotation.blurColor &&
														![
															"#000000",
															"#FFFFFF",
															"transparent",
															"",
														].includes(annotation.blurColor)
														? "border-[#2563EB] scale-110"
														: "border-transparent hover:border-foreground/20",
												)}
												style={{
													backgroundColor:
														annotation.blurColor &&
														![
															"#000000",
															"#FFFFFF",
															"transparent",
															"",
														].includes(annotation.blurColor)
															? annotation.blurColor
															: "transparent",
												}}
												title="Custom Color"
											>
												{(!annotation.blurColor ||
													[
														"#000000",
														"#FFFFFF",
														"transparent",
														"",
													].includes(annotation.blurColor)) && (
													<div className="w-full h-full flex items-center justify-center bg-foreground/5">
														<div className="w-full h-full bg-gradient-to-tr from-red-500 via-green-500 to-blue-500 opacity-50" />
													</div>
												)}
											</button>
										</PopoverTrigger>
										<PopoverContent className="w-[260px] p-3 bg-editor-surface-alt border border-foreground/10 rounded-xl shadow-xl">
											<Block
												color={annotation.blurColor || "#2563EB"}
												colors={colorPalette}
												onChange={(color) => {
													onBlurColorChange?.(color.hex);
												}}
												style={{
													borderRadius: "8px",
												}}
											/>
										</PopoverContent>
									</Popover>
								</div>
							</div>
						</div>
					</TabsContent>
				</Tabs>

				<Button
					onClick={onDelete}
					variant="destructive"
					size="sm"
					className="w-full gap-2 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30 transition-all mt-4"
				>
					<Trash2 className="w-4 h-4" />
					{t("annotations.deleteAnnotation")}
				</Button>

				<div className="mt-6 p-3 bg-foreground/5 rounded-lg border border-foreground/5">
					<div className="flex items-center gap-2 mb-2 text-muted-foreground">
						<Info className="w-3.5 h-3.5" />
						<span className="text-xs font-medium">
							{t("annotations.shortcutsAndTips")}
						</span>
					</div>
					<ul className="text-[10px] text-muted-foreground space-y-1.5 list-disc ps-3 leading-relaxed">
						<li>{t("annotations.tipSelectAnnotation")}</li>
						<li>{t("annotations.tipCycleForward")}</li>
						<li>{t("annotations.tipCycleBackward")}</li>
					</ul>
				</div>
			</div>
		</div>
	);
}
