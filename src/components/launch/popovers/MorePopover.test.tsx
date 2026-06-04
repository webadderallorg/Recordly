import {
	Children,
	type ComponentProps,
	type ReactElement,
	type ReactNode,
	isValidElement,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MorePopover } from "./MorePopover";

const requestClose = vi.fn();
const requestOpen = vi.fn();
const setLocale = vi.fn();
const setPreference = vi.fn();

const shortcutsState = {
	launchShortcuts: {
		startRecording: { key: "r", ctrl: true, shift: true },
		stopRecording: { key: "s", ctrl: true, shift: true },
		pauseRecording: { key: "p", ctrl: true, shift: true },
		resumeRecording: { key: "p", ctrl: true, shift: true, alt: true },
		muteMicrophone: { key: "m", ctrl: true, shift: true },
	},
	isMac: false,
};

const translations: Record<string, string> = {
	"recording.startRecording": "Start Recording",
	"recording.pause": "Pause",
	"recording.resume": "Resume",
	"recording.stop": "Stop",
	"recording.toggleMicrophoneMute": "Mute / Unmute Microphone",
	"recording.recordingsFolder": "Recordings Path",
	"recording.openVideoFile": "Open video file",
	"recording.openProject": "Open project",
	"recording.language": "Language",
	"recording.appearance": "Appearance",
	"common.light": "Light",
	"common.dark": "Dark",
	"common.system": "System",
};

vi.mock("@/contexts/ShortcutsContext", () => ({
	useShortcuts: () => shortcutsState,
}));

vi.mock("@/contexts/I18nContext", () => ({
	useI18n: () => ({ locale: "en", setLocale }),
	useScopedT: () => (key: string, fallback?: string) => translations[key] ?? fallback ?? key,
}));

vi.mock("@/contexts/ThemeContext", () => ({
	useTheme: () => ({ preference: "system", setPreference }),
}));

vi.mock("./LaunchPopoverCoordinator", () => ({
	useLaunchPopoverCoordinator: () => ({
		isOpen: () => true,
		requestOpen,
		requestClose,
	}),
}));

vi.mock("./PopoverScaffold", () => ({
	DropdownItem: ({
		onClick,
		children,
		trailing,
		disabled,
	}: {
		onClick: () => void;
		children: ReactNode;
		trailing?: ReactNode;
		disabled?: boolean;
	}) => (
		<button type="button" disabled={disabled} onClick={onClick}>
			<span>{children}</span>
			{trailing ? <span>{` ${String(trailing)}`}</span> : null}
		</button>
	),
	HudPopover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function createProps(overrides: Partial<ComponentProps<typeof MorePopover>> = {}) {
	return {
		trigger: <button type="button">More</button>,
		supportsHudCaptureProtection: false,
		hideHudFromCapture: false,
		recording: false,
		paused: false,
		countdownActive: false,
		onToggleHudCaptureProtection: vi.fn(),
		onChooseRecordingsDirectory: vi.fn(),
		onOpenVideoFile: vi.fn(),
		onOpenProjectBrowser: vi.fn(),
		onStartOrOpenSources: vi.fn(),
		onStopRecording: vi.fn(),
		onPauseRecording: vi.fn(),
		onResumeRecording: vi.fn(),
		onToggleMicrophoneMute: vi.fn(),
		showDevUpdatePreview: false,
		onPreviewUpdateUi: vi.fn(),
		appVersion: null,
		...overrides,
	};
}

function expandNode(node: ReactNode): ReactNode {
	if (Array.isArray(node)) {
		return node.map((child) => expandNode(child));
	}

	if (!isValidElement(node)) {
		return node;
	}

	if (typeof node.type === "function") {
		return expandNode(node.type(node.props));
	}

	const children = Children.map(node.props.children, (child) => expandNode(child));
	return { ...node, props: { ...node.props, children } };
}

function collectButtons(node: ReactNode): ReactElement[] {
	if (Array.isArray(node)) {
		return node.flatMap((child) => collectButtons(child));
	}

	if (!isValidElement(node)) {
		return [];
	}

	const childButtons = collectButtons(node.props.children);
	return node.type === "button" ? [node, ...childButtons] : childButtons;
}

function extractText(node: ReactNode): string {
	if (Array.isArray(node)) {
		return node.map((child) => extractText(child)).join("");
	}

	if (!isValidElement(node)) {
		return typeof node === "string" || typeof node === "number" ? String(node) : "";
	}

	return extractText(node.props.children);
}

function renderButtons(props: Partial<ComponentProps<typeof MorePopover>> = {}) {
	const tree = expandNode(<MorePopover {...createProps(props)} />);
	return collectButtons(tree);
}

function findButton(buttons: ReactElement[], text: string) {
	return buttons.find((button) => extractText(button).includes(text));
}

describe("MorePopover", () => {
	beforeEach(() => {
		requestClose.mockReset();
		requestOpen.mockReset();
		setLocale.mockReset();
		setPreference.mockReset();
		shortcutsState.isMac = false;
	});

	it("shows the start recording shortcut in idle state", () => {
		const buttons = renderButtons();
		const startButton = findButton(buttons, "Start Recording");

		expect(startButton).toBeDefined();
		expect(extractText(startButton)).toContain("Ctrl + Shift + R");
	});

	it("shows recording actions with state-aware shortcuts", () => {
		const buttons = renderButtons({ recording: true, paused: false });

		expect(extractText(findButton(buttons, "Pause"))).toContain("Ctrl + Shift + P");
		expect(extractText(findButton(buttons, "Stop"))).toContain("Ctrl + Shift + S");
		expect(extractText(findButton(buttons, "Mute / Unmute Microphone"))).toContain(
			"Ctrl + Shift + M",
		);
	});

	it("shows the resume shortcut when recording is paused", () => {
		const buttons = renderButtons({ recording: true, paused: true });

		expect(extractText(findButton(buttons, "Resume"))).toContain("Ctrl + Shift + Alt + P");
	});

	it("formats shortcuts for macOS display", () => {
		shortcutsState.isMac = true;
		const buttons = renderButtons();

		expect(extractText(findButton(buttons, "Start Recording"))).toContain("⌘ + ⇧ + R");
	});

	it("closes the popover and runs the selected action", () => {
		const onStartOrOpenSources = vi.fn();
		const buttons = renderButtons({ onStartOrOpenSources });
		const startButton = findButton(buttons, "Start Recording");

		expect(startButton).toBeDefined();

		startButton?.props.onClick();

		expect(requestClose).toHaveBeenCalledWith("more");
		expect(onStartOrOpenSources).toHaveBeenCalledTimes(1);
	});
});
