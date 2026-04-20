import {
	AlignCenterHorizontal as AlignCenter,
	AlignLeft,
	AlignRight,
	TextB as Bold,
	CaretDown as ChevronDown,
	TextItalic as Italic,
	TextUnderline as Underline,
} from "@phosphor-icons/react";
import Block from "@uiw/react-color-block";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type CustomFont, getCustomFonts } from "@/lib/customFonts";
import { useScopedT } from "../../contexts/I18nContext";
import { AddCustomFontDialog } from "./AddCustomFontDialog";
import {
	ANNOTATION_COLOR_PALETTE,
	FONT_FAMILY_VALUES,
	FONT_SIZES,
	type AnnotationSettingsPanelProps,
} from "./annotationSettingsShared";

interface AnnotationTextTabProps extends Pick<
	AnnotationSettingsPanelProps,
	"annotation" | "onContentChange" | "onStyleChange"
> {}

export function AnnotationTextTab({
	annotation,
	onContentChange,
	onStyleChange,
}: AnnotationTextTabProps) {
	const t = useScopedT("editor");
	const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);

	const fontFamilies = useMemo(
		() => FONT_FAMILY_VALUES.map((font) => ({ value: font.value, label: t(font.labelKey) })),
		[t],
	);

	useEffect(() => {
		setCustomFonts(getCustomFonts());
	}, []);

	return (
		<TabsContent value="text" className="mt-0 space-y-4">
			<div>
				<label className="text-xs font-medium text-foreground mb-2 block">
					{t("annotations.textContent")}
				</label>
				<textarea
					value={annotation.textContent || annotation.content}
					onChange={(event) => onContentChange(event.target.value)}
					placeholder={t("annotations.textPlaceholder")}
					rows={5}
					className="w-full px-3 py-2 bg-foreground/5 border border-foreground/10 rounded-lg text-foreground text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent resize-none"
				/>
			</div>

			<div className="space-y-4">
				<div className="grid grid-cols-2 gap-2">
					<div>
						<label className="text-xs font-medium text-foreground mb-2 block">
							{t("annotations.fontStyle")}
						</label>
						<Select
							value={annotation.style.fontFamily}
							onValueChange={(value) => onStyleChange({ fontFamily: value })}
						>
							<SelectTrigger className="w-full bg-foreground/5 border-foreground/10 text-foreground h-9 text-xs">
								<SelectValue placeholder={t("annotations.selectStyle")} />
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
							onValueChange={(value) => onStyleChange({ fontSize: parseInt(value, 10) })}
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

				<AddCustomFontDialog
					onFontAdded={(font) => {
						setCustomFonts(getCustomFonts());
						onStyleChange({ fontFamily: font.fontFamily });
					}}
				/>

				<div className="flex items-center justify-between gap-2">
					<ToggleGroup
						type="multiple"
						className="justify-start bg-foreground/5 p-1 rounded-lg border border-foreground/5"
					>
						<ToggleGroupItem
							value="bold"
							aria-label={t("annotations.toggleBold")}
							data-state={annotation.style.fontWeight === "bold" ? "on" : "off"}
							onClick={() =>
								onStyleChange({
									fontWeight:
										annotation.style.fontWeight === "bold" ? "normal" : "bold",
								})
							}
							className="h-8 w-8 data-[state=on]:bg-[#2563EB] data-[state=on]:text-white text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
						>
							<Bold className="h-4 w-4" />
						</ToggleGroupItem>
						<ToggleGroupItem
							value="italic"
							aria-label={t("annotations.toggleItalic")}
							data-state={annotation.style.fontStyle === "italic" ? "on" : "off"}
							onClick={() =>
								onStyleChange({
									fontStyle:
										annotation.style.fontStyle === "italic" ? "normal" : "italic",
								})
							}
							className="h-8 w-8 data-[state=on]:bg-[#2563EB] data-[state=on]:text-white text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
						>
							<Italic className="h-4 w-4" />
						</ToggleGroupItem>
						<ToggleGroupItem
							value="underline"
							aria-label={t("annotations.toggleUnderline")}
							data-state={annotation.style.textDecoration === "underline" ? "on" : "off"}
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
										style={{ backgroundColor: annotation.style.color }}
									/>
									<span className="text-xs text-muted-foreground truncate flex-1 text-left">
										{annotation.style.color}
									</span>
									<ChevronDown className="h-3 w-3 opacity-50" />
								</Button>
							</PopoverTrigger>
							<PopoverContent className="w-[260px] p-3 bg-editor-surface-alt border border-foreground/10 rounded-xl shadow-xl">
								<Block
									color={annotation.style.color}
									colors={ANNOTATION_COLOR_PALETTE}
									onChange={(color) => onStyleChange({ color: color.hex })}
									style={{ borderRadius: "8px" }}
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
											style={{ backgroundColor: annotation.style.backgroundColor }}
										/>
									</div>
									<span className="text-xs text-muted-foreground truncate flex-1 text-left">
										{annotation.style.backgroundColor === "transparent"
											? t("annotations.none")
											: "Color"}
									</span>
									<ChevronDown className="h-3 w-3 opacity-50" />
								</Button>
							</PopoverTrigger>
							<PopoverContent className="w-[260px] p-3 bg-editor-surface-alt border border-foreground/10 rounded-xl shadow-xl">
								<Block
									color={
										annotation.style.backgroundColor === "transparent"
											? "#000000"
											: annotation.style.backgroundColor
									}
									colors={ANNOTATION_COLOR_PALETTE}
									onChange={(color) =>
										onStyleChange({ backgroundColor: color.hex })
									}
									style={{ borderRadius: "8px" }}
								/>
								<Button
									variant="ghost"
									size="sm"
									className="w-full mt-2 text-xs h-7 hover:bg-foreground/5 text-muted-foreground"
									onClick={() => onStyleChange({ backgroundColor: "transparent" })}
								>
									{t("annotations.clearBackground")}
								</Button>
							</PopoverContent>
						</Popover>
					</div>
				</div>
			</div>
		</TabsContent>
	);
}