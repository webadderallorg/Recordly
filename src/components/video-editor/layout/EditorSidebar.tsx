import { useI18n as useUiLocale } from "@/contexts/I18nContext";
import {
	Button,
	Card,
	Label,
	Switch,
	ToggleButton,
	ToggleButtonGroup,
	Tooltip,
} from "@heroui/react";
import type { ComponentProps, ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import { Camera, ClosedCaptioning, Cursor, FrameCorners, Gear } from "@/components/ui/icons";
import type { useI18n } from "@/contexts/I18nContext";
import ExtensionManager from "../ExtensionManager";
import { SettingsPanel } from "../SettingsPanel";
import type { EditorEffectSection } from "../types";

function IconRailTooltip({ label, children }: { label: string; children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLSpanElement>(null);
	return (
		<Tooltip isOpen={open} onOpenChange={setOpen}>
			<span
				ref={triggerRef}
				className="inline-flex"
				onMouseEnter={() => setOpen(true)}
				onMouseLeave={() => setOpen(false)}
				onFocus={(event) => {
					if (event.target.matches(":focus-visible")) setOpen(true);
				}}
				onBlur={() => setOpen(false)}
				onPointerDown={() => setOpen(false)}
			>
				{children}
			</span>
			<Tooltip.Content triggerRef={triggerRef} placement="right" offset={8} className="z-50">
				{label}
			</Tooltip.Content>
		</Tooltip>
	);
}

type Props = {
	panelContent?: ReactNode;
	t: ReturnType<typeof useI18n>["t"];
	activeSection: EditorEffectSection;
	setActiveSection: (section: EditorEffectSection) => void;
	onOpenSettings: () => void;
	settingsPanelProps: ComponentProps<typeof SettingsPanel>;
};

export function EditorSidebar({
	t,
	activeSection,
	setActiveSection,
	onOpenSettings,
	settingsPanelProps,
	panelContent,
}: Props) {
	const { t: uiText } = useUiLocale();
	const [advancedSections, setAdvancedSections] = useState<Record<string, boolean>>({});
	const advanced = advancedSections[activeSection] ?? false;
	const selectedAnnotation = settingsPanelProps.annotationRegions?.find(
		(region) => region.id === settingsPanelProps.selectedAnnotationId,
	);
	const hasAdvanced =
		!settingsPanelProps.selectedAnnotationId &&
		["scene", "frame", "crop", "cursor", "webcam", "captions", "settings", "zoom"].includes(
			activeSection,
		);
	const sections = useMemo(
		() => [
			{
				id: "scene" as const,
				label: t("settings.sections.scene", "Scene"),
				icon: FrameCorners,
			},
			{ id: "cursor" as const, label: t("settings.sections.cursor", "Cursor"), icon: Cursor },
			{ id: "webcam" as const, label: t("settings.sections.webcam", "Webcam"), icon: Camera },
			{
				id: "captions" as const,
				label: t("settings.sections.captions", "Captions"),
				icon: ClosedCaptioning,
			},
		],
		[t],
	);
	return (
		<div className="flex min-h-0 shrink-0 pb-3 pr-2">
			<nav
				aria-label={t("settings.sections.title", "Editor tools")}
				className="flex w-16 shrink-0 flex-col items-center gap-3 py-2.5"
			>
				<ToggleButtonGroup
					orientation="vertical"
					isDetached
					className="w-full items-center gap-2"
					selectionMode="single"
					disallowEmptySelection
					selectedKeys={panelContent ? [] : [activeSection]}
					onSelectionChange={(keys) => {
						const key = Array.from(keys)[0];
						if (key) setActiveSection(key as EditorEffectSection);
					}}
				>
					{sections.map((section) => (
						<IconRailTooltip key={section.id} label={section.label}>
							<ToggleButton
								id={section.id}
								variant="ghost"
								isIconOnly
								aria-label={section.label}
							>
								<section.icon
									weight={
										!panelContent && activeSection === section.id
											? "fill"
											: "regular"
									}
									className="size-5"
								/>
							</ToggleButton>
						</IconRailTooltip>
					))}
				</ToggleButtonGroup>
				<div className="mt-auto">
					<IconRailTooltip label={uiText("ui.settings")}>
						<Button
							variant="ghost"
							isIconOnly
							aria-label={uiText("ui.settings")}
							onPress={onOpenSettings}
						>
							<Gear weight="fill" className="size-5" aria-hidden="true" />
						</Button>
					</IconRailTooltip>
				</div>
			</nav>
			<aside
				aria-label={panelContent ? uiText("ui.clips") : undefined}
				className="editor-inspector [--text-sm:0.8125rem] [--text-base:0.8125rem] flex w-[320px] min-h-0 flex-col"
			>
				<Card className="app-frame-surface min-h-0 flex-1 gap-0 overflow-hidden rounded-3xl bg-surface p-0 shadow-sm">
					{panelContent ?? (
						<>
							<header className="flex min-h-14 shrink-0 items-center justify-between gap-3 px-5 py-3">
								<Card.Title className="text-[14px]">
									{settingsPanelProps.selectedAnnotationId
										? selectedAnnotation?.type === "blur"
											? uiText("editing.mask", "Mask")
											: t("timeline.annotation.label", "Annotation")
										: (sections.find((section) => section.id === activeSection)
												?.label ??
											t(
												`settings.sections.${activeSection}`,
												activeSection.charAt(0).toUpperCase() +
													activeSection.slice(1),
											))}
								</Card.Title>
								{hasAdvanced && (
									<Switch
										size="sm"
										isSelected={advanced}
										onChange={(value) =>
											setAdvancedSections((current) => ({
												...current,
												[activeSection]: value,
											}))
										}
										aria-label={uiText("ui.advancedSettings")}
									>
										<Switch.Content>
											<Label className="text-xs">
												{uiText("ui.advanced")}
											</Label>
											<Switch.Control>
												<Switch.Thumb />
											</Switch.Control>
										</Switch.Content>
									</Switch>
								)}
							</header>
							{activeSection === "extensions" ? (
								<ExtensionManager />
							) : (
								<SettingsPanel {...settingsPanelProps} advanced={advanced} />
							)}
						</>
					)}
				</Card>
			</aside>
		</div>
	);
}
