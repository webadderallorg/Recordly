import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { HudTooltip } from "./HudTooltip";

function render(suppressed = false) {
	return renderToStaticMarkup(
		<HudTooltip label="Countdown delay: 3 sec" suppressed={suppressed}>
			<Button variant="ghost" size="icon" aria-label="Countdown delay">
				3
			</Button>
		</HudTooltip>,
	);
}

describe("HudTooltip", () => {
	it("renders the trigger without opening the tooltip", () => {
		const html = render();
		expect(html).toContain('aria-label="Countdown delay"');
		expect(html).not.toContain('role="tooltip"');
	});

	it("adds no wrapper element, so HUD child selectors still match the button", () => {
		expect(render()).toMatch(/^<button/);
	});

	it("does not fall back to a native title tooltip", () => {
		expect(render()).not.toContain("title=");
	});

	it("never marks itself as a HUD hit-test surface", () => {
		const html = render(true);
		expect(html).not.toContain("data-hud-interactive");
		expect(html).not.toContain("data-hud-surface");
	});
});
