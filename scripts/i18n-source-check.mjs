import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export function auditSourceKeys(catalogs, sourceRoot = "src") {
	function walk(directory) {
		return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
			const file = path.join(directory, entry.name);
			return entry.isDirectory() ? walk(file) : [file];
		});
	}
	const files = walk(sourceRoot).filter(
		(f) => /\.tsx?$/.test(f) && !/(\.test\.|\.spec\.|\/dev\/)/.test(f),
	);
	const missing = [],
		dynamic = [],
		unknown = [];
	let count = 0;
	const has = (k) => {
		let v = catalogs;
		const parts = k.split(".");
		for (const [index, p] of parts.entries()) {
			if (v == null || typeof v !== "object") return false;
			if (index === parts.length - 1 && typeof v[p + "_other"] === "string") return true;
			if (!Object.hasOwn(v, p)) return false;
			v = v[p];
		}
		return typeof v === "string";
	};
	for (const file of files) {
		const source = ts.createSourceFile(
			file,
			fs.readFileSync(file, "utf8"),
			ts.ScriptTarget.Latest,
			true,
		);
		const scopes = new Map(),
			scopedHooks = new Set(["useScopedT"]),
			rootHooks = new Set(["useI18n"]),
			rootImports = new Set(["translate"]);
		for (const st of source.statements) {
			if (
				ts.isImportDeclaration(st) &&
				st.importClause?.namedBindings &&
				ts.isNamedImports(st.importClause.namedBindings)
			) {
				for (const e of st.importClause.namedBindings.elements) {
					const orig = (e.propertyName ?? e.name).text;
					if (orig === "useScopedT") scopedHooks.add(e.name.text);
					if (orig === "useI18n") rootHooks.add(e.name.text);
					if (orig === "translate" && /I18nContext|i18n/.test(st.moduleSpecifier.text))
						rootImports.add(e.name.text);
				}
			}
		}
		const isFn = (n) => ts.isFunctionLike(n);
		const isScope = (n) => ts.isSourceFile(n) || ts.isBlock(n) || isFn(n);
		function scopeOf(n) {
			for (let p = n; p; p = p.parent) if (scopes.has(p)) return scopes.get(p);
		}
		function lookup(name, n) {
			for (let p = n; p; p = p.parent) {
				let m = scopes.get(p);
				if (m?.has(name)) return m.get(name);
			}
			if (rootImports.has(name)) return { kind: "root" };
			return null;
		}
		function resolve(n) {
			if (!n) return null;
			if (ts.isIdentifier(n)) return lookup(n.text, n);
			if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
				if (
					scopedHooks.has(n.expression.text) &&
					n.arguments[0] &&
					ts.isStringLiteral(n.arguments[0])
				)
					return { kind: "scoped", namespace: n.arguments[0].text };
				if (rootHooks.has(n.expression.text)) return { kind: "context" };
			}
			return null;
		}
		function bind(n) {
			if (isScope(n)) scopes.set(n, new Map());
			if (isFn(n))
				for (const p of n.parameters) {
					if (ts.isIdentifier(p.name))
						scopes.get(n).set(p.name.text, { kind: "unknown" });
					else if (ts.isObjectBindingPattern(p.name))
						for (const item of p.name.elements)
							if (
								(item.propertyName ?? item.name).getText(source) === "t" &&
								ts.isIdentifier(item.name)
							)
								scopes.get(n).set(item.name.text, { kind: "root" });
				}
			ts.forEachChild(n, bind);
		}
		bind(source);
		function decl(n) {
			if (ts.isVariableDeclaration(n)) {
				const target = scopeOf(n);
				const r = resolve(n.initializer);
				if (ts.isIdentifier(n.name) && r) target.set(n.name.text, r);
				if (
					ts.isObjectBindingPattern(n.name) &&
					(r?.kind === "context" || r?.kind === "unknown")
				)
					for (const e of n.name.elements)
						if (
							(e.propertyName ?? e.name).getText(source) === "t" &&
							ts.isIdentifier(e.name)
						)
							target.set(e.name.text, { kind: "root" });
			}
			ts.forEachChild(n, decl);
		}
		for (let i = 0; i < 3; i++) decl(source);
		const localFunctions = new Map();
		function funcs(n) {
			if (ts.isFunctionDeclaration(n) && n.name) localFunctions.set(n.name.text, n);
			ts.forEachChild(n, funcs);
		}
		funcs(source);
		// Infer local helper translator parameters from every proven call-site argument.
		for (let round = 0; round < 3; round++) {
			function infer(n) {
				if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
					const fn = localFunctions.get(n.expression.text);
					if (fn)
						n.arguments.forEach((arg, i) => {
							const r = resolve(arg),
								p = fn.parameters[i];
							if (r && r.kind !== "unknown" && p && ts.isIdentifier(p.name))
								scopes.get(fn).set(p.name.text, r);
						});
				}
				ts.forEachChild(n, infer);
			}
			infer(source);
		}
		function visit(n) {
			if (
				ts.isCallExpression(n) &&
				(ts.isIdentifier(n.expression) ||
					(ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "t"))
			) {
				const r = ts.isIdentifier(n.expression) ? resolve(n.expression) : { kind: "root" };
				if (r?.kind === "root" || r?.kind === "scoped") {
					count++;
					const arg = n.arguments[0];
					if (
						arg &&
						(ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))
					) {
						const literal = arg.text;
						const key =
							r.kind === "scoped"
								? r.namespace + "." + literal
								: literal.split(".")[0] in catalogs
									? literal
									: "common." + literal;
						if (!has(key)) {
							const f = n.arguments[1];
							missing.push({
								file,
								line: source.getLineAndCharacterOfPosition(n.getStart()).line + 1,
								alias: n.expression.getText(source),
								namespace: r.kind === "scoped" ? r.namespace : "root",
								literal,
								key,
								fallback:
									f &&
									(ts.isStringLiteral(f) || ts.isNoSubstitutionTemplateLiteral(f))
										? f.text
										: null,
								fallbackExpression: f?.getText(source) ?? null,
							});
						}
					} else
						dynamic.push({
							file,
							line: source.getLineAndCharacterOfPosition(n.getStart()).line + 1,
							expression: arg?.getText(source),
							namespace: r.namespace ?? "root",
						});
				} else if (
					r?.kind === "unknown" &&
					/^(t|t[A-Z]|.*T$|translate$)/.test(n.expression.text)
				)
					unknown.push({
						file,
						line: source.getLineAndCharacterOfPosition(n.getStart()).line + 1,
						alias: n.expression.getText(source),
						key: n.arguments[0]?.getText(source),
					});
			}
			ts.forEachChild(n, visit);
		}
		visit(source);
	}
	return { files: files.length, translatorCalls: count, missing, dynamic, unknown };
}
