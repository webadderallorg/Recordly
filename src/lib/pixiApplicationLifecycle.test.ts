import type { Application } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import {
	destroyPixiApplication,
	initializePixiApplication,
	initializePixiApplicationWithTimeout,
} from "./pixiApplicationLifecycle";

function createApplication(init: () => Promise<void> = async () => undefined) {
	return {
		init: vi.fn(init),
		destroy: vi.fn(),
		stage: { destroy: vi.fn() },
		renderer: { destroy: vi.fn() },
	} as unknown as Application;
}

describe("Pixi application lifecycle", () => {
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
});
