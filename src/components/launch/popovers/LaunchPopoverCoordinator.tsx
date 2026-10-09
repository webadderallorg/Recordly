import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import { isHudGrowMode } from "../hudWindowMode";

interface LaunchPopoverCoordinatorValue {
	openId: string | null;
	requestOpen: (id: string) => void;
	requestClose: (id: string) => void;
	isOpen: (id: string) => boolean;
}

const LaunchPopoverCoordinatorContext = createContext<LaunchPopoverCoordinatorValue | null>(null);

export function LaunchPopoverCoordinatorProvider({ children }: { children: ReactNode }) {
	const [openId, setOpenId] = useState<string | null>(null);

	const requestOpen = useCallback((id: string) => {
		// Grow mode (native Wayland): pre-grow the window to the expanded
		// preset BEFORE the menu mounts, so Radix measures a viewport with
		// room below the bar and positions the menu correctly on the first
		// try. Content-size reports shrink it to exact size right after.
		if (isHudGrowMode()) {
			window.electronAPI?.hudOverlaySetPopoverOpen?.(true);
		}
		setOpenId(id);
	}, []);

	const requestClose = useCallback((id: string) => {
		setOpenId((currentId) => (currentId === id ? null : currentId));
	}, []);

	const isOpen = useCallback((id: string) => openId === id, [openId]);

	useEffect(() => {
		const handleBlur = () => setOpenId(null);
		window.addEventListener("blur", handleBlur);
		return () => window.removeEventListener("blur", handleBlur);
	}, []);

	const value = useMemo(
		() => ({
			openId,
			requestOpen,
			requestClose,
			isOpen,
		}),
		[isOpen, openId, requestClose, requestOpen],
	);

	return (
		<LaunchPopoverCoordinatorContext.Provider value={value}>
			{children}
		</LaunchPopoverCoordinatorContext.Provider>
	);
}

export function useLaunchPopoverCoordinator() {
	const context = useContext(LaunchPopoverCoordinatorContext);
	if (!context) {
		throw new Error(
			"useLaunchPopoverCoordinator must be used within LaunchPopoverCoordinatorProvider",
		);
	}
	return context;
}
