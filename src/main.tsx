import { installFeedbackDiagnostics } from "./lib/feedback/diagnostics";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { I18nProvider } from "./contexts/I18nContext.tsx";
import { ThemeProvider } from "./contexts/ThemeContext.tsx";
import "./index.css";

installFeedbackDiagnostics();

document.documentElement.dataset.platform = /mac/i.test(navigator.platform) ? "macos" : "other";

// The capture picker covers whole displays, so it must never paint the app background.
if (new URLSearchParams(window.location.search).get("windowType") === "capture-picker") {
	document.documentElement.style.background = "transparent";
	document.body.style.background = "transparent";
}

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<ThemeProvider>
			<I18nProvider>
				<App />
			</I18nProvider>
		</ThemeProvider>
	</React.StrictMode>,
);
