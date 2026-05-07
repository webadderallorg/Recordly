import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

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
		setOpenId(id);
	}, []);

	const requestClose = useCallback((id: string) => {
		setOpenId((currentId) => (currentId === id ? null : currentId));
	}, []);

	const isOpen = useCallback((id: string) => openId === id, [openId]);

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
		throw new Error("useLaunchPopoverCoordinator must be used within LaunchPopoverCoordinatorProvider");
	}
	return context;
}
