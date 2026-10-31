const KEY = "recordly.project-share-links.v1";
function readLinks(): Record<string, string> {
	try {
		const stored = JSON.parse(localStorage.getItem(KEY) || "{}");
		if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
		return Object.fromEntries(
			Object.entries(stored).filter(
				(entry): entry is [string, string] =>
					typeof entry[1] === "string" && /^https?:\/\//.test(entry[1]),
			),
		);
	} catch {
		return {};
	}
}
export function getProjectShareLink(path: string): string | undefined {
	return readLinks()[path];
}
export function saveProjectShareLink(path: string, url: string) {
	localStorage.setItem(KEY, JSON.stringify({ ...readLinks(), [path]: url }));
}
export function moveProjectShareLink(previous: string, next: string) {
	if (previous === next) return;
	const links = readLinks();
	if (!links[previous]) return;
	links[next] = links[previous];
	delete links[previous];
	localStorage.setItem(KEY, JSON.stringify(links));
}
export function removeProjectShareLinks(paths: string[]) {
	const links = readLinks();
	for (const path of paths) delete links[path];
	localStorage.setItem(KEY, JSON.stringify(links));
}
