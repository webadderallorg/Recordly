import { beforeEach, expect, it, vi } from "vitest";

const raster = vi.hoisted(() => ({
	createCursorPackAsset: vi.fn(),
	createCursorStyleAsset: vi.fn(),
	createInvertedCursorAsset: vi.fn(),
	createPixelGloveAsset: vi.fn(),
	createRasterizedCursorAsset: vi.fn(),
}));
vi.mock("./cursorAssetRasterization", () => raster);
vi.mock("./cursorRenderConfig", () => ({
	BUILTIN_CURSOR_PACK_SOURCES: {},
	SUPPORTED_CURSOR_KEYS: ["arrow"],
	resolveCursorPackVariant: () => "default",
}));
vi.mock("./uploadedCursorAssets", () => ({
	cursorSetAssets: Object.fromEntries(
		["macos", "tahoe", "windows11", "bee", "catppuccin-pink", "breezex", "pixel-hand"].map(
			(style) => [style, { arrow: { url: `${style}-arrow` } }],
		),
	),
}));

beforeEach(() => {
	vi.resetModules();
	for (const create of Object.values(raster))
		create.mockReset().mockResolvedValue({ texture: {} });
});

it.each([
	"createCursorStyleAsset",
	"createInvertedCursorAsset",
] as const)("retries cursor initialization after a transient %s failure shared by concurrent callers", async (operation) => {
	const registry = await import("./cursorAssetRegistry");
	const failure = new Error("transient asset decoding failure");
	raster[operation].mockRejectedValueOnce(failure);
	const attempts = await Promise.allSettled([
		registry.preloadCursorAssets(),
		registry.preloadCursorAssets(),
	]);
	expect(attempts).toEqual([
		{ status: "rejected", reason: failure },
		{ status: "rejected", reason: failure },
	]);
	expect(registry.cursorAssetsPromise).toBeNull();
	await expect(registry.preloadCursorAssets()).resolves.toBeUndefined();
	expect(registry.getCursorAsset("arrow")).toBeDefined();
	expect(registry.getCursorStyleAsset("dot")).toBeDefined();
});
