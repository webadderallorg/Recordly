import { useId, useState } from "react";
import { useI18n } from "@/contexts/I18nContext";

/** Keep backend diagnostics available without making untranslated text the primary message. */
export function LocalizedError({ error, summary }: { error: string; summary?: string }) {
	const { t } = useI18n();
	const [expanded, setExpanded] = useState(false);
	const id = useId();
	return (
		<span className="block">
			<span>{summary ?? t("ui.couldNotCompleteAction")}</span>{" "}
			<button
				type="button"
				className="text-xs underline"
				aria-expanded={expanded}
				aria-controls={id}
				onClick={() => setExpanded((value) => !value)}
			>
				{t("ui.technicalDetails")}
			</button>
			<span
				id={id}
				hidden={!expanded}
				className={`mt-2 select-text break-words whitespace-pre-wrap text-xs text-muted-foreground ${expanded ? "block" : "hidden"}`}
			>
				{error}
			</span>
		</span>
	);
}
