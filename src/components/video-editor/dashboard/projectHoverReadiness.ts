export type HoverCompositionStatus = {
	prerequisitesReady: boolean;
	/** The last composition still represents this source and viewport. */
	canRetain: boolean;
	/** Decoders have settled, so a newly composed frame may be revealed. */
	frameValid: boolean;
	key: string;
	revision: number;
};

/** Reveal only a composition produced after all loading inputs became usable. */
export function createHoverCompositionGate({
	read,
	requestComposition,
	onVisibilityChange,
}: {
	read: () => HoverCompositionStatus;
	requestComposition: () => void;
	onVisibilityChange: (visible: boolean) => void;
}) {
	let disposed = false;
	let visible = false;
	let key: string | null = null;
	let requiredRevision = 0;
	const show = (next: boolean) => {
		if (visible === next) return;
		visible = next;
		onVisibilityChange(next);
	};
	const check = (rendered: boolean) => {
		if (disposed) return;
		const status = read();
		if (!status.prerequisitesReady) {
			key = null;
			show(false);
			return;
		}
		if (key !== status.key || (visible && !status.canRetain)) {
			show(false);
			key = status.key;
			requiredRevision = status.revision + 1;
			requestComposition();
			return;
		}
		if (!rendered || visible || status.revision < requiredRevision) return;
		if (status.canRetain && status.frameValid) {
			show(true);
		} else if (!status.canRetain) {
			// Layout can resize a cleared canvas before the compositor applies its pose.
			requiredRevision = status.revision + 1;
			requestComposition();
		}
	};
	onVisibilityChange(false);
	return {
		refresh: () => check(false),
		postrender: () => check(true),
		dispose() {
			disposed = true;
			show(false);
		},
	};
}
