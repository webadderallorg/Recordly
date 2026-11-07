import { describe, expect, it } from "vitest";
import {
	createCustomGradient,
	normalizeCustomGradients,
	parseCustomGradient,
} from "./customGradients";
import { normalizeEditorPreferences } from "./editorPreferences";

describe("custom gradient backgrounds", () => {
	it("creates explicit evenly spaced stops and normalizes the direction", () => {
		expect(
			createCustomGradient({ angle: -90, colors: ["#FF0000", "#00FF00", "#0000FF"] }),
		).toBe("linear-gradient(270deg, #ff0000 0%, #00ff00 50%, #0000ff 100%)");
	});
	it.each([0, 1, 6])("rejects gradients with %i colors before generating invalid stops", (count) => {
		expect(() =>
			createCustomGradient({ angle: 135, colors: Array(count).fill("#123456") }),
		).toThrow(RangeError);
	});
	it("round trips a five-color gradient through saved preferences", () => {
		const definition = {
			angle: 45,
			colors: ["#112233", "#223344", "#334455", "#445566", "#556677"],
		};
		const css = createCustomGradient(definition);
		expect(parseCustomGradient(css)).toEqual(definition);
		expect(normalizeEditorPreferences({ customGradients: [css, css] }).customGradients).toEqual(
			[css],
		);
		expect(normalizeEditorPreferences({}).customGradients).toEqual([]);
	});
	it("ignores invalid saved values and non-gradient CSS", () => {
		for (const value of [
			null,
			{},
			"url(https://example.com/image)",
			"linear-gradient(90deg, red, blue)",
			"linear-gradient(90deg, #000000 100%, #ffffff 0%)",
			"linear-gradient(90deg, #000000 0%)",
		]) {
			expect(parseCustomGradient(value)).toBeNull();
			expect(normalizeCustomGradients([value])).toEqual([]);
		}
	});
});
