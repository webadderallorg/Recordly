const path = require("node:path");
const tailwind = require("@tailwindcss/postcss");
const { list } = require("postcss");

const appSources = path.join(__dirname, "src") + path.sep;
const borderRadius = /^border(?:-[a-z]+){0,2}-radius$/;
const cssWideKeyword = /^(inherit|initial|unset|revert|revert-layer)$/i;

const squircleRadii = {
	postcssPlugin: "recordly-squircle-radii",
	OnceExit(root, { result }) {
		const source = result.opts.from;
		if (!source || !path.resolve(source).startsWith(appSources)) return;

		root.walkDecls(borderRadius, (declaration) => {
			const { parent, prop, value } = declaration;
			if (cssWideKeyword.test(value)) {
				if (prop === "border-radius" && value === "inherit") {
					declaration.cloneAfter({ prop: "corner-shape", value: "inherit" });
				}
				return;
			}
			if (parent.some((node) => node.prop === "corner-shape" && node.value === "round"))
				return;

			// Preserve one- to four-corner shorthands and elliptical x/y radii.
			declaration.value = list
				.split(value, ["/"], true)
				.map((axis) =>
					list
						.space(axis)
						.map((radius) =>
							radius === "0" || radius.includes("infinity")
								? radius
								: `calc(${radius} * var(--recordly-corner-radius-scale, 1))`,
						)
						.join(" "),
				)
				.join(" / ");
		});
	},
};

module.exports = { plugins: [tailwind(), squircleRadii] };
