import type { Application } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import {
	CANVAS_RENDERER_FALLBACK_MESSAGE,
	destroyPixiApplication,
	destroyPixiContainer,
	formatPixiRendererErrorMessage,
	identifyPixiRendererBackend,
	initializePixiApplication,
	initializePixiApplicationWithTimeout,
	isCanvasRenderer,
} from "./pixiApplicationLifecycle";

function createContainer(destroyed = false) {
	const container = {
		destroyed,
		destroy: vi.fn(() => {
			container.destroyed = true;
		}),
		parent: { removeChild: vi.fn() },
	};
	return container;
}

function createApplication(
	init: () => Promise<void> = async () => undefined,
	renderer: Record<string, unknown> = {},
) {
	return {
		init: vi.fn(init),
		destroy: vi.fn(),
		stage: { destroy: vi.fn() },
		renderer: Object.assign(renderer, {
			destroy: (renderer as { destroy?: unknown }).destroy ?? vi.fn(),
		}),
	} as unknown as Application;
}

describe("Pixi application lifecycle", () => {
	it("safely ignores display objects already destroyed by their application", () => {
		const liveContainer = createContainer();
		destroyPixiContainer(liveContainer as never);
		destroyPixiContainer(liveContainer as never);
		expect(liveContainer.parent.removeChild).toHaveBeenCalledTimes(1);
		expect(liveContainer.destroy).toHaveBeenCalledTimes(1);

		const destroyedContainer = createContainer(true);
		destroyPixiContainer(destroyedContainer as never);
		expect(destroyedContainer.parent.removeChild).not.toHaveBeenCalled();
		expect(destroyedContainer.destroy).not.toHaveBeenCalled();
	});

	it("cleans a failed initialization without running uninitialized plugins", async () => {
		const initializationError = new Error("No available renderer");
		const app = createApplication(async () => {
			throw initializationError;
		});
		const applicationDestroy = vi.mocked(app.destroy);
		applicationDestroy.mockImplementation(() => {
			throw new TypeError("this._cancelResize is not a function");
		});

		await expect(initializePixiApplication(app, {})).rejects.toBe(initializationError);
		expect(() => destroyPixiApplication(app, "test renderer init")).not.toThrow();

		expect(applicationDestroy).not.toHaveBeenCalled();
		expect(app.stage.destroy).toHaveBeenCalledWith({
			children: true,
			texture: false,
			textureSource: false,
		});
		expect(app.renderer.destroy).toHaveBeenCalledWith({
			removeView: true,
			releaseGlobalResources: false,
		});
	});

	it("destroys a successfully initialized application at most once", async () => {
		const app = createApplication();

		await initializePixiApplication(app, {});
		destroyPixiApplication(app, "test renderer");
		destroyPixiApplication(app, "test renderer");

		expect(app.destroy).toHaveBeenCalledTimes(1);
		expect(app.destroy).toHaveBeenCalledWith(
			{ removeView: true, releaseGlobalResources: false },
			{ children: true, texture: false, textureSource: false },
		);
	});

	it("defers teardown until an in-flight initialization settles", async () => {
		let finishInitialization: (() => void) | undefined;
		const app = createApplication(
			() =>
				new Promise<void>((resolve) => {
					finishInitialization = resolve;
				}),
		);
		const initialization = initializePixiApplication(app, {});

		destroyPixiApplication(app, "timed-out renderer init");
		expect(app.destroy).not.toHaveBeenCalled();

		finishInitialization?.();
		await initialization;

		expect(app.destroy).toHaveBeenCalledTimes(1);
	});

	it("reports cleanup errors without throwing or retrying unsafe teardown", async () => {
		const app = createApplication();
		const cleanupError = new Error("renderer cleanup failed");
		vi.mocked(app.destroy).mockImplementation(() => {
			throw cleanupError;
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		await initializePixiApplication(app, {});
		expect(() => destroyPixiApplication(app, "test renderer")).not.toThrow();
		expect(() => destroyPixiApplication(app, "test renderer")).not.toThrow();

		expect(app.destroy).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(
			"[PixiApplication] Failed to clean up test renderer:",
			cleanupError,
		);
		warn.mockRestore();
	});

	it("reports the backend when initialization times out", async () => {
		vi.useFakeTimers();
		try {
			const app = createApplication(() => new Promise<void>(() => undefined));
			const initialization = initializePixiApplicationWithTimeout(app, {}, 250, "webgpu");
			const rejection = initialization.catch((error: unknown) => error);

			await vi.advanceTimersByTimeAsync(250);

			await expect(rejection).resolves.toEqual(
				new Error("Initialization timed out after 250ms for webgpu renderer"),
			);
		} finally {
			vi.useRealTimers();
		}
	});

	describe("formatPixiRendererErrorMessage", () => {
		it("maps CanvasRenderer is not yet implemented to friendly message", () => {
			const error = new Error("webgl: CanvasRenderer is not yet implemented (after 2ms)");
			expect(formatPixiRendererErrorMessage(error)).toBe(CANVAS_RENDERER_FALLBACK_MESSAGE);
		});

		it("returns standard error message for other errors", () => {
			const error = new Error("WebGPU initialization failed");
			expect(formatPixiRendererErrorMessage(error)).toBe("WebGPU initialization failed");
		});

		it("handles non-Error objects safely", () => {
			expect(formatPixiRendererErrorMessage("string error")).toBe("string error");
			expect(formatPixiRendererErrorMessage(null)).toBe("Unknown renderer init error");
		});
	});

	describe("identifyPixiRendererBackend and isCanvasRenderer", () => {
		it("identifies webgpu from renderer name", () => {
			const app = createApplication(undefined, { name: "webgpu" });
			expect(identifyPixiRendererBackend(app)).toBe("webgpu");
			expect(isCanvasRenderer(app)).toBe(false);
		});

		it("identifies webgl from renderer name", () => {
			const app = createApplication(undefined, { name: "webgl" });
			expect(identifyPixiRendererBackend(app)).toBe("webgl");
			expect(isCanvasRenderer(app)).toBe(false);
		});

		it("identifies webgpu from renderer constructor", () => {
			class WebGPURenderer {
				destroy = vi.fn();
			}
			const app = createApplication(undefined, new WebGPURenderer() as never);
			expect(identifyPixiRendererBackend(app)).toBe("webgpu");
		});

		it("identifies webgl from renderer constructor", () => {
			class WebGLRenderer {
				destroy = vi.fn();
			}
			const app = createApplication(undefined, new WebGLRenderer() as never);
			expect(identifyPixiRendererBackend(app)).toBe("webgl");
		});

		it("identifies webgl from renderer type 1 and webgpu from renderer type 2", () => {
			const appGl = createApplication(undefined, { type: 1 });
			expect(identifyPixiRendererBackend(appGl)).toBe("webgl");

			const appGpu = createApplication(undefined, { type: 2 });
			expect(identifyPixiRendererBackend(appGpu)).toBe("webgpu");
		});

		it("detects canvas renderer fallback and returns null for backend", () => {
			class CanvasRenderer {
				destroy = vi.fn();
			}
			const app = createApplication(undefined, new CanvasRenderer() as never);
			expect(isCanvasRenderer(app)).toBe(true);
			expect(identifyPixiRendererBackend(app)).toBe(null);
		});

		it("returns null for missing application or renderer", () => {
			expect(identifyPixiRendererBackend(null)).toBe(null);
			expect(identifyPixiRendererBackend(undefined)).toBe(null);
			expect(isCanvasRenderer(null)).toBe(false);
		});
	});

	describe("initializePixiApplicationWithTimeout backend resolution", () => {
		it("resolves to actual webgl backend when requested webgpu falls back to webgl", async () => {
			const app = createApplication(undefined, { name: "webgl" });
			const resolvedBackend = await initializePixiApplicationWithTimeout(
				app,
				{ preference: "webgpu" },
				1000,
				"webgpu",
			);
			expect(resolvedBackend).toBe("webgl");
		});

		it("resolves to webgpu when webgpu is initialized", async () => {
			const app = createApplication(undefined, { name: "webgpu" });
			const resolvedBackend = await initializePixiApplicationWithTimeout(
				app,
				{ preference: "webgpu" },
				1000,
				"webgpu",
			);
			expect(resolvedBackend).toBe("webgpu");
		});
	});
});
