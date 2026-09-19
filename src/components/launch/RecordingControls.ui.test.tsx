import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RecordingControls } from "./RecordingControls";

vi.mock("@/contexts/I18nContext", () => ({
	useScopedT: () => (key: string) => key,
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({
		children,
		iconSize: _iconSize,
		variant: _variant,
		size: _size,
		...props
	}: {
		children: unknown;
		iconSize?: unknown;
		variant?: unknown;
		size?: unknown;
		[key: string]: unknown;
	}) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
}));

vi.mock("@/components/ui/separator", () => ({
	Separator: () => <span data-testid="separator" />,
}));

vi.mock("@phosphor-icons/react", () => ({
	MicrophoneIcon: () => <span data-testid="microphone-icon" />,
	MicrophoneSlashIcon: () => <span data-testid="microphone-slash-icon" />,
	SpeakerHighIcon: () => <span data-testid="speaker-high-icon" />,
	SpeakerXIcon: () => <span data-testid="speaker-x-icon" />,
	MinusIcon: () => <span data-testid="minus-icon" />,
	PauseIcon: () => <span data-testid="pause-icon" />,
	PlayIcon: () => <span data-testid="play-icon" />,
	XIcon: () => <span data-testid="x-icon" />,
}));

describe("RecordingControls audio indicators", () => {
	it("keeps a disabled system-audio indicator beside the microphone while recording", () => {
		const html = renderToStaticMarkup(
			<RecordingControls
				paused={false}
				microphoneEnabled
				systemAudioEnabled
				elapsed={5}
				onToggleMicrophone={() => undefined}
				onPauseResume={() => undefined}
				onStopRecording={() => undefined}
				onHideHud={() => undefined}
				onCancelRecording={() => undefined}
				formatTime={(seconds) => `${seconds}s`}
			/>,
		);

		expect(html).toContain('data-testid="microphone-icon"');
		expect(html).toContain('data-testid="speaker-high-icon"');
		expect(html.match(/disabled=""/g)).toHaveLength(2);
		expect(html).toContain('title="recording.systemAudioToggleDisabledTip"');
		expect(html).toContain('aria-label="recording.systemAudioToggleDisabledTip"');
	});
});
