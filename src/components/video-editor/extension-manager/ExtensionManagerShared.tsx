import type { ExtensionInfo, MarketplaceExtension } from "@/lib/extensions";

export type ExtensionTab = "installed" | "browse";

export const TAB_OPTIONS: { value: ExtensionTab; labelKey: string }[] = [
	{ value: "browse", labelKey: "tabs.browse" },
	{ value: "installed", labelKey: "tabs.installed" },
];

export const EXTENSIONS_DOCS_URL = "https://marketplace.recordly.dev/extensions";
export const EXTENSIONS_SUBMIT_URL = "https://marketplace.recordly.dev/extensions/submit";

export type ExtensionDetailData =
	| { source: "installed"; ext: ExtensionInfo; isActive: boolean }
	| { source: "marketplace"; ext: MarketplaceExtension };

export function toSafeHttpUrl(value?: string): string | null {
	if (!value) return null;

	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:"
			? parsed.toString()
			: null;
	} catch {
		return null;
	}
}