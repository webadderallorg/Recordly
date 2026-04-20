import {
	ImageSquare as ImageIcon,
	Info,
	BoundingBox as SquareDashed,
	Trash as Trash2,
	TextT as Type,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useScopedT } from "../../contexts/I18nContext";
import { AnnotationBlurTab } from "./AnnotationBlurTab";
import { AnnotationFigureTab } from "./AnnotationFigureTab";
import { AnnotationImageTab } from "./AnnotationImageTab";
import { AnnotationTextTab } from "./AnnotationTextTab";
import type { AnnotationSettingsPanelProps } from "./annotationSettingsShared";
import type { AnnotationType } from "./types";

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

					<AnnotationTextTab
						annotation={annotation}
						onContentChange={onContentChange}
						onStyleChange={onStyleChange}
					/>
					<AnnotationImageTab annotation={annotation} onContentChange={onContentChange} />
					<AnnotationFigureTab
						annotation={annotation}
						onFigureDataChange={onFigureDataChange}
					/>
					<AnnotationBlurTab
						annotation={annotation}
						onBlurIntensityChange={onBlurIntensityChange}
						onBlurColorChange={onBlurColorChange}
					/>
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
					<ul className="text-[10px] text-muted-foreground space-y-1.5 list-disc pl-3 leading-relaxed">
						<li>{t("annotations.tipSelectAnnotation")}</li>
						<li>{t("annotations.tipCycleForward")}</li>
						<li>{t("annotations.tipCycleBackward")}</li>
					</ul>
				</div>
			</div>
		</div>
	);
}
