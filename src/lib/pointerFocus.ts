import "./pointerFocus.css";

/** Keep editor shortcuts from adding a ring to a mouse-focused control.
 * Tab releases the override before moving focus to another control.
 */
export function installPointerFocusGuard() {
	let pointerInput = false;
	let pointerFocused: HTMLElement | null = null;
	const clear = () => {
		pointerFocused?.removeAttribute("data-pointer-focus");
		pointerFocused = null;
	};
	const mark = (element: HTMLElement) => {
		// Text entry keeps its existing focus treatment, regardless of modality.
		if (
			element.matches("input, textarea, select, [role='textbox']") ||
			element.isContentEditable
		)
			return;
		pointerFocused = element;
		element.setAttribute("data-pointer-focus", "");
	};
	const onPointerDown = (event: PointerEvent) => {
		pointerInput = true;
		clear();
		const active = document.activeElement;
		// Clicking an already-focused control does not emit another focusin.
		if (
			active instanceof HTMLElement &&
			event.target instanceof Node &&
			active.contains(event.target)
		)
			mark(active);
	};
	const onFocusIn = (event: FocusEvent) => {
		clear();
		if (pointerInput && event.target instanceof HTMLElement) mark(event.target);
	};
	const onFocusOut = (event: FocusEvent) => {
		if (event.target === pointerFocused) clear();
	};
	const onKeyDown = (event: KeyboardEvent) => {
		pointerInput = false;
		// Arrow keys and other editor shortcuts must not reveal a ring on the
		// control last clicked. Real focus changes still clear it via focusout.
		if (event.key === "Tab") clear();
	};
	const onWindowBlur = () => {
		pointerInput = false;
		clear();
	};
	window.addEventListener("pointerdown", onPointerDown, true);
	window.addEventListener("focusin", onFocusIn, true);
	window.addEventListener("focusout", onFocusOut, true);
	window.addEventListener("keydown", onKeyDown, true);
	window.addEventListener("blur", onWindowBlur);
	return () => {
		clear();
		window.removeEventListener("pointerdown", onPointerDown, true);
		window.removeEventListener("focusin", onFocusIn, true);
		window.removeEventListener("focusout", onFocusOut, true);
		window.removeEventListener("keydown", onKeyDown, true);
		window.removeEventListener("blur", onWindowBlur);
	};
}
