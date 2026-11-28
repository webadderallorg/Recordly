import type { Plugin } from "vite";

const EMBIND_DYNAMIC_INVOKER =
	'function He(e,r,t,n,a,i){var s=r.length;s<2&&k("argTypes array size mismatch! Must at least get return value and \'this\' types!");for(var l=r[1]!==null&&t!==null,u=Wr(r),c=r[0].name!=="void",d=[e,k,n,a,rr,r[0],r[1]],m=0;m<s-2;++m)d.push(r[m+2]);if(!u)for(var m=l?1:2;m<r.length;++m)r[m].destructorFunction!==null&&d.push(r[m].destructorFunction);let[h,p]=Cn(r,l,c,i);h.push(p);var w=$n(Function,h)(...d);return Ue(e,w)}';

// Equivalent to Emscripten's -sDYNAMIC_EXECUTION=0 craftInvokerFunction so Embind runs under strict CSP.
const EMBIND_CSP_SAFE_INVOKER =
	'function He(e,r,t,n,a){var s=r.length;s<2&&k("argTypes array size mismatch! Must at least get return value and \'this\' types!");var l=r[1]!==null&&t!==null,u=Wr(r),c=r[0].name!=="void",g=s-2;return Ue(e,function(){if(arguments.length!==g)k("function "+e+" called with "+arguments.length+" arguments, expected "+g);var d=u?[]:null,p=[a],h;l&&(h=r[1].toWireType(d,this),p.push(h));var v=new Array(g);for(var m=0;m<g;++m)v[m]=r[m+2].toWireType(d,arguments[m]),p.push(v[m]);var y=n.apply(null,p);if(u)rr(d);else for(var m=l?1:2;m<s;++m){var b=r[m].destructorFunction;b!==null&&b(m===1?h:v[m-2])}if(c)return r[0].fromWireType(y)})}';

const DYNAMIC_EVAL_PATTERN = /(?:\bnew\s+Function\b|\$n\(\s*Function\b|[^.\w$]eval\s*\()/;
const WORKER_BASE64_PATTERN = /(\bt\s*=\s*")([A-Za-z0-9+/=]{1000,})(")/;

export function patchWebDemuxerWorkerScript(workerSource: string): string {
	const patched = workerSource.includes(EMBIND_DYNAMIC_INVOKER)
		? workerSource.replace(EMBIND_DYNAMIC_INVOKER, EMBIND_CSP_SAFE_INVOKER)
		: workerSource;

	if (DYNAMIC_EVAL_PATTERN.test(patched)) {
		throw new Error(
			"web-demuxer worker still contains dynamic code evaluation that violates the strict renderer CSP; update scripts/webDemuxerCspPlugin.ts for this web-demuxer version.",
		);
	}

	return patched;
}

export function patchWebDemuxerBundle(bundleSource: string): string {
	const match = WORKER_BASE64_PATTERN.exec(bundleSource);
	if (!match) {
		throw new Error(
			"Could not locate inline worker payload in web-demuxer bundle; update scripts/webDemuxerCspPlugin.ts.",
		);
	}

	const decodedWorker = Buffer.from(match[2], "base64").toString("utf8");
	const patchedWorker = patchWebDemuxerWorkerScript(decodedWorker);
	if (patchedWorker === decodedWorker) {
		return bundleSource;
	}

	const encodedWorker = Buffer.from(patchedWorker, "utf8").toString("base64");
	return (
		bundleSource.slice(0, match.index) +
		match[1] +
		encodedWorker +
		match[3] +
		bundleSource.slice(match.index + match[0].length)
	);
}

export function webDemuxerCspPlugin(): Plugin {
	return {
		name: "recordly-web-demuxer-csp-safe",
		enforce: "pre",
		transform(code, id) {
			const cleanId = id.split("?")[0]?.replace(/\\/g, "/") ?? "";
			if (!cleanId.endsWith("/node_modules/web-demuxer/dist/web-demuxer.js")) {
				return null;
			}
			return {
				code: patchWebDemuxerBundle(code),
				map: null,
			};
		},
	};
}
