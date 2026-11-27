import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

export function viewerContentSecurityPolicy() {
	return {
		name: "recordly-viewer-content-security-policy",
		hooks: {
			"astro:build:done": async ({ dir }) => {
				await Promise.all(
					["share.html", "embed.html"].map(async (page) => {
						const file = new URL(page, dir);
						const html = await readFile(file, "utf8");
						// Hash only the trusted build output, before the Worker adds recording metadata.
						const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
							.filter(([, attributes]) => !/(^|\s)src\s*=/i.test(attributes))
							.map(
								([, , script]) =>
									`'sha256-${createHash("sha256").update(script.replace(/\r\n?/g, "\n")).digest("base64")}'`,
							);
						const policy = [
							"default-src 'self'",
							["script-src 'self'", ...new Set(hashes)].join(" "),
							"style-src 'self' 'unsafe-inline'",
							"img-src 'self' data: blob: https:",
							"font-src 'self' data:",
							"media-src 'self' blob:",
							// The hosted viewer discovers the deployment's authentication origin at runtime.
							"connect-src 'self' https:",
							"frame-src 'self'",
							"object-src 'none'",
							"base-uri 'none'",
							"form-action 'self'",
						].join("; ");
						const charset = /<meta charset="utf-8"\s*\/?>/i;
						if (!charset.test(html)) throw new Error(`Missing charset in ${page}`);
						await writeFile(
							file,
							html.replace(
								charset,
								`$&<meta http-equiv="Content-Security-Policy" content="${policy}">`,
							),
						);
					}),
				);
			},
		},
	};
}
