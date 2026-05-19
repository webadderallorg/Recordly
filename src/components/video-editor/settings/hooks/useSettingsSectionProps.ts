import type { ComponentProps } from "react";
import { AudioSection } from "../sections/AudioSection";
import { BackgroundSection } from "../sections/BackgroundSection";
import { CaptionsSection } from "../sections/CaptionsSection";
import { ClipSection } from "../sections/ClipSection";
import { CropSection } from "../sections/CropSection";
import { CursorSection } from "../sections/CursorSection";
import { FrameSection } from "../sections/FrameSection";
import { GeneralSettingsSection } from "../sections/GeneralSettingsSection";
import { WebcamSection } from "../sections/WebcamSection";
import { ZoomSection } from "../sections/ZoomSection";

interface UseSettingsSectionPropsArgs {
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
}

export function createSettingsSectionProps(args: UseSettingsSectionPropsArgs) {
	return args;
}
