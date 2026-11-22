interface DockVisibility {
	isVisible(): boolean;
	show(): Promise<void>;
	hide(): void;
}

/** macOS process transformations must not overlap or rapidly reverse. */
export function createDockVisibilityController(dock: DockVisibility) {
	let desired = dock.isVisible();
	let pending = false;
	let disposed = false;
	let lastChange = -Infinity;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const apply = () => {
		if (disposed || pending || timer || dock.isVisible() === desired) return;
		// Electron ignores a hide within one second of show; rapid transformations
		// can also leave orphan icons in the Dock (electron/electron#37487).
		const delay = 1100 - (Date.now() - lastChange);
		if (delay > 0) {
			timer = setTimeout(() => {
				timer = undefined;
				apply();
			}, delay);
			return;
		}
		lastChange = Date.now();
		if (!desired) {
			dock.hide();
			return;
		}
		pending = true;
		void dock
			.show()
			.catch((error) => console.warn("Could not show Recordly in the Dock:", error))
			.finally(() => {
				pending = false;
				if (!desired) apply();
			});
	};

	return {
		setVisible(value: boolean) {
			desired = value;
			apply();
		},
		dispose() {
			disposed = true;
			if (timer) clearTimeout(timer);
		},
	};
}
