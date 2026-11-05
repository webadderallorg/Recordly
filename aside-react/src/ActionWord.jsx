import React from "react";

const actionEmojis = { capture: "🎥", edit: "✂️", share: "📤" };

export default function ActionWord({ action, children }) {
	return (
		<span className="intro-action">
			<span className="intro-action-emoji" aria-hidden="true">{actionEmojis[action]}</span>
			{children}
		</span>
	);
}
