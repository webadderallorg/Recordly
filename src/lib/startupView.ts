export function getStartupView(): "home" | "editor" {
	return document.documentElement.dataset.startupView === "home" ? "home" : "editor";
}
