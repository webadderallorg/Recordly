import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
	/** The user's preference: light, dark, or system */
	preference: ThemePreference;
	/** The resolved theme applied to the DOM */
	theme: ResolvedTheme;
	setPreference: (pref: ThemePreference) => void;
	toggleTheme: () => void;
}

const THEME_STORAGE_KEY = "recordly.theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getStoredPreference(): ThemePreference {
	try {
		const stored = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
		if (stored === "light" || stored === "dark" || stored === "system") {
			return stored;
		}
	} catch {
		// Ignore storage errors
	}
	return "system";
}

function resolveTheme(pref: ThemePreference): ResolvedTheme {
	if (pref === "system") {
		return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
	}
	return pref;
}

function applyThemeToDOM(theme: ResolvedTheme) {
	const root = document.documentElement;
	root.dataset.theme = theme;
	if (theme === "dark") {
		root.classList.add("dark");
	} else {
		root.classList.remove("dark");
	}
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const [preference, setPreferenceState] = useState<ThemePreference>(() => {
		const stored = getStoredPreference();
		applyThemeToDOM(resolveTheme(stored));
		return stored;
	});

	const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(preference));

	const setPreference = useCallback((pref: ThemePreference) => {
		setPreferenceState(pref);
		const r = resolveTheme(pref);
		setResolved(r);
		applyThemeToDOM(r);
		try {
			globalThis.localStorage?.setItem(THEME_STORAGE_KEY, pref);
		} catch {
			// Ignore storage errors
		}
	}, []);

	const toggleTheme = useCallback(() => {
		setPreference(resolved === "dark" ? "light" : "dark");
	}, [resolved, setPreference]);

	// Listen for system theme changes when preference is "system"
	useEffect(() => {
		if (preference !== "system") return;
		const mq = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
		if (!mq) return;
		const handler = () => {
			const r = resolveTheme("system");
			setResolved(r);
			applyThemeToDOM(r);
		};
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, [preference]);

	useEffect(() => {
		applyThemeToDOM(resolved);
	}, [resolved]);

	return (
		<ThemeContext.Provider value={{ preference, theme: resolved, setPreference, toggleTheme }}>
			{children}
		</ThemeContext.Provider>
	);
}

export function useTheme(): ThemeContextValue {
	const context = useContext(ThemeContext);
	if (!context) {
		throw new Error("useTheme must be used within a ThemeProvider");
	}
	return context;
}
