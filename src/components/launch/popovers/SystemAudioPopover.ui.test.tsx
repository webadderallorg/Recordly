import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SystemAudioPopover } from "./SystemAudioPopover";

vi.mock("@/contexts/I18nContext", () => ({
	useScopedT: () => (key: string) => key,
}));

vi.mock("@/hooks/useAudioOutputLevels", () => ({
	useAudioOutputLevels: () => ({}),
}));

vi.mock("./LaunchPopoverCoordinator", () => ({
	useLaunchPopoverCoordinator: () => ({
		isOpen: () => true,
		requestOpen: vi.fn(),
		requestClose: vi.fn(),
	}),
}));

vi.mock("./PopoverScaffold", () => ({
	DropdownItem: ({ children, selected }: { children: string; selected?: boolean }) => (
		<button
			type="button"
			data-testid="dropdown-item"
			data-selected={selected ? "true" : "false"}
		>
			{children}
		</button>
	),
	HudPopover: ({ children }: { children: unknown }) => <div>{children}</div>,
}));

describe("SystemAudioPopover UI states", () => {
	it("does not highlight the turn-off row when system audio is enabled", () => {
		const html = renderToStaticMarkup(
			<SystemAudioPopover
				trigger={<button type="button" />}
				systemAudioEnabled
				onToggleSystemAudio={() => undefined}
				devices={[]}
				onSelectDevice={() => undefined}
			/>,
		);

		expect(html).toContain('data-testid="dropdown-item" data-selected="false"');
	});
});
