import { describe, expect, it, vi } from "vitest";
import { DEFAULT_KEYSTROKE_OVERLAY } from "@/components/video-editor/videoPlayback/keystrokeOverlay/keystrokeTypes";
import { renderKeystrokes } from "./keystrokeRenderer";

function createContext() {
	return {
		save: vi.fn(),
		restore: vi.fn(),
		fill: vi.fn(),
		fillText: vi.fn(),
		beginPath: vi.fn(),
		moveTo: vi.fn(),
		lineTo: vi.fn(),
		closePath: vi.fn(),
		measureText: vi.fn((text: string) => ({ width: String(text).length * 10 })),
		font: "",
		fillStyle: "",
		textAlign: "left" as const,
		textBaseline: "alphabetic" as const,
		globalAlpha: 1,
	};
}

describe("renderKeystrokes", () => {
	it("does not draw when the overlay is disabled", () => {
		const ctx = createContext();
		renderKeystrokes(
			ctx as unknown as CanvasRenderingContext2D,
			[{ timeMs: 0, key: "c", modifiers: ["meta"] }],
			{ ...DEFAULT_KEYSTROKE_OVERLAY, enabled: false },
			960,
			540,
			0,
		);
		expect(ctx.fillText).not.toHaveBeenCalled();
	});

	it("does not draw when there are no samples", () => {
		const ctx = createContext();
		renderKeystrokes(
			ctx as unknown as CanvasRenderingContext2D,
			[],
			{ ...DEFAULT_KEYSTROKE_OVERLAY, enabled: true },
			960,
			540,
			0,
		);
		expect(ctx.fillText).not.toHaveBeenCalled();
	});
});
