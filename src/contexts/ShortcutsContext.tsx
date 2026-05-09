import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	DEFAULT_LAUNCH_SHORTCUTS,
	DEFAULT_SHORTCUTS,
	resolvePersistedShortcuts,
	type LaunchShortcutsConfig,
	type PersistedShortcutsPayload,
	type ShortcutsConfig,
} from "@/lib/shortcuts";
import { isMac as getIsMac } from "@/utils/platformUtils";

interface ShortcutsContextValue {
	shortcuts: ShortcutsConfig;
	launchShortcuts: LaunchShortcutsConfig;
	isMac: boolean;
	setShortcuts: (config: ShortcutsConfig) => void;
	setLaunchShortcuts: (config: LaunchShortcutsConfig) => void;
	persistShortcuts: (
		config?: ShortcutsConfig,
		launchConfig?: LaunchShortcutsConfig,
	) => Promise<void>;
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
	const [shortcuts, setShortcuts] = useState<ShortcutsConfig>(DEFAULT_SHORTCUTS);
	const [launchShortcuts, setLaunchShortcuts] =
		useState<LaunchShortcutsConfig>(DEFAULT_LAUNCH_SHORTCUTS);
	const [isMac, setIsMac] = useState(false);
	const [isConfigOpen, setIsConfigOpen] = useState(false);

	useEffect(() => {
		getIsMac()
			.then(setIsMac)
			.catch(() => undefined);

		void (async () => {
			try {
				const saved =
					(await window.electronAPI?.getShortcuts?.()) as PersistedShortcutsPayload | null;
				const resolved = resolvePersistedShortcuts(saved);
				setShortcuts(resolved.editor);
				setLaunchShortcuts(resolved.launch);
			} catch {
				return undefined;
			}
		})();
	}, []);

	const persistShortcuts = useCallback(
		async (config?: ShortcutsConfig, launchConfig?: LaunchShortcutsConfig) => {
			await window.electronAPI?.saveShortcuts?.({
				editor: config ?? shortcuts,
				launch: launchConfig ?? launchShortcuts,
			});
		},
		[shortcuts, launchShortcuts],
	);

	const openConfig = useCallback(() => setIsConfigOpen(true), []);
	const closeConfig = useCallback(() => setIsConfigOpen(false), []);

	const value = useMemo<ShortcutsContextValue>(
		() => ({
			shortcuts,
			launchShortcuts,
			isMac,
			setShortcuts,
			setLaunchShortcuts,
			persistShortcuts,
			isConfigOpen,
			openConfig,
			closeConfig,
		}),
		[
			shortcuts,
			launchShortcuts,
			isMac,
			persistShortcuts,
			isConfigOpen,
			openConfig,
			closeConfig,
		],
	);

	return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>;
}
