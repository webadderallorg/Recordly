import type { Application, Container } from "pixi.js";

type PixiInitializationState = "initializing" | "initialized" | "failed";
type PixiInitOptions = Parameters<Application["init"]>[0];

const initializationStates = new WeakMap<Application, PixiInitializationState>();
const destroyRequests = new WeakSet<Application>();
const destroyContexts = new WeakMap<Application, string>();
const completedCleanups = new WeakSet<Application>();

const RENDERER_DESTROY_OPTIONS = {
	removeView: true,
	releaseGlobalResources: false,
} as const;

const STAGE_DESTROY_OPTIONS = {
	children: true,
	texture: false,
	textureSource: false,
} as const;

function reportCleanupError(app: Application, error: unknown): void {
	const context = destroyContexts.get(app) ?? "Pixi application";
	console.warn(`[PixiApplication] Failed to clean up ${context}:`, error);
}

function destroyFailedApplication(app: Application): void {
	const partialApp = app as Partial<Application>;

	try {
		partialApp.stage?.destroy(STAGE_DESTROY_OPTIONS);
	} catch (error) {
		reportCleanupError(app, error);
	}

	try {
		partialApp.renderer?.destroy(RENDERER_DESTROY_OPTIONS);
	} catch (error) {
		reportCleanupError(app, error);
	}
}

function completeDestroy(app: Application): void {
	if (completedCleanups.has(app)) return;
	completedCleanups.add(app);

	if (initializationStates.get(app) !== "initialized") {
		destroyFailedApplication(app);
		return;
	}

	try {
		app.destroy(RENDERER_DESTROY_OPTIONS, STAGE_DESTROY_OPTIONS);
	} catch (error) {
		reportCleanupError(app, error);
	}
}

export type PixiRendererBackend = "webgpu" | "webgl";

/**
 * Detects whether a Pixi application initialized with or fell back to an unsupported 2D canvas renderer.
 *
 * @param app - The Pixi Application instance to inspect.
 * @returns True if the renderer is a canvas fallback, false otherwise.
 */
export function isCanvasRenderer(app: Application | null | undefined): boolean {
	const rendererName = app?.renderer?.constructor?.name?.toLowerCase();
	return Boolean(
		rendererName &&
			(rendererName.includes("canvasrenderer") || rendererName.includes("canvas")),
	);
}

/**
 * Identifies the actual initialized render backend of a Pixi application.
 *
 * Inspects `app.renderer.name`, `app.renderer.constructor.name`, and `app.renderer.type`
 * to determine whether the active renderer is WebGPU or WebGL.
 *
 * @param app - The Pixi Application instance to inspect.
 * @returns "webgpu" if WebGPU is active, "webgl" if WebGL is active, or null if unrecognized/canvas.
 */
export function identifyPixiRendererBackend(
	app: Application | null | undefined,
): PixiRendererBackend | null {
	const renderer = app?.renderer;
	if (!renderer || isCanvasRenderer(app)) return null;

	const rendererName = typeof renderer.name === "string" ? renderer.name.toLowerCase() : "";
	if (rendererName === "webgpu") return "webgpu";
	if (rendererName === "webgl") return "webgl";

	const constructorName = renderer.constructor?.name?.toLowerCase() ?? "";
	if (constructorName.includes("webgpu")) return "webgpu";
	if (constructorName.includes("webgl")) return "webgl";

	// PixiJS v8 RendererType: WEBGL = 1, WEBGPU = 2
	if (renderer.type === 2) return "webgpu";
	if (renderer.type === 1) return "webgl";

	return null;
}

/**
 * Initializes a Pixi application with lifecycle tracking and safe error teardown.
 *
 * @param app - The Pixi Application instance to initialize.
 * @param options - Initialization options passed to app.init().
 */
export async function initializePixiApplication(
	app: Application,
	options: PixiInitOptions,
): Promise<void> {
	if (initializationStates.has(app) || destroyRequests.has(app)) {
		throw new Error("Pixi application lifecycle has already started");
	}

	initializationStates.set(app, "initializing");
	try {
		await app.init(options);
		initializationStates.set(app, "initialized");
	} catch (error) {
		initializationStates.set(app, "failed");
		if (destroyRequests.has(app)) completeDestroy(app);
		throw error;
	}

	if (destroyRequests.has(app)) completeDestroy(app);
}

/**
 * Initializes a Pixi application with a timeout and returns the validated backend identity.
 *
 * If Pixi falls back internally (for instance, when requested WebGPU preference falls back
 * to WebGL), the returned backend reflects the actual initialized renderer rather than
 * assuming the requested preference was honored.
 *
 * @param app - The Pixi Application instance to initialize.
 * @param options - Pixi initialization options (including renderer preference).
 * @param timeoutMs - Maximum duration in milliseconds allowed for initialization.
 * @param backendLabel - Human-readable label for error reporting (e.g. "webgpu" or "webgl").
 * @returns Promise resolving to the actual initialized backend ("webgpu" or "webgl").
 */
export async function initializePixiApplicationWithTimeout(
	app: Application,
	options: PixiInitOptions,
	timeoutMs: number,
	backendLabel: string,
): Promise<PixiRendererBackend> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => {
			reject(
				new Error(
					`Initialization timed out after ${timeoutMs}ms for ${backendLabel} renderer`,
				),
			);
		}, timeoutMs);
	});

	try {
		await Promise.race([initializePixiApplication(app, options), timeoutPromise]);
	} finally {
		if (timeoutId !== undefined) clearTimeout(timeoutId);
	}

	const identifiedBackend = identifyPixiRendererBackend(app);
	if (identifiedBackend) {
		return identifiedBackend;
	}

	return backendLabel === "webgpu" ? "webgpu" : "webgl";
}

/**
 * Safely tears down a Pixi application and its stage/renderer without unhandled exceptions.
 *
 * @param app - The Pixi Application instance to destroy, or null.
 * @param context - Human-readable description of the caller for error logging.
 */
export function destroyPixiApplication(app: Application | null, context: string): void {
	if (!app || destroyRequests.has(app) || completedCleanups.has(app)) return;

	destroyRequests.add(app);
	destroyContexts.set(app, context);
	if (initializationStates.get(app) !== "initializing") completeDestroy(app);
}

/**
 * Destroys a Pixi display container and removes it from its parent hierarchy.
 *
 * @param container - The Container instance to destroy, or null.
 */
export function destroyPixiContainer(container: Container | null): void {
	if (!container || container.destroyed) return;
	container.parent?.removeChild(container);
	container.destroy();
}

export const CANVAS_RENDERER_NOT_IMPLEMENTED_HINT = "CanvasRenderer is not yet implemented";
export const CANVAS_RENDERER_FALLBACK_MESSAGE =
	"WebGL is unavailable or GPU acceleration is disabled (PixiJS v8 CanvasRenderer fallback is not implemented)";

/**
 * Formats a Pixi renderer initialization error, converting cryptic fallback messages
 * (such as "CanvasRenderer is not yet implemented") into user-friendly explanations.
 *
 * @param error - The caught error object or message.
 * @returns A formatted, human-readable error description.
 */
export function formatPixiRendererErrorMessage(error: unknown): string {
	const message =
		error instanceof Error ? error.message : String(error ?? "Unknown renderer init error");
	if (message.includes(CANVAS_RENDERER_NOT_IMPLEMENTED_HINT)) {
		return CANVAS_RENDERER_FALLBACK_MESSAGE;
	}
	return message;
}


