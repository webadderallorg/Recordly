import React, { useEffect, useState } from "react";
import { posts, readingMinutes, formatPostDate } from "./posts";
import { blogMetadata, applyBlogMetadata } from "./seo";
import { SiteFooter } from "../SiteHeader";
import "./blog.css";

const categories = ["All", ...new Set(posts.map((post) => post.category))];
const categoryHref = (category) => category === "All" ? "/blog" : `/blog?category=${encodeURIComponent(category)}`;

function PostCard({ post }) {
  return (
    <article className="blog-card">
      <a href={`/blog/${post.slug}`}>
        <div className="blog-card-image"><img src={post.image} alt={post.imageAlt} width="1200" height="630" loading="lazy" decoding="async" /></div>
        <p className="blog-meta">{post.category}<span aria-hidden="true"> / </span><time dateTime={post.datePublished}>{formatPostDate(post.datePublished)}</time></p>
        <h2>{post.title}</h2>
        <p className="blog-summary">{post.description}</p>
        <p className="blog-read-time">{readingMinutes(post)} min read <span aria-hidden="true">↗</span></p>
      </a>
    </article>
  );
}

function ArticleSection({ section }) {
  return (
    <section aria-labelledby={section.id}>
      <h2 id={section.id}>{section.title}</h2>
      {section.text && <p>{section.text}</p>}
      {section.paragraphs?.map((text, i) => <p key={i}>{text}</p>)}
      {section.table && <div className="blog-table" role="region" aria-label={`${section.title} comparison`} tabIndex={0}><table><thead><tr>{section.table.headers.map((heading) => <th scope="col" key={heading}>{heading}</th>)}</tr></thead><tbody>{section.table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>}
      {section.list && <ul>{section.list.map((text, i) => <li key={i}>{text}</li>)}</ul>}
      {section.steps && <ol>{section.steps.map((text, i) => <li key={i}>{text}</li>)}</ol>}
      {section.code && <pre className="blog-template"><code>{section.code}</code></pre>}
    </section>
  );
}

export default function Blog({ header, path = "/blog" }) {
  const meta = blogMetadata(path);
  const { isIndex, post } = meta;
  // The first client render matches the static HTML; query filtering applies after hydration.
  const [category, setCategory] = useState("All");
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("category");
    setCategory(categories.includes(requested) ? requested : "All");
    applyBlogMetadata(blogMetadata(path));
  }, [path]);
  const visiblePosts = category === "All" ? posts : posts.filter((entry) => entry.category === category);
  const related = post ? posts.filter((entry) => entry.slug !== post.slug).slice(0, 2) : [];
  return (
    <div className="blog-site">
      <a className="skip" href="#blog-content">Skip to content</a>
      {header}
      <main id="blog-content" className={isIndex ? "blog-index" : "blog-article"}>
        {isIndex ? (
          <>
            <h1>Blog</h1>
            {posts.length > 0 ? <>
            <nav className="blog-filters" aria-label="Blog categories">
              {categories.map((item) => <a key={item} href={categoryHref(item)} aria-current={category === item ? "page" : undefined}>{item}</a>)}
            </nav>
            <div className="blog-grid">{visiblePosts.map((entry) => <PostCard key={entry.slug} post={entry} />)}</div>
            </> : <div className="blog-empty"><p>No posts yet.</p></div>}
          </>
        ) : post ? (
          <article>
            <nav className="blog-breadcrumb" aria-label="Breadcrumb"><a href="/blog">Blog</a><span aria-hidden="true">/</span><a href={categoryHref(post.category)}>{post.category}</a></nav>
            <h1>{post.title}</h1>
            <img className="blog-cover" src={post.image} alt={post.imageAlt} width="1200" height="630" fetchpriority="high" />
            <p className="blog-meta blog-byline">By Recordly <span aria-hidden="true">/</span> <time dateTime={post.datePublished}>{formatPostDate(post.datePublished)}</time> <span aria-hidden="true">/</span> {readingMinutes(post)} min read</p>
            <div className="blog-prose">
              <p className="blog-lede">{post.description}</p>
              <nav className="blog-toc" aria-label="In this article"><p>In this article</p><ol>{post.sections.map((section) => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ol></nav>
              {post.sections.map((section) => <ArticleSection key={section.id} section={section} />)}
              {post.sources?.length > 0 && <section className="blog-sources" aria-labelledby="article-sources"><h2 id="article-sources">Sources and further reading</h2><ul>{post.sources.map((source) => <li key={source.url}><a href={source.url}>{source.title} <span aria-hidden="true">↗</span></a></li>)}</ul></section>}
            </div>
            <aside className="blog-related" aria-labelledby="related-heading"><h2 id="related-heading">Keep reading</h2>{related.map((entry) => <a key={entry.slug} href={`/blog/${entry.slug}`}>{entry.title}<span aria-hidden="true"> →</span></a>)}</aside>
            <div className="blog-article-end"><a href="/blog">← All posts</a><a href="/">Explore Recordly →</a></div>
          </article>
        ) : (
          <div className="blog-not-found"><h1>Post not found.</h1><p>This post may have moved. Return to the blog to see available posts.</p><a href="/blog">← All posts</a></div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
