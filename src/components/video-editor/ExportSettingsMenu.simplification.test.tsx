import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ExportSettingsMenu } from "./ExportSettingsMenu";

vi.mock("@/contexts/I18nContext", () => ({
	useScopedT: () => (key: string, fallback?: string) => fallback ?? key,
}));
vi.mock("@/components/billing/BillingProvider", () => ({ useOptionalBilling: () => null }));

it.each([
	"mp4",
	"gif",
] as const)("keeps %s frame-rate and hardware choices under Advanced", (format) => {
	const render = (advanced: boolean) =>
		renderToStaticMarkup(
			<ExportSettingsMenu
				exportFormat={format}
				exportQuality="medium"
				exportEncodingMode="balanced"
				mp4FrameRate={30}
				gifFrameRate={15}
				gifLoop
				gifSizePreset="medium"
				gifOutputDimensions={{ width: 960, height: 540 }}
				advancedExportSettings={advanced}
				nvidiaCudaExportAvailable
			/>,
		);
	const basic = render(false);
	expect(basic).toContain("Advanced");
	expect(basic).not.toContain("FPS");
	expect(basic).not.toContain("NVIDIA CUDA");
	expect(render(true)).toContain("FPS");
	if (format === "mp4") expect(render(true)).toContain("NVIDIA CUDA");
});
