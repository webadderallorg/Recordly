import {
	type HudInteractiveBounds,
	isPointerOverHudSurface,
} from "../src/components/launch/hudMousePassthrough";

/** Recover Windows hover hit testing without relying on forwarded renderer mouse events. */
export function startHudPointerRecovery(deps: {
	canRecover: () => boolean;
	getCursor: () => { x: number; y: number };
	getBounds: () => HudInteractiveBounds[] | null;
	recover: () => void;
}) {
	const timer = setInterval(() => {
		if (!deps.canRecover()) return;
		const { x, y } = deps.getCursor();
		if (isPointerOverHudSurface(deps.getBounds() ?? [], x, y)) deps.recover();
	}, 50);
	timer.unref?.();
	return () => clearInterval(timer);
}
