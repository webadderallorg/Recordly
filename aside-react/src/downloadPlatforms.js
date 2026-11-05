const releases = "https://github.com/webadderallorg/Recordly/releases/latest";

export const downloadPlatforms = [
	{ id: "macos", label: "macOS", href: releases },
	{ id: "windows", label: "Windows", href: `${releases}/download/Recordly-windows-x64.exe` },
	{ id: "linux", label: "Linux (experimental)", href: `${releases}/download/Recordly-linux-x64.AppImage` },
];

export function getDownloadPlatform(client = {}) {
	const agent = client.userAgent || "";
	const platform = client.userAgentData?.platform || client.platform || agent;
	// Mobile browsers may identify as Linux or macOS; keep the desktop fallback.
	if (/Android|iPhone|iPad|iPod/i.test(agent) || (/Mac/i.test(platform) && client.maxTouchPoints > 1)) return "macos";
	if (/Win/i.test(platform)) return "windows";
	if (/Linux/i.test(platform)) return "linux";
	return "macos";
}
