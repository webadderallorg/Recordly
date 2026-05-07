import { createContext, useContext } from "react";

interface HudInteractionContextType {
	onMouseEnter: () => void;
	onMouseLeave: (event: any) => void;
}

export const HudInteractionContext = createContext<HudInteractionContextType | null>(null);

export function useHudInteraction() {
	const context = useContext(HudInteractionContext);
	if (!context) {
		throw new Error("useHudInteraction must be used within a HudInteractionProvider");
	}
	return context;
}
