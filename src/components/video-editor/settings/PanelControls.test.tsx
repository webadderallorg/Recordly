import { TagGroup } from "@heroui/react";
import {
	Children,
	type ComponentProps,
	type ElementType,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { ChoiceGroup } from "@/components/ui/choice-group";
import { ColorControl } from "@/components/ui/color-picker";
import { TextArea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroupItem } from "@/components/ui/toggle-group";
import { DEFAULT_EDITOR_PREFERENCES } from "../editorPreferences";
import { SliderControl } from "../SliderControl";
import { type AnnotationRegion, DEFAULT_ANNOTATION_STYLE } from "../types";
import { AnnotationTextSettings } from "./AnnotationTextSettings";
import { AudioSettings, audioSettingsKeys } from "./AudioSettings";
import { ClipSettings, clipSettingsKeys } from "./ClipSettings";
import { CropSettings } from "./CropSettings";
import { ExportChoices } from "./ExportChoices";
import { SettingsPanelShell, settingsPanelShellKeys } from "./SettingsPanelShell";
import { pickSettingsProps, resolveSettingsPanelProps } from "./settingsPanelDefaults";
import { ZoomSettings, zoomSettingsKeys } from "./ZoomSettings";

vi.mock("@/contexts/I18nContext", () => ({
	useI18n: () => ({ locale: "en", t: (key: string, fallback?: string) => fallback ?? key }),
	useScopedT: () => (key: string, fallback?: string) => fallback ?? key,
}));

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
	expect(element, "Expected this controlled input").toBeDefined();
	return element!.props as ComponentProps<T>;
}
function panel(
	overrides: Parameters<typeof resolveSettingsPanelProps>[0] extends infer P
		? Partial<P>
		: never = {},
) {
	return resolveSettingsPanelProps({
		selected: "wallpaper.png",
		aspectRatio: "16:9",
		...overrides,
	});
}

function renderWithHooks(render: () => ReactNode): ReactNode {
	let tree: ReactNode;
	function Capture() {
		tree = render();
		return null;
	}
	// Capture controlled callbacks while a real React dispatcher owns the shell's hooks.
	renderToStaticMarkup(<Capture />);
	return tree;
}

describe("crop controls", () => {
	it.each([
		["Top", 25, { x: 0.1, y: 0.25, width: 0.8, height: 0.55 }],
		["Bottom", 40, { x: 0.1, y: 0.2, width: 0.8, height: 0.4 }],
		["Left", 25, { x: 0.25, y: 0.2, width: 0.65, height: 0.6 }],
		["Right", 40, { x: 0.1, y: 0.2, width: 0.5, height: 0.6 }],
	] as const)("preserves the opposite edge when changing %s", (label, value, expected) => {
		const onCropChange = vi.fn();
		const tree = CropSettings({
			cropRegion: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 },
			onCropChange,
		});
		control(tree, SliderControl, (p) => p.label === label).onChange(value);
		const actual = onCropChange.mock.calls[0][0];
		for (const key of ["x", "y", "width", "height"] as const)
			expect(actual[key]).toBeCloseTo(expected[key]);
	});
	it("keeps a minimum crop extent and resets all insets", () => {
		const onCropChange = vi.fn();
		const tree = CropSettings({
			cropRegion: { x: 0.5, y: 0.5, width: 0.2, height: 0.2 },
			onCropChange,
		});
		control(tree, SliderControl, (p) => p.label === "Right").onChange(99);
		expect(onCropChange).toHaveBeenLastCalledWith({ x: 0.5, y: 0.5, width: 0.05, height: 0.2 });
		control(tree, Button, (p) => p.children === "Reset").onClick?.();
		expect(onCropChange).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1, height: 1 });
	});
});

it("maps zoom choices and restores all animation defaults", () => {
	const callbacks = {
		onZoomModeChange: vi.fn(),
		onZoomDepthChange: vi.fn(),
		onCameraSpringStiffnessMultiplierChange: vi.fn(),
		onCameraSpringDampingMultiplierChange: vi.fn(),
		onCameraSpringMassMultiplierChange: vi.fn(),
		onZoomInDurationMsChange: vi.fn(),
		onZoomOutDurationMsChange: vi.fn(),
		onZoomClassicModeChange: vi.fn(),
	};
	const props = panel({ advanced: true, selectedZoomId: "zoom-1", ...callbacks });
	const tree = ZoomSettings(pickSettingsProps(props, zoomSettingsKeys));
	control(tree, ChoiceGroup, (p) => p["aria-label"] === "Zoom mode").onValueChange?.("manual");
	control(tree, ChoiceGroup, (p) => p["aria-label"] === "Zoom level").onValueChange?.("6");
	expect(callbacks.onZoomModeChange).toHaveBeenCalledWith("manual");
	expect(callbacks.onZoomDepthChange).toHaveBeenCalledWith(6);
	control(tree, Button, (p) => p.children === "Reset").onClick?.();
	for (const property of [
		"cameraSpringStiffnessMultiplier",
		"cameraSpringDampingMultiplier",
		"cameraSpringMassMultiplier",
		"zoomInDurationMs",
		"zoomOutDurationMs",
	] as const) {
		const callback =
			`on${property[0].toUpperCase()}${property.slice(1)}Change` as keyof typeof callbacks;
		expect(callbacks[callback]).toHaveBeenCalledWith(DEFAULT_EDITOR_PREFERENCES[property]);
	}
	expect(callbacks.onZoomClassicModeChange).toHaveBeenCalledWith(false);
});

it("clamps the preview speed while keeping unsupported saved speed visible and audio controls wired", () => {
	const onClipSpeedChange = vi.fn(),
		onClipMutedChange = vi.fn(),
		onResetClipAudio = vi.fn();
	const props = panel({
		selectedClipSpeed: 12,
		hasClipAudioOverrides: true,
		onClipSpeedChange,
		onClipMutedChange,
		onResetClipAudio,
	});
	const tree = ClipSettings({
		...pickSettingsProps(props, clipSettingsKeys),
		clipSpeedRange: { min: 0.5, max: 4 },
	});
	const speed = control(tree, SliderControl);
	expect(speed.value).toBe(4);
	expect(elements(tree).some((node) => node.props.children?.toString().includes("12"))).toBe(
		true,
	);
	speed.onChange(2);
	control(tree, Switch).onCheckedChange?.(true);
	control(tree, Button).onClick?.();
	expect(onClipSpeedChange).toHaveBeenCalledWith(2);
	expect(onClipMutedChange).toHaveBeenCalledWith(true);
	expect(onResetClipAudio).toHaveBeenCalledOnce();
});

it("resets volume and normalization together", () => {
	const onAudioVolumeChange = vi.fn(),
		onAudioNormalizeChange = vi.fn();
	const tree = AudioSettings(
		pickSettingsProps(
			panel({ onAudioVolumeChange, onAudioNormalizeChange }),
			audioSettingsKeys,
		),
	);
	control(tree, Button).onClick?.();
	expect(onAudioVolumeChange).toHaveBeenCalledWith(1);
	expect(onAudioNormalizeChange).toHaveBeenCalledWith(false);
});

it("deletes only the active selected timeline item", () => {
	const onZoomDelete = vi.fn(),
		onClipDelete = vi.fn();
	const tree = renderWithHooks(() =>
		SettingsPanelShell({
			...pickSettingsProps(
				panel({
					selectedZoomId: "zoom-1",
					selectedClipId: "clip-1",
					onZoomDelete,
					onClipDelete,
				}),
				settingsPanelShellKeys,
			),
			activeEffectSection: "zoom",
			children: null,
		}),
	);
	control(tree, Button).onClick?.();
	expect(onZoomDelete).toHaveBeenCalledWith("zoom-1");
	expect(onClipDelete).not.toHaveBeenCalled();
});

it("preserves numeric export choices and ignores all/empty selection", () => {
	const onChange = vi.fn();
	const tree = ExportChoices({
		label: "Frame rate",
		value: 30,
		options: [
			{ value: 30, label: "30 fps" },
			{ value: 60, label: "60 fps", plus: true },
		],
		onChange,
	});
	const group = control(tree, TagGroup);
	expect(group["aria-label"]).toBe("Frame rate");
	expect(group.selectedKeys).toEqual(["30"]);
	group.onSelectionChange?.("all");
	group.onSelectionChange?.(new Set());
	expect(onChange).not.toHaveBeenCalled();
	group.onSelectionChange?.(new Set(["60"]));
	expect(onChange).toHaveBeenCalledWith(60);
});

it("keeps annotation font fallback, text edits, formatting and transparent backgrounds", () => {
	const onStyleChange = vi.fn(),
		onContentChange = vi.fn();
	const annotation = {
		id: "note-1",
		type: "text",
		content: "Legacy text",
		style: {
			...DEFAULT_ANNOTATION_STYLE,
			fontFamily: '"Saved Font", sans-serif',
			fontWeight: "bold",
		},
	} as AnnotationRegion;
	const tree = AnnotationTextSettings({
		annotation,
		onStyleChange,
		onContentChange,
		customFonts: [],
		fontFamilies: [],
		onFontAdded: vi.fn(),
		colorPalette: ["#000000"],
	});
	expect(control(tree, Select, (p) => p.value === annotation.style.fontFamily).value).toBe(
		annotation.style.fontFamily,
	);
	control(tree, TextArea).onChange?.({
		target: { value: "Edited" },
	} as React.ChangeEvent<HTMLTextAreaElement>);
	control(tree, ToggleGroupItem, (p) => p.value === "bold").onClick?.(
		{} as React.MouseEvent<HTMLButtonElement>,
	);
	control(tree, ColorControl, (p) => p.label === "annotations.background").onClear?.();
	expect(onContentChange).toHaveBeenCalledWith("Edited");
	expect(onStyleChange).toHaveBeenCalledWith({ fontWeight: "normal" });
	expect(onStyleChange).toHaveBeenCalledWith({ backgroundColor: "transparent" });
});
