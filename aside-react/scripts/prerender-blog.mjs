import { createServer, loadEnv } from "vite";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = loadEnv("production", root, "VITE_");
const origin = (process.env.VITE_SITE_URL || env.VITE_SITE_URL || "https://recordly-beta-landing.youngchen3442.workers.dev").replace(/\/+$/, "");
const parsedOrigin = new URL(origin);
if (!["https:", "http:"].includes(parsedOrigin.protocol) || parsedOrigin.origin !== origin) throw new Error("VITE_SITE_URL must be an absolute http(s) origin without a path.");
const cacheDir = await mkdtemp(resolve(tmpdir(), "recordly-blog-prerender-"));
const server = await createServer({root, cacheDir, mode:"production", server:{middlewareMode:true}, appType:"custom", optimizeDeps:{noDiscovery:true}});
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[char]));
const metaTag = (kind, name, content) => `<meta ${kind}="${name}" content="${escapeHtml(content)}">`;
try {
  const {blogPaths, renderBlog} = await server.ssrLoadModule("/src/blog/render.jsx");
  const template = await readFile(resolve(root, "dist/index.html"), "utf8");
  if (!template.includes('<div id="root"></div>')) throw new Error("Built HTML is missing the expected React root.");
  for (const path of blogPaths) {
    const {body, meta} = renderBlog(path, origin);
    const tags = [
      metaTag("name", "description", meta.description), metaTag("name", "robots", meta.robots),
      `<link rel="canonical" href="${escapeHtml(meta.canonical)}">`,
      ...Object.entries({"og:title":meta.title, "og:description":meta.description, "og:type":meta.post ? "article" : "website", "og:url":meta.canonical, "og:image":meta.image, "og:image:width":meta.image ? "1200" : null, "og:image:height":meta.image ? "630" : null, "og:site_name":"Recordly"}).filter(([,value]) => value).map(([key,value]) => metaTag("property", key, value)),
      ...Object.entries({"twitter:card":meta.image ? "summary_large_image" : "summary", "twitter:title":meta.title, "twitter:description":meta.description, "twitter:image":meta.image}).filter(([,value]) => value).map(([key,value]) => metaTag("name", key, value)),
      ...(meta.post ? [metaTag("property", "article:published_time", meta.post.datePublished), metaTag("property", "article:modified_time", meta.post.dateModified)] : []),
      `<script type="application/ld+json" data-blog-schema>${JSON.stringify(meta.structuredData).replace(/</g, "\\u003c")}</script>`
    ].join("\n");
    const html = template.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(meta.title)}</title>`)
      .replace(/<meta\s+name="description"[^>]*>/, "")
      .replace("</head>", `${tags}\n</head>`)
      .replace('<div id="root"></div>', `<div id="root" data-prerendered>${body}</div>`);
    const folder = resolve(root, "dist", path.slice(1));
    await mkdir(folder, {recursive:true});
    await writeFile(resolve(folder, "index.html"), html);
  }
  const entries = ["/", ...blogPaths].map((path) => `<url><loc>${escapeHtml(`${origin}${path}`)}</loc></url>`).join("\n");
  await writeFile(resolve(root, "dist/sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>\n`);
  console.log(`Prerendered ${blogPaths.length} blog pages with metadata, article content, and sitemap.`);
} finally {
  await server.close();
  await rm(cacheDir, {recursive:true, force:true});
}
