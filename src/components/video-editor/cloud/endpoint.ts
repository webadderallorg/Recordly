export const CLOUD_SHARE_ENDPOINT =
	import.meta.env.VITE_CLOUD_SHARE_ENDPOINT?.trim() ||
	(import.meta.env.DEV ? "http://localhost:8787/api/upload" : "");
