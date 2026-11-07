import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	DEFAULT_SHORTCUTS,
	mergeWithDefaults,
	serializeShortcuts,
	SHORTCUTS_VERSION,
	type ShortcutsConfig,
	type StoredShortcutsConfig,
} from "@/lib/shortcuts";
import { isMac as getIsMac } from "@/utils/platformUtils";

interface ShortcutsContextValue {
	shortcuts: ShortcutsConfig;
	isMac: boolean;
	setShortcuts: (config: ShortcutsConfig) => void;
	persistShortcuts: (config?: ShortcutsConfig) => Promise<void>;
	isConfigOpen: boolean;
	openConfig: () => void;
	closeConfig: () => void;
}

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);

export function useShortcuts(): ShortcutsContextValue {
	const ctx = useContext(ShortcutsContext);
	if (!ctx) throw new Error("useShortcuts must be used within <ShortcutsProvider>");
	return ctx;
}

export function ShortcutsProvider({ children }: { children: ReactNode }) {
	const [shortcuts, setShortcutsState] = useState<ShortcutsConfig>(DEFAULT_SHORTCUTS);
	const [isMac, setIsMac] = useState(false);
	const [isConfigOpen, setIsConfigOpen] = useState(false);
	const edited = useRef(false);
	const migrationSave = useRef<Promise<unknown>>(Promise.resolve());
	const setShortcuts = useCallback((config: ShortcutsConfig) => {
		edited.current = true;
		setShortcutsState(config);
	}, []);

	useEffect(() => {
		getIsMac()
			.then(setIsMac)
			.catch(() => undefined);

		void (async () => {
			try {
				const saved = await window.electronAPI?.getShortcuts?.();
				if (saved && !edited.current) {
					const stored = saved as StoredShortcutsConfig;
					const merged = mergeWithDefaults(stored);
					setShortcutsState(merged);
					if ((stored.version ?? 0) < SHORTCUTS_VERSION) {
						migrationSave.current = Promise.resolve(
							window.electronAPI?.saveShortcuts?.(serializeShortcuts(merged)),
						);
						await migrationSave.current;
					}
				}
			} catch {
				return undefined;
			}
		})();
	}, []);

	const persistShortcuts = useCallback(
		async (config?: ShortcutsConfig) => {
			edited.current = true;
			await migrationSave.current.catch(() => undefined);
			await window.electronAPI?.saveShortcuts?.(serializeShortcuts(config ?? shortcuts));
		},
		[shortcuts],
	);

	const openConfig = useCallback(() => setIsConfigOpen(true), []);
	const closeConfig = useCallback(() => setIsConfigOpen(false), []);

	const value = useMemo<ShortcutsContextValue>(
		() => ({
			shortcuts,
			isMac,
			setShortcuts,
			persistShortcuts,
			isConfigOpen,
			openConfig,
			closeConfig,
		}),
		[shortcuts, isMac, setShortcuts, persistShortcuts, isConfigOpen, openConfig, closeConfig],
	);

	return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>;
}
