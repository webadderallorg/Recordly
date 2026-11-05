import { posts } from "./posts";

// Match the existing review host. Set VITE_SITE_URL when deploying to a different domain.
export const siteOrigin = (import.meta.env?.VITE_SITE_URL || "https://recordly-beta-landing.youngchen3442.workers.dev").replace(/\/+$/, "");
export function blogMetadata(path, origin = siteOrigin) {
  const cleanPath = path.replace(/\/+$/, "");
  const post = posts.find((entry) => cleanPath === `/blog/${entry.slug}`);
  const isIndex = cleanPath === "/blog";
  const canonical = `${origin}${isIndex ? "/blog" : cleanPath}`;
  const title = isIndex ? "Blog | Recordly" : `${post?.title || "Post not found"} | Recordly`;
  const description = post?.description || "Updates and writing from Recordly.";
  const image = post?.image ? `${origin}${post.image}` : null;
  const structuredData = post ? {
    "@context": "https://schema.org", "@type": "BlogPosting",
    headline: post.title, description, ...(image ? {image: [image]} : {}),
    datePublished: post.datePublished, dateModified: post.dateModified,
    author: {"@type": "Organization", name: "Recordly", url: origin},
    publisher: {"@type": "Organization", name: "Recordly", url: origin},
    mainEntityOfPage: {"@type": "WebPage", "@id": canonical},
    articleSection: post.category, inLanguage: "en-AU"
  } : isIndex ? {
    "@context": "https://schema.org", "@type": "CollectionPage", name: "Recordly Blog", description, url: canonical,
    mainEntity: {"@type": "ItemList", itemListElement: posts.map((entry, index) => ({"@type": "ListItem", position: index + 1, url: `${origin}/blog/${entry.slug}`, name: entry.title}))}
  } : null;
  return {title, description, canonical, image, post, isIndex, structuredData, robots: post || isIndex ? "index, follow, max-image-preview:large" : "noindex, follow"};
}

export function applyBlogMetadata(meta) {
  document.title = meta.title;
  const setMeta = (attribute, key, content) => {
    let tag = document.head.querySelector(`meta[${attribute}="${key}"]`);
    if (!tag) { tag = document.createElement("meta"); tag.setAttribute(attribute, key); document.head.append(tag); }
    tag.content = content;
  };
  setMeta("name", "description", meta.description);
  setMeta("name", "robots", meta.robots);
  for (const [key, value] of Object.entries({"og:title":meta.title, "og:description":meta.description, "og:url":meta.canonical, "og:image":meta.image, "og:type":meta.post ? "article" : "website", "og:site_name":"Recordly", "og:image:width":meta.image ? "1200" : null, "og:image:height":meta.image ? "630" : null})) {
    if (value) setMeta("property",key,value);
    else document.head.querySelector(`meta[property="${key}"]`)?.remove();
  }
  for (const [key,value] of Object.entries({"twitter:card":meta.image ? "summary_large_image" : "summary", "twitter:title":meta.title, "twitter:description":meta.description, "twitter:image":meta.image})) {
    if (value) setMeta("name",key,value);
    else document.head.querySelector(`meta[name="${key}"]`)?.remove();
  }
  if (meta.post) {
    setMeta("property", "article:published_time", meta.post.datePublished);
    setMeta("property", "article:modified_time", meta.post.dateModified);
  } else {
    document.head.querySelector('meta[property="article:published_time"]')?.remove();
    document.head.querySelector('meta[property="article:modified_time"]')?.remove();
  }
  let canonical = document.head.querySelector('link[rel="canonical"]');
  if (!canonical) { canonical = document.createElement("link"); canonical.rel = "canonical"; document.head.append(canonical); }
  canonical.href = meta.canonical;
  let schema = document.head.querySelector('script[data-blog-schema]');
  if (meta.structuredData) {
    if (!schema) { schema = document.createElement("script"); schema.type = "application/ld+json"; schema.setAttribute("data-blog-schema", ""); document.head.append(schema); }
    schema.textContent = JSON.stringify(meta.structuredData);
  } else schema?.remove();
}
