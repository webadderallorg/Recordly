import {
	type ReturnPageState,
	renderReturnPage,
} from "../../services/browser-pages/render-return-page.mjs";
import "./email-preview.css";

const state = document.getElementById("return-state") as HTMLSelectElement;
const theme = document.getElementById("return-theme") as HTMLSelectElement;
const frame = document.getElementById("return-preview") as HTMLIFrameElement;
const render = () => {
	frame.srcdoc = renderReturnPage(
		state.value as ReturnPageState,
		"recordly-dev",
		theme.value as "light" | "dark",
	).replace(/href="recordly-dev:\/\/[^"]+"/g, 'href="#preview-action"');
};
state.addEventListener("change", render);
theme.addEventListener("change", render);
render();
