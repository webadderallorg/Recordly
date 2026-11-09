import {
	createCursorPackAsset,
	createCursorStyleAsset,
	createInvertedCursorAsset,
	createPixelGloveAsset,
	createRasterizedCursorAsset,
} from "./cursorAssetRasterization";
import {
	BUILTIN_CURSOR_PACK_SOURCES,
	CursorAssetKey,
	CursorPackSource,
	CursorPackStyle,
	LoadedCursorAsset,
	LoadedCursorPackAssets,
	resolveCursorPackVariant,
	SingleCursorStyle,
	StatefulCursorStyle,
	SUPPORTED_CURSOR_KEYS,
} from "./cursorRenderConfig";
import { cursorSetAssets } from "./uploadedCursorAssets";

export let cursorAssetsPromise: Promise<void> | null = null;

export let cursorPackAssetsPromise: Promise<void> | null = null;

export let loadedCursorPackSourcesSignature = "";

export let loadedCursorAssets: Partial<Record<CursorAssetKey, LoadedCursorAsset>> = {};

export let loadedCursorSetAssets: Partial<
	Record<StatefulCursorStyle, Partial<Record<CursorAssetKey, LoadedCursorAsset>>>
> = {};

export let loadedCursorStyleAssets: Partial<Record<SingleCursorStyle, LoadedCursorAsset>> = {};

export let loadedCursorPackAssets: Partial<Record<string, LoadedCursorPackAssets>> = {};

export const warnedMissingCursorPackStyles = new Set<string>();

export function getCursorPackSources(): Record<string, CursorPackSource> {
	return { ...BUILTIN_CURSOR_PACK_SOURCES };
}

export function buildCursorPackSourcesSignature(sources: Record<string, CursorPackSource>): string {
	return Object.entries(sources)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(
			([style, source]) =>
				`${style}:${source.defaultUrl}:${source.pointerUrl}:${source.defaultAnchor.x}:${source.defaultAnchor.y}:${source.pointerAnchor.x}:${source.pointerAnchor.y}`,
		)
		.join("|");
}

export function getCursorAsset(key: CursorAssetKey): LoadedCursorAsset {
	const asset = loadedCursorAssets[key];
	if (!asset) {
		throw new Error(`Missing cursor asset for ${key}`);
	}

	return asset;
}

export function getAvailableCursorKeys(): CursorAssetKey[] {
	const loadedKeys = Object.keys(loadedCursorAssets) as CursorAssetKey[];
	return loadedKeys.length > 0 ? loadedKeys : ["arrow"];
}

export function getCursorStyleAsset(style: SingleCursorStyle) {
	const asset = loadedCursorStyleAssets[style];
	if (!asset) {
		throw new Error(`Missing cursor style asset for ${style}`);
	}

	return asset;
}

export function getCursorPackStyleAsset(style: CursorPackStyle, key: CursorAssetKey) {
	const styleAssets = loadedCursorPackAssets[style];
	if (!styleAssets) {
		if (!warnedMissingCursorPackStyles.has(style)) {
			warnedMissingCursorPackStyles.add(style);
			console.warn(
				`[CursorRenderer] Missing cursor pack assets for ${style}; falling back to Tahoe cursors.`,
			);
		}
		return getStatefulCursorAsset("tahoe", key);
	}

	const variant = resolveCursorPackVariant(key);
	return styleAssets[variant] ?? styleAssets.default;
}

export function getStatefulCursorAsset(style: StatefulCursorStyle, key: CursorAssetKey) {
	const assetMap = loadedCursorSetAssets[style] ?? loadedCursorAssets;
	const asset = assetMap[key] ?? assetMap.arrow;
	if (!asset) {
		throw new Error(`Missing ${style} cursor asset for ${key}`);
	}

	return asset;
}

export async function ensureCursorPackAssetsLoaded() {
	const sources = getCursorPackSources();
	const signature = buildCursorPackSourcesSignature(sources);

	if (!cursorPackAssetsPromise || loadedCursorPackSourcesSignature !== signature) {
		loadedCursorPackSourcesSignature = signature;
		warnedMissingCursorPackStyles.clear();
		cursorPackAssetsPromise = (async () => {
			const cursorPackEntries = await Promise.all(
				Object.entries(sources).map(async ([style, source]) => {
					try {
						const [defaultAsset, pointerAsset] = await Promise.all([
							createCursorPackAsset(source.defaultUrl, source.defaultAnchor),
							createCursorPackAsset(source.pointerUrl, source.pointerAnchor),
						]);
						return [style, { default: defaultAsset, pointer: pointerAsset }] as const;
					} catch (error) {
						console.warn(
							`[CursorRenderer] Failed to load cursor pack style for: ${style}`,
							error,
						);
						return null;
					}
				}),
			);

			loadedCursorPackAssets = Object.fromEntries(
				cursorPackEntries.filter(Boolean).map((entry) => entry!),
			) as Partial<Record<string, LoadedCursorPackAssets>>;
		})();
	}

	await cursorPackAssetsPromise;
}

export async function preloadCursorAssets() {
	if (!cursorAssetsPromise) {
		cursorAssetsPromise = (async () => {
			async function loadCursorSet(
				style: keyof typeof cursorSetAssets,
			): Promise<Partial<Record<CursorAssetKey, LoadedCursorAsset>>> {
				const entries = await Promise.all(
					SUPPORTED_CURSOR_KEYS.map(async (key) => {
						const sourceAsset = cursorSetAssets[style][key];
						if (!sourceAsset?.url) {
							console.warn(`[CursorRenderer] No cursor image for: ${style}/${key}`);
							return null;
						}

						try {
							const asset =
								style === "pixel-hand"
									? await createPixelGloveAsset(
											sourceAsset.url,
											sourceAsset.fallbackAnchor,
										)
									: await createRasterizedCursorAsset(
											sourceAsset.url,
											sourceAsset.fallbackAnchor,
											{
												preserveCanvas: sourceAsset.preserveCanvas,
												hasBakedShadow: sourceAsset.hasBakedShadow,
											},
										);

							return [key, asset] as const;
						} catch (error) {
							console.warn(
								`[CursorRenderer] Failed to load cursor image for: ${style}/${key}`,
								error,
							);
							return null;
						}
					}),
				);

				return Object.fromEntries(
					entries.filter(Boolean).map((entry) => entry!),
				) as Partial<Record<CursorAssetKey, LoadedCursorAsset>>;
			}

			const [
				macosAssets,
				tahoeAssets,
				windows11Assets,
				beeAssets,
				pastelAssets,
				linuxAssets,
				pixelAssets,
			] = await Promise.all([
				loadCursorSet("macos"),
				loadCursorSet("tahoe"),
				loadCursorSet("windows11"),
				loadCursorSet("bee"),
				loadCursorSet("catppuccin-pink"),
				loadCursorSet("breezex"),
				loadCursorSet("pixel-hand"),
			]);

			const invertedEntries = await Promise.all(
				(Object.entries(tahoeAssets) as Array<[CursorAssetKey, LoadedCursorAsset]>).map(
					async ([key, asset]) => [key, await createInvertedCursorAsset(asset)] as const,
				),
			);

			loadedCursorSetAssets = {
				bee: beeAssets,
				"catppuccin-pink": pastelAssets,
				breezex: linuxAssets,
				"pixel-hand": pixelAssets,
				macos: macosAssets,
				tahoe: tahoeAssets,
				windows11: windows11Assets,
				"tahoe-inverted": Object.fromEntries(invertedEntries) as Partial<
					Record<CursorAssetKey, LoadedCursorAsset>
				>,
			};
			loadedCursorAssets = tahoeAssets;

			const customStyleEntries = await Promise.all(
				(["dot", "figma"] as const).map(
					async (style) => [style, await createCursorStyleAsset(style)] as const,
				),
			);

			loadedCursorStyleAssets = Object.fromEntries(customStyleEntries) as Partial<
				Record<SingleCursorStyle, LoadedCursorAsset>
			>;

			if (!loadedCursorAssets.arrow) {
				throw new Error("Failed to initialize the fallback arrow cursor asset");
			}
		})().catch((error) => {
			cursorAssetsPromise = null;
			throw error;
		});
	}

	await cursorAssetsPromise;
	await ensureCursorPackAssetsLoaded();
}
