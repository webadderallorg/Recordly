import { memo, type ComponentProps, type ReactNode } from "react";
import { AudioSection } from "../sections/AudioSection";
import { BackgroundSection } from "../sections/BackgroundSection";
import { CaptionsSection } from "../sections/CaptionsSection";
import { ClipSection } from "../sections/ClipSection";
import { CropSection } from "../sections/CropSection";
import { CursorSection } from "../sections/CursorSection";
import {
	ExtensionSettingsSection,
	SettingsExtensionPanels,
	type SettingsPanelExtension,
} from "../sections/ExtensionSettingsSection";
import { FrameSection } from "../sections/FrameSection";
import { GeneralSettingsSection } from "../sections/GeneralSettingsSection";
import { WebcamSection } from "../sections/WebcamSection";
import { ZoomSection } from "../sections/ZoomSection";
import type { EditorEffectSection } from "../../types";

function SectionLabel({ children }: { children: ReactNode }) {
	return (
		<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
			{children}
		</p>
	);
}

interface SettingsSectionRouterProps {
	activeEffectSection: EditorEffectSection;
	extensionPanels: SettingsPanelExtension[];
	backgroundProps: ComponentProps<typeof BackgroundSection>;
	frameProps: ComponentProps<typeof FrameSection>;
	cropProps: ComponentProps<typeof CropSection>;
	captionsProps: ComponentProps<typeof CaptionsSection>;
	zoomProps: ComponentProps<typeof ZoomSection>;
	audioProps: ComponentProps<typeof AudioSection>;
	clipProps: ComponentProps<typeof ClipSection>;
	cursorProps: ComponentProps<typeof CursorSection>;
	webcamProps: ComponentProps<typeof WebcamSection>;
	generalSettingsProps: ComponentProps<typeof GeneralSettingsSection>;
	isInitialLoading?: boolean;
}

export const SettingsSectionRouter = memo(({
	activeEffectSection,
	extensionPanels,
	backgroundProps,
	frameProps,
	cropProps,
	captionsProps,
	zoomProps,
	audioProps,
	clipProps,
	cursorProps,
	webcamProps,
	generalSettingsProps,
	isInitialLoading = false,
}: SettingsSectionRouterProps) => {
	const renderSceneSection = () => (
		<div className="space-y-4">
			<BackgroundSection {...backgroundProps} />
			<FrameSection {...frameProps} />
			<CropSection {...cropProps} />
			<SettingsExtensionPanels
				panels={extensionPanels}
				sections={["scene", "appearance", "frame", "crop"]}
				isInitialLoading={isInitialLoading}
			/>
		</div>
	);

	switch (activeEffectSection) {
		case "settings":
			return <GeneralSettingsSection {...generalSettingsProps} />;
		case "scene":
		case "frame":
		case "crop":
			return renderSceneSection();
		case "zoom":
			return <ZoomSection {...zoomProps} />;
		case "clip":
			return <ClipSection {...clipProps} />;
		case "audio":
			return <AudioSection {...audioProps} />;
		case "captions":
			return <CaptionsSection {...captionsProps} />;
		case "cursor":
			return <CursorSection {...cursorProps} />;
		case "webcam":
			return <WebcamSection {...webcamProps} />;
		default: {
			if (activeEffectSection?.startsWith("ext:")) {
				const panels = extensionPanels.filter(
					(p) =>
						!p.panel.parentSection &&
						`ext:${p.extensionId}/${p.panel.id}` === activeEffectSection,
				);
				if (panels.length > 0) {
					const p = panels[0];
					return (
						<section className="flex flex-col gap-2">
							<SectionLabel>{p.panel.label}</SectionLabel>
							<ExtensionSettingsSection
								extensionId={p.extensionId}
								label={p.panel.label}
								fields={p.panel.fields}
								isInitialLoading={isInitialLoading}
							/>
						</section>
					);
				}
			}
			return renderSceneSection();
		}
	}
});

SettingsSectionRouter.displayName = "SettingsSectionRouter";
