import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const launchWindowSource = readFileSync(new URL("./LaunchWindow.tsx", import.meta.url), "utf8");
const sourceFile = ts.createSourceFile(
	"LaunchWindow.tsx",
	launchWindowSource,
	ts.ScriptTarget.Latest,
	true,
	ts.ScriptKind.TSX,
);

function findElementByRef(refName: string): ts.JsxElement {
	let match: ts.JsxElement | undefined;

	function visit(node: ts.Node) {
		if (match) return;

		if (ts.isJsxOpeningElement(node)) {
			const ref = node.attributes.properties.find(
				(attribute): attribute is ts.JsxAttribute =>
					ts.isJsxAttribute(attribute) &&
					attribute.name.getText(sourceFile) === "ref" &&
					attribute.initializer?.getText(sourceFile) === `{${refName}}`,
			);
			if (ref && ts.isJsxElement(node.parent)) {
				match = node.parent;
				return;
			}
		}

		ts.forEachChild(node, visit);
	}

	visit(sourceFile);
	if (!match) throw new Error(`Could not find JSX element with ref ${refName}`);
	return match;
}

function getAttributeNames(element: ts.JsxElement): string[] {
	return element.openingElement.attributes.properties.flatMap((attribute) =>
		ts.isJsxAttribute(attribute) ? [attribute.name.getText(sourceFile)] : [],
	);
}

function getClassNameSource(element: ts.JsxElement): string {
	const className = element.openingElement.attributes.properties.find(
		(attribute): attribute is ts.JsxAttribute =>
			ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === "className",
	);
	return className?.initializer?.getText(sourceFile) ?? "";
}

describe("HUD pointer surface", () => {
	it("keeps the stationary layout wrapper click-through after the HUD moves", () => {
		const transformElement = findElementByRef("hudBarTransformRef");
		const layoutWrapper = transformElement.parent;

		expect(ts.isJsxElement(layoutWrapper)).toBe(true);
		if (!ts.isJsxElement(layoutWrapper)) return;

		expect(getClassNameSource(layoutWrapper)).toContain("pointer-events-none");
		expect(getClassNameSource(layoutWrapper)).not.toContain("pointer-events-auto");
		expect(getAttributeNames(layoutWrapper)).not.toContain("onMouseEnter");
		expect(getAttributeNames(layoutWrapper)).not.toContain("onMouseLeave");
	});

	it("makes the visibly transformed HUD bar interactive", () => {
		const hudBar = findElementByRef("hudBarRef");

		expect(getClassNameSource(hudBar)).toContain("pointer-events-auto");
		expect(getAttributeNames(hudBar)).toContain("onMouseEnter");
		expect(getAttributeNames(hudBar)).toContain("onMouseLeave");
	});
});
