import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { UpdateToastWindow } from "./UpdateToastWindow";

describe("UpdateToastWindow", () => {
	it("does not render a placeholder while waiting for a toast payload", () => {
		expect(renderToStaticMarkup(<UpdateToastWindow />)).toBe("");
	});
});
