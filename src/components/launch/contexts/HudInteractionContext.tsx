import { createContext, type MouseEvent, useContext } from "react";

interface HudInteractionContextType {
	onMouseEnter: () => void;
	onMouseLeave: (event: MouseEvent<HTMLDivElement>) => void;
}

export const HudInteractionContext = createContext<HudInteractionContextType | null>(null);

export function useHudInteraction() {
	const context = useContext(HudInteractionContext);
	if (!context) {
		throw new Error("useHudInteraction must be used within a HudInteractionProvider");
	}
	return context;
}
