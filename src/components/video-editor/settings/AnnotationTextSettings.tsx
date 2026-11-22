import { ColorControl } from "@/components/ui/color-picker";
import {
	AlignCenterHorizontal as AlignCenter,
	AlignLeft,
	AlignRight,
	TextB as Bold,
	TextItalic as Italic,
	TextUnderline as Underline,
} from "@/components/ui/icons";
import { TextArea } from "@/components/ui/input";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AddCustomFontDialog } from "@/components/video-editor/AddCustomFontDialog";
import type { AnnotationRegion } from "@/components/video-editor/types";
import { useScopedT } from "@/contexts/I18nContext";
import { type CustomFont } from "@/lib/customFonts";

export const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 128];

type Props = {
	annotation: AnnotationRegion;
	onContentChange: (content: string) => void;
	onStyleChange: (style: Partial<AnnotationRegion["style"]>) => void;
	customFonts: CustomFont[];
	fontFamilies: { value: string; label: string }[];
	onFontAdded: (font: CustomFont) => void;
	colorPalette: string[];
};
export function AnnotationTextSettings({
	annotation,
	onContentChange,
	onStyleChange,
	customFonts,
	fontFamilies,
	onFontAdded,
	colorPalette,
}: Props) {
	const t = useScopedT("editor");
	const te = useScopedT("editing");
	return (
		<div className="space-y-4">
			<div>
				<label className="text-sm font-medium text-foreground mb-2 block">
					{t("annotations.textContent")}
				</label>
				<TextArea
					value={annotation.textContent ?? annotation.content}
					onFocus={(event) => {
						event.currentTarget.dataset.annotationEditSession = crypto.randomUUID();
					}}
					onKeyDown={(event) => {
						if (event.key === "Escape" && !event.nativeEvent.isComposing) {
							event.preventDefault();
							event.stopPropagation();
							event.currentTarget.blur();
						}
					}}
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
							onValueChange={(value) => onStyleChange({ fontFamily: value })}
						>
							<SelectTrigger className="w-full h-9 text-xs">
								<SelectValue placeholder={t("annotations.selectStyle")} />
							</SelectTrigger>
							<SelectContent className="max-h-[300px]">
								{!fontFamilies.some(
									(font) => font.value === annotation.style.fontFamily,
								) &&
									!customFonts.some(
										(font) => font.fontFamily === annotation.style.fontFamily,
									) && (
										<SelectItem value={annotation.style.fontFamily}>
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
											{te("customFonts", "Custom Fonts")}
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
							onValueChange={(value) => onStyleChange({ fontSize: parseInt(value) })}
						>
							<SelectTrigger className="w-full h-9 text-xs">
								<SelectValue placeholder={t("annotations.size")} />
							</SelectTrigger>
							<SelectContent className="max-h-[200px]">
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
					<AddCustomFontDialog onFontAdded={onFontAdded} />
				</div>

				{/* Formatting Toggles */}
				<div className="flex flex-wrap items-center justify-between gap-2">
					<ToggleGroup
						type="multiple"
						value={[
							...(annotation.style.fontWeight === "bold" ? ["bold"] : []),
							...(annotation.style.fontStyle === "italic" ? ["italic"] : []),
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
										annotation.style.fontWeight === "bold" ? "normal" : "bold",
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
										annotation.style.textDecoration === "underline"
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
							onClick={() => onStyleChange({ textAlign: "center" })}
							className="h-8 w-8 min-w-8 p-0"
						>
							<AlignCenter className="h-4 w-4" />
						</ToggleGroupItem>
						<ToggleGroupItem
							value="right"
							aria-label={t("annotations.alignRight")}
							onClick={() => onStyleChange({ textAlign: "right" })}
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
							onChange={(color) => onStyleChange({ backgroundColor: color })}
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
	);
}
