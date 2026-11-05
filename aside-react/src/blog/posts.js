// Add hand-written articles here when ready. No placeholder or generated posts.
export const posts = [];

export function readingMinutes(post) {
  const words = [post.title, post.description, ...post.sections.map((section) => [section.title, section.text, ...(section.paragraphs || []), ...(section.list || []), ...(section.steps || []), section.code, ...(section.table?.headers || []), ...(section.table?.rows.flat() || [])].filter(Boolean).join(" "))].join(" ").trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

export function formatPostDate(date) {
  return new Intl.DateTimeFormat("en-AU", {day: "numeric", month: "short", year: "numeric", timeZone: "UTC"}).format(new Date(`${date}T00:00:00Z`));
}
