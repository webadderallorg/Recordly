import type { APIRoute } from "astro";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
declare const __RECORDLY_PUBLIC_DIR__: string;

// Serve the desktop's original assets, so the web sign-in cannot drift.
const assets = {
	"recordly-banner-light.png": ["auth/recordly-banner-light.png", "image/png"],
	"recordly-banner-dark.png": ["auth/recordly-banner-dark.png", "image/png"],
	"google-logo.png": ["auth/google-logo.png", "image/png"],
	"microsoft-logo.svg": ["auth/microsoft-logo.svg", "image/svg+xml"],
	"recordly-demo.mp4": ["auth/recordly-demo.mp4", "video/mp4"],
	"recordly-demo.jpg": ["auth/recordly-demo.jpg", "image/jpeg"],
	"recordly-128.png": ["app-icons/recordly-128.png", "image/png"],
} as const;
export function getStaticPaths() {
	return Object.keys(assets).map((asset) => ({ params: { asset } }));
}
export const GET: APIRoute = async ({ params }) => {
	const asset = assets[params.asset as keyof typeof assets];
	if (!asset) return new Response(null, { status: 404 });
	const bytes = await readFile(join(__RECORDLY_PUBLIC_DIR__, asset[0]));
	return new Response(new Uint8Array(bytes), { headers: { "Content-Type": asset[1] } });
};
