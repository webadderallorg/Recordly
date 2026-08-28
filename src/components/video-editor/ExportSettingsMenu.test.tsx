import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import { ExportSettingsMenu } from "./ExportSettingsMenu";

vi.mock("motion/react", () => ({
	LayoutGroup: ({ children }: { children: ReactNode }) => children ?? null,
	motion: {
		span: ({ children }: { children?: ReactNode }) => children ?? null,
	},
}));

describe("ExportSettingsMenu", () => {
	it("renders the three GIF quality options", () => {
		const html = renderToStaticMarkup(
			<I18nProvider>
				<ExportSettingsMenu
					exportFormat="gif"
					exportQuality="source"
					exportEncodingMode="balanced"
					mp4FrameRate={30}
					gifFrameRate={15}
					gifLoop={true}
					gifSizePreset="medium"
					gifQualityPreset="balanced"
					gifOutputDimensions={{ width: 1280, height: 720 }}
				/>
			</I18nProvider>,
		);

		expect(html).toContain("High");
		expect(html).toContain("Balanced");
		expect(html).toContain("Small file");
	});
});
