import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── In-memory settings store mock ─────────────────────────────────────────────
const settingsStore: Record<string, unknown> = {};

vi.mock("../../appSettingsStore", () => ({
	readAppSetting: (key: string) => settingsStore[key] ?? null,
	writeAppSetting: (key: string, value: unknown) => {
		settingsStore[key] = value;
	},
}));

// ── Electron mock ─────────────────────────────────────────────────────────────
const handlers: Record<string, (event: unknown, ...args: unknown[]) => unknown> = {};
const sentMessages: Array<{ channel: string; payload: unknown }> = [];

const mockWebContents = {
	isDestroyed: () => false,
	send: (channel: string, payload: unknown) => {
		sentMessages.push({ channel, payload });
	},
};

vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
			handlers[channel] = handler;
		},
	},
	webContents: {
		getAllWebContents: () => [mockWebContents],
	},
}));

// ── Import after mocks are set up ─────────────────────────────────────────────
import { registerFocusModeHandlers } from "./focusMode";

// ── Helpers ───────────────────────────────────────────────────────────────────
function invoke(channel: string, ...args: unknown[]) {
	const handler = handlers[channel];
	if (!handler) throw new Error(`No handler registered for channel "${channel}"`);
	return handler(null, ...args);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("focus mode IPC handlers", () => {
	beforeEach(() => {
		// Register handlers fresh for each test
		registerFocusModeHandlers();
		// Clear sent messages
		sentMessages.length = 0;
		// Reset the settings store
		for (const k of Object.keys(settingsStore)) {
			delete settingsStore[k];
		}
	});

	afterEach(() => {
		// Clean up registered handlers between tests
		for (const k of Object.keys(handlers)) {
			delete handlers[k];
		}
	});

	describe("get-focus-mode-status", () => {
		it("returns enabled:false when no stored value exists", () => {
			const result = invoke("get-focus-mode-status");
			expect(result).toEqual({ success: true, enabled: false, supported: true });
		});

		it("returns enabled:true when the setting is persisted as true", () => {
			settingsStore["focusModeEnabled"] = true;
			const result = invoke("get-focus-mode-status");
			expect(result).toEqual({ success: true, enabled: true, supported: true });
		});

		it("coerces a non-boolean truthy stored value to false (strict equality check)", () => {
			// The handler uses `stored === true` — only exact boolean true is accepted.
			settingsStore["focusModeEnabled"] = 1;
			const result = invoke("get-focus-mode-status");
			expect(result).toEqual({ success: true, enabled: false, supported: true });
		});
	});

	describe("set-focus-mode", () => {
		it("enables focus mode and persists the setting", () => {
			const result = invoke("set-focus-mode", true);
			expect(result).toEqual({ success: true, enabled: true, supported: true });
			expect(settingsStore["focusModeEnabled"]).toBe(true);
		});

		it("disables focus mode and persists the setting", () => {
			settingsStore["focusModeEnabled"] = true;
			const result = invoke("set-focus-mode", false);
			expect(result).toEqual({ success: true, enabled: false, supported: true });
			expect(settingsStore["focusModeEnabled"]).toBe(false);
		});

		it("rejects a non-boolean payload (string)", () => {
			const result = invoke("set-focus-mode", "true") as {
				success: boolean;
				error?: string;
			};
			expect(result.success).toBe(false);
			expect(typeof result.error).toBe("string");
			// Setting should remain unchanged
			expect(settingsStore["focusModeEnabled"]).toBeUndefined();
		});

		it("rejects a non-boolean payload (number)", () => {
			const result = invoke("set-focus-mode", 1) as { success: boolean };
			expect(result.success).toBe(false);
		});

		it("rejects null payload", () => {
			const result = invoke("set-focus-mode", null) as { success: boolean };
			expect(result.success).toBe(false);
		});

		it("broadcasts focus-mode-changed to all renderer windows on success", () => {
			invoke("set-focus-mode", true);
			expect(sentMessages).toHaveLength(1);
			expect(sentMessages[0].channel).toBe("focus-mode-changed");
			expect(sentMessages[0].payload).toEqual({
				success: true,
				enabled: true,
				supported: true,
			});
		});

		it("does not broadcast on rejected non-boolean input", () => {
			invoke("set-focus-mode", "yes");
			expect(sentMessages).toHaveLength(0);
		});
	});

	describe("crash / restart recovery via persisted state", () => {
		it("restores enabled:true from the settings store on next get after abnormal exit", () => {
			// Simulate: the setting was persisted during a previous session
			settingsStore["focusModeEnabled"] = true;
			// On next app launch the handler reads the store
			const result = invoke("get-focus-mode-status");
			expect(result).toEqual({ success: true, enabled: true, supported: true });
		});
	});

	describe("supported is always true (in-app suppression)", () => {
		it("get always returns supported:true", () => {
			const result = invoke("get-focus-mode-status") as { supported: boolean };
			expect(result.supported).toBe(true);
		});

		it("set always returns supported:true on success", () => {
			const result = invoke("set-focus-mode", false) as { supported: boolean };
			expect(result.supported).toBe(true);
		});
	});
});
