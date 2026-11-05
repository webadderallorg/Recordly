import { test as base } from "@playwright/test";

const port = Number(
	process.env.RECORDLY_UI_AUTH_PORT ?? String(Number(process.env.RECORDLY_UI_PORT ?? "5179") + 1),
);

// Use the same components with Vite's development flag disabled. This keeps
// production sign-in coverage independent of freely navigable dev onboarding.
export const productionTest = base.extend({ baseURL: `http://127.0.0.1:${port}` });
