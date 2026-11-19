import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ColorControl } from "@/components/ui/color-picker";
import { type AppLocale, SUPPORTED_LOCALES } from "@/i18n/config";
import { translateForLocale } from "@/i18n/messages";
import { GradientPicker } from "./GradientPicker";
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
	it.each([
		0, 1, 6,
	])("rejects gradients with %i colors before generating invalid stops", (count) => {
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

const gradientLocale = vi.hoisted(() => ({ value: "en" as AppLocale }));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useEffect: () => undefined,
	useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, () => {}],
}));
vi.mock("@/contexts/I18nContext", () => ({
	useScopedT:
		(namespace: string) =>
		(key: string, fallback?: string, values?: Record<string, string | number>) =>
			translateForLocale(gradientLocale.value, `${namespace}.${key}`, fallback, values),
}));

function gradientNodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
	if (Array.isArray(node)) return node.flatMap(gradientNodes);
	if (!node || typeof node !== "object") return [];
	const element = node as ReactElement<{ children?: ReactNode }>;
	return [element, ...gradientNodes(element.props?.children)];
}
function gradientText(node: ReactNode): string {
	if (Array.isArray(node)) return node.map(gradientText).join("");
	if (node == null || typeof node === "boolean") return "";
	if (typeof node !== "object") return String(node);
	return gradientText((node as ReactElement<{ children?: ReactNode }>).props.children);
}

it.each(
	SUPPORTED_LOCALES,
)("uses the localized numbered color label consistently in %s", (locale) => {
	gradientLocale.value = locale;
	const tree = GradientPicker({
		value: "#ffffff",
		presets: [],
		onChange: vi.fn(),
		tileClassName: () => "",
		open: true,
	});
	const elements = gradientNodes(tree);
	const rowLabels = elements.filter(
		(node) => node.type === "span" && node.props.className === "text-sm text-muted",
	);
	const controls = elements.filter((node) => node.type === ColorControl);
	expect(rowLabels).toHaveLength(2);
	expect(controls).toHaveLength(2);
	for (const [index, row] of rowLabels.entries()) {
		const expected = translateForLocale(locale, "editing.colorNumber", undefined, {
			number: index + 1,
		});
		expect(expected).not.toBe("editing.colorNumber");
		expect(gradientText(row.props.children as ReactNode)).toBe(expected);
		expect(controls[index].props.label).toBe(expected);
	}
});
