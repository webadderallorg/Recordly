import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ExportSettingsMenu } from "./ExportSettingsMenu";

vi.mock("@/contexts/I18nContext", () => ({
	useScopedT: () => (key: string, fallback?: string) => fallback ?? key,
}));
vi.mock("@/components/billing/BillingProvider", () => ({ useOptionalBilling: () => null }));

it.each(["mp4", "gif"] as const)("shows %s frame rate in the main export settings", (format) => {
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
				advancedExportSettings={advanced}
				nvidiaCudaExportAvailable
			/>,
		);
	const basic = render(false);
	expect(basic).toContain("FPS");
	expect(basic).not.toContain("NVIDIA CUDA");
	if (format === "mp4") {
		expect(basic).toContain("Advanced");
		expect(render(true)).toContain("NVIDIA CUDA");
	} else {
		expect(basic).not.toContain("Advanced");
	}
});
