// Script-free pages built from HeroUI, Recordly's font and its original vector mark.
import { returnPageAction, returnPageCss, returnPageMark } from "./assets.generated.mjs";

const messages = {
	"auth-received": {
		title: "You're almost in.",
		message: "Your sign-in link made it to Recordly. You can safely close this tab now.",
		note: null,
	},
	"auth-error": {
		title: "Let's try that again.",
		message:
			"This sign-in link didn't work. Open Recordly and request a fresh one. We'll meet you there.",
		note: "You can close this tab and continue in Recordly.",
	},
	"billing-return": {
		title: "Back to the good stuff.",
		message:
			"Head back to Recordly to check your subscription. Your plan updates after payment is confirmed.",
		note: "Once you're back in Recordly, you can close this tab.",
	},
};

export function renderReturnPage(state, protocol = "recordly", theme = "system") {
	if (!Object.hasOwn(messages, state)) throw new Error("Unknown return page state");
	if (!["recordly", "recordly-dev"].includes(protocol)) throw new Error("Unknown app protocol");
	if (!["system", "light", "dark"].includes(theme)) throw new Error("Unknown theme");
	const { title, message, note } = messages[state];
	const appLink = `${protocol}://${state === "billing-return" ? "billing/return" : "app/open"}`;
	return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${title} · Recordly</title>
  <style>${returnPageCss}</style>
</head>
<body data-return-state="${state}">
  <main>
    ${returnPageMark}
    <h1>${title}</h1>
    <p>${message}</p>
    ${returnPageAction.replace("RECORDLY_APP_LINK", appLink)}
    ${note ? `<p class="note">${note}</p>` : ""}
  </main>
  <footer>Need a hand? <a href="mailto:support@recordly.dev">We're here to help.</a></footer>
</body>
</html>`;
}
