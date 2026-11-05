import React from "react";
import { renderToString } from "react-dom/server";
import { Nav } from "../SiteHeader";
import Blog from "./Blog";
import { blogMetadata } from "./seo";
import { posts } from "./posts";
import Pricing from "../pricing/Pricing";
import { pricingMetadata } from "../pricing/catalog.js";

export const blogPaths = ["/blog", "/pricing", ...posts.map((post) => `/blog/${post.slug}`)];
export function renderBlog(path, origin) {
  if (path === "/pricing") return {body:renderToString(<Pricing />), meta:pricingMetadata(origin)};
  return {body: renderToString(<Blog header={<Nav light />} path={path} />), meta: blogMetadata(path, origin)};
}
