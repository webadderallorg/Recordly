import { Button } from "@heroui/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { installPointerFocusGuard } from "@/lib/pointerFocus";
import "@/index.css";

if (!new URLSearchParams(location.search).has("baseline")) installPointerFocusGuard();

function FocusControls() {
	const [presses, setPresses] = useState(0);
	const press = () => setPresses((count) => count + 1);
	return (
		<div className="flex items-center gap-6 p-10">
			<button type="button" onClick={press}>
				Native control
			</button>
			<Button onPress={press}>HeroUI control</Button>
			<input aria-label="Text input" defaultValue="Editable text" />
			<output aria-label="Press count">{presses}</output>
		</div>
	);
}

createRoot(document.getElementById("root")!).render(
	<ThemeProvider>
		<FocusControls />
	</ThemeProvider>,
);
