import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { patchWebDemuxerBundle, patchWebDemuxerWorkerScript } from "../scripts/webDemuxerCspPlugin";

function extractDecodedWorker(bundleSource: string): string {
	const match = /\bt\s*=\s*"([A-Za-z0-9+/=]{1000,})"/.exec(bundleSource);
	if (!match) {
		throw new Error("Missing inline worker payload");
	}
	return Buffer.from(match[1], "base64").toString("utf8");
}

function createMockHeFactory(patchedWorkerSnippet: string) {
	const k = vi.fn((message: string) => {
		throw new Error(message);
	});
	const Wr = vi.fn((argTypes: Array<{ destructorFunction: unknown } | null>) =>
		argTypes.slice(1).some((arg) => arg !== null && arg.destructorFunction === undefined),
	);
	const rr = vi.fn();
	const Ue = (name: string, fn: (...args: unknown[]) => unknown) =>
		Object.defineProperty(fn, "name", { value: name });

	const buildHe = new Function("k", "Wr", "rr", "Ue", `${patchedWorkerSnippet}; return He;`) as (
		k: (message: string) => never,
		Wr: (argTypes: Array<{ destructorFunction: unknown } | null>) => boolean,
		rr: (destructors: unknown[]) => void,
		Ue: <T extends (...args: unknown[]) => unknown>(name: string, fn: T) => T,
	) => (
		name: string,
		argTypes: Array<{
			name?: string;
			toWireType?: (destructors: unknown[] | null, value: unknown) => unknown;
			fromWireType?: (value: unknown) => unknown;
			destructorFunction?: ((wired: unknown) => void) | null;
		} | null>,
		classType: object | null,
		invoker: (...args: unknown[]) => unknown,
		fn: number,
	) => (...args: unknown[]) => unknown;

	return {
		He: buildHe(k, Wr, rr, Ue),
		k,
		Wr,
		rr,
	};
}

describe("webDemuxerCspPlugin", () => {
	it("removes dynamic Function evaluation from the installed web-demuxer worker idempotently", () => {
		const bundlePath = path.resolve(
			process.cwd(),
			"node_modules/web-demuxer/dist/web-demuxer.js",
		);
		const originalBundle = fs.readFileSync(bundlePath, "utf8");
		const originalWorker = extractDecodedWorker(originalBundle);
		expect(originalWorker).toMatch(/\$n\(\s*Function\b/);

		const patchedBundle = patchWebDemuxerBundle(originalBundle);
		const patchedWorker = extractDecodedWorker(patchedBundle);
		expect(patchedWorker).not.toMatch(/\bnew\s+Function\b|\$n\(\s*Function\b|[^.\w$]eval\s*\(/);

		expect(patchWebDemuxerBundle(patchedBundle)).toBe(patchedBundle);
	});

	it("fails loudly on unknown dynamic eval and passes clean workers through unchanged", () => {
		expect(() => patchWebDemuxerWorkerScript("var f = $n(Function, h);")).toThrow(
			/strict renderer CSP/,
		);
		expect(() => patchWebDemuxerWorkerScript("var f = new Function('return 1');")).toThrow(
			/strict renderer CSP/,
		);
		const clean = "function ok() { return 42; }";
		expect(patchWebDemuxerWorkerScript(clean)).toBe(clean);
	});

	it("preserves free-function, method, destructor, void, and arity semantics in the patched Embind invoker", () => {
		const originalInvoker =
			'function He(e,r,t,n,a,i){var s=r.length;s<2&&k("argTypes array size mismatch! Must at least get return value and \'this\' types!");for(var l=r[1]!==null&&t!==null,u=Wr(r),c=r[0].name!=="void",d=[e,k,n,a,rr,r[0],r[1]],m=0;m<s-2;++m)d.push(r[m+2]);if(!u)for(var m=l?1:2;m<r.length;++m)r[m].destructorFunction!==null&&d.push(r[m].destructorFunction);let[h,p]=Cn(r,l,c,i);h.push(p);var w=$n(Function,h)(...d);return Ue(e,w)}';
		const patchedInvoker = patchWebDemuxerWorkerScript(originalInvoker);
		const { He, rr } = createMockHeFactory(patchedInvoker);

		// 1. Free function with return value and explicit arg destructor
		const argDestructor = vi.fn();
		const freeFn = He(
			"addScaled",
			[
				{ name: "int", fromWireType: (value) => Number(value) * 10 },
				null,
				{
					toWireType: (_destructors, value) => Number(value) + 1,
					destructorFunction: argDestructor,
				},
			],
			null,
			(fnPtr, wiredArg) => Number(fnPtr) + Number(wiredArg),
			100,
		);
		expect(freeFn.name).toBe("addScaled");
		expect(freeFn(4)).toBe(1050);
		expect(argDestructor).toHaveBeenCalledWith(5);
		expect(rr).not.toHaveBeenCalled();

		// 2. Class method using destructor stack when an arg has undefined destructorFunction
		const thisToWire = vi.fn((destructors: unknown[] | null, self: unknown) => {
			destructors?.push("dtor-token");
			return (self as { ptr: number }).ptr;
		});
		const method = He(
			"Widget.setVal",
			[
				{ name: "void", fromWireType: () => "should-not-run" },
				{ toWireType: thisToWire, destructorFunction: null },
				{ toWireType: (_d, v) => v, destructorFunction: undefined },
			],
			{ name: "Widget" },
			(fnPtr, selfPtr, value) => `${fnPtr}:${selfPtr}:${value}`,
			7,
		);
		expect(method.name).toBe("Widget.setVal");
		expect(method.call({ ptr: 99 }, "abc")).toBeUndefined();
		expect(rr).toHaveBeenCalledWith(["dtor-token"]);

		// 3. Arity mismatch triggers throwBindingError (k)
		expect(() => freeFn()).toThrow("function addScaled called with 0 arguments, expected 1");
	});
});
