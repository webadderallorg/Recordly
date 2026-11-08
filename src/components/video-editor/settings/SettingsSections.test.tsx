import { Dropdown, ProgressBar } from "@heroui/react";
import {
	Children,
	type ComponentProps,
	type ElementType,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { ChoiceGroup } from "@/components/ui/choice-group";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_EDITOR_PREFERENCES } from "../editorPreferences";
import { SliderControl } from "../SliderControl";
import {
	type CropRegion,
	DEFAULT_AUTO_CAPTION_SETTINGS,
	type WebcamOverlaySettings,
} from "../types";
import { WebcamCropControl } from "../WebcamCropControl";
import { CaptionGenerationSettings } from "./CaptionGenerationSettings";
import { CursorClickEffectCards } from "./CursorAppearancePreviews";
import { WebcamSettings } from "./WebcamSettings";

const language = vi.hoisted(() => ({ locale: "en" }));
vi.mock("@/contexts/I18nContext", () => ({
	useI18n: () => ({
		locale: language.locale,
		t: (key: string, fallback?: string) => fallback ?? key,
	}),
	useScopedT: () => (key: string, fallback?: string) => fallback ?? key,
}));

// Inspect each section's controlled UI contract without substituting its UI components.
function elements(tree: ReactNode): ReactElement<{ children?: ReactNode }>[] {
	return Children.toArray(tree).flatMap((child) =>
		isValidElement<{ children?: ReactNode }>(child)
			? [child, ...elements(child.props.children)]
			: [],
	);
}

function control<T extends ElementType>(
	tree: ReactNode,
	type: T,
	match: (props: ComponentProps<T>) => boolean = () => true,
): ComponentProps<T> {
	const element = elements(tree).find(
		(node) => node.type === type && match(node.props as ComponentProps<T>),
	);
	expect(element, "Expected the section to expose this control").toBeDefined();
	return element!.props as ComponentProps<T>;
}

function webcamView(overrides: Partial<ComponentProps<typeof WebcamSettings>> = {}) {
	const webcam: WebcamOverlaySettings = {
		...DEFAULT_EDITOR_PREFERENCES.webcam,
		enabled: true,
		sourcePath: "/recordings/camera.mp4",
		shape: "squircle",
		width: 40,
		height: 40,
		size: 40,
		timeOffsetMs: 75,
		visibleRanges: [{ startMs: 100, endMs: 2500 }],
	};
	return WebcamSettings({
		advanced: true,
		webcam,
		webcamPreviewSrc: "preview.mp4",
		webcamPreviewCurrentTime: 2,
		webcamPreviewPlaying: true,
		...overrides,
	});
}

function captionView(overrides: Partial<ComponentProps<typeof CaptionGenerationSettings>> = {}) {
	return CaptionGenerationSettings({
		advanced: true,
		captionCueCount: 2,
		autoCaptionSettings: { ...DEFAULT_AUTO_CAPTION_SETTINGS, fontFamily: "Saved font" },
		whisperModelPath: "/models/small.bin",
		whisperModelDownloadStatus: "downloaded",
		whisperModelDownloadProgress: 100,
		isGeneratingCaptions: false,
		...overrides,
	});
}

beforeEach(() => {
	language.locale = "en";
});

describe("webcam settings controls", () => {
	it("changes width and legacy size together while preserving footage and timing", () => {
		const onWebcamChange = vi.fn();
		const tree = webcamView({ onWebcamChange });
		control(tree, SliderControl, (props) => props.label === "Webcam Width").onChange(55);
		expect(onWebcamChange).toHaveBeenCalledWith(
			expect.objectContaining({
				width: 55,
				size: 55,
				height: 40,
				sourcePath: "/recordings/camera.mp4",
				timeOffsetMs: 75,
				visibleRanges: [{ startMs: 100, endMs: 2500 }],
			}),
		);
	});

	it("applies named positions and switches to custom when adjusting coordinates", () => {
		const onWebcamChange = vi.fn();
		const tree = webcamView({ onWebcamChange });
		control(tree, ChoiceGroup, (props) => props["aria-label"] === "Position").onValueChange?.(
			"top-left",
		);
		expect(onWebcamChange).toHaveBeenLastCalledWith(
			expect.objectContaining({
				positionPreset: "top-left",
				positionX: 0,
				positionY: 0,
				corner: "top-left",
			}),
		);
		control(tree, SliderControl, (props) => props.label === "Horizontal").onChange(35);
		expect(onWebcamChange).toHaveBeenLastCalledWith(
			expect.objectContaining({
				positionPreset: "custom",
				positionX: 0.35,
				positionY: DEFAULT_EDITOR_PREFERENCES.webcam.positionY,
				sourcePath: "/recordings/camera.mp4",
				timeOffsetMs: 75,
			}),
		);
	});

	it("forwards preview synchronization and adjusts crop height only with frame dimensions", () => {
		const onWebcamChange = vi.fn();
		const crop = control(webcamView({ onWebcamChange }), WebcamCropControl);
		expect(crop).toMatchObject({
			previewSrc: "preview.mp4",
			previewCurrentTime: 2,
			previewPlaying: true,
			previewTimeOffsetMs: 75,
		});
		const region: CropRegion = { x: 0, y: 0, width: 0.5, height: 1 };
		crop.onCropChange(region, { src: null, width: 100, height: 100 });
		expect(onWebcamChange).toHaveBeenLastCalledWith(
			expect.objectContaining({ cropRegion: region, width: 40, height: 80 }),
		);
		crop.onCropChange(region);
		expect(onWebcamChange).toHaveBeenLastCalledWith(
			expect.objectContaining({ cropRegion: region, width: 40, height: 40 }),
		);
	});

	it("shows only the import action when no webcam video is linked", () => {
		const onUploadWebcam = vi.fn();
		const tree = webcamView({ webcam: undefined, onUploadWebcam });
		control(tree, Button).onClick?.();
		expect(onUploadWebcam).toHaveBeenCalledOnce();
		expect(elements(tree).some((node) => node.type === SliderControl)).toBe(false);
	});
});

describe("caption generation settings controls", () => {
	it("automatically detects language and merges style edits into saved caption settings", () => {
		const onAutoCaptionSettingsChange = vi.fn();
		const tree = captionView({ onAutoCaptionSettingsChange });
		control(tree, SliderControl, (props) => props.label === "Rows").onChange(2.6);
		expect(onAutoCaptionSettingsChange).toHaveBeenLastCalledWith({
			...DEFAULT_AUTO_CAPTION_SETTINGS,
			fontFamily: "Saved font",
			maxRows: 3,
		});
	});

	it.each([
		{ whisperModelPath: null, isGeneratingCaptions: false, disabled: false },
		{ whisperModelPath: "/models/small.bin", isGeneratingCaptions: true, disabled: true },
		{ whisperModelPath: "/models/small.bin", isGeneratingCaptions: false, disabled: false },
	])("guards generation for model availability and progress: %j", ({ disabled, ...state }) => {
		const tree = captionView(state);
		const label = state.isGeneratingCaptions
			? "Generating..."
			: !state.whisperModelPath
				? "Download Model"
				: "Regenerate Captions";
		expect(control(tree, Button, (props) => props.children === label).disabled).toBe(disabled);
	});

	it("disables clearing an empty timeline and retains model download progress", () => {
		const tree = captionView({
			captionCueCount: 0,
			whisperModelPath: null,
			whisperModelDownloadStatus: "downloading",
			whisperModelDownloadProgress: 42.7,
		});
		expect(
			control(tree, Dropdown.Item, (props) => props.id === "clear-captions").isDisabled,
		).toBe(true);
		expect(control(tree, Button, (props) => props.disabled === true).disabled).toBe(true);
		expect(control(tree, ProgressBar).value).toBe(42.7);
		expect(
			control(tree, Dropdown.Item, (props) => props.id === "delete-model").isDisabled,
		).toBe(true);
	});

	it("routes the primary action to setup until the model is ready", () => {
		const onDownloadWhisperSmallModel = vi.fn();
		const onGenerateAutoCaptions = vi.fn();
		const tree = captionView({
			whisperModelPath: null,
			whisperModelDownloadStatus: "idle",
			onDownloadWhisperSmallModel,
			onGenerateAutoCaptions,
		});
		control(tree, Button, (props) => props.children === "Download Model").onClick?.(
			{} as never,
		);
		expect(onDownloadWhisperSmallModel).toHaveBeenCalledOnce();
		expect(onGenerateAutoCaptions).not.toHaveBeenCalled();
	});

	it("changes animation without resetting visibility or transcription preferences", () => {
		const onAutoCaptionSettingsChange = vi.fn();
		const autoCaptionSettings = {
			...DEFAULT_AUTO_CAPTION_SETTINGS,
			enabled: true,
			language: "fr",
			timelineQuickAdd: false,
			fontSize: 52,
		};
		const tree = captionView({ autoCaptionSettings, onAutoCaptionSettingsChange });
		control(tree, Select, (props) => props["aria-label"] === "Animation").onValueChange?.(
			"rise",
		);
		expect(onAutoCaptionSettingsChange).toHaveBeenCalledWith({
			...autoCaptionSettings,
			animationStyle: "rise",
		});
	});

	it("keeps the selected locale for fractional caption styling values", () => {
		language.locale = "fr";
		const radius = control(
			captionView(),
			SliderControl,
			(props) => props.label === "Box radius",
		);
		expect(radius.formatValue(17.5)).toBe("17,5px");
	});
});

it("clears a click-effect choice to none and forwards a selected effect", () => {
	const onApply = vi.fn();
	const tree = CursorClickEffectCards({
		title: "Click Effects",
		activeEffectId: "none",
		onApply,
		tSettings: (key, fallback) => fallback ?? key,
	});
	const choices = control(tree, ChoiceGroup);
	expect(choices.allowDeselect).toBe(true);
	choices.onValueChange?.("");
	expect(onApply).toHaveBeenCalledWith("none");
	choices.onValueChange?.("echo");
	expect(onApply).toHaveBeenCalledWith("echo");
});
