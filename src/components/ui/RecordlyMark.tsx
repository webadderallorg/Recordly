import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/** The product mark, tinted by its surrounding control or wordmark. */
export function RecordlyMark({ className, style }: { className?: string; style?: CSSProperties }) {
	const source = `url(${import.meta.env.BASE_URL}app-icons/recordly-mark.svg)`;
	return (
		<span
			aria-hidden="true"
			className={cn("inline-block size-4 shrink-0 bg-current", className)}
			style={{
				maskImage: source,
				WebkitMaskImage: source,
				maskSize: "contain",
				WebkitMaskSize: "contain",
				maskRepeat: "no-repeat",
				WebkitMaskRepeat: "no-repeat",
				maskPosition: "center",
				WebkitMaskPosition: "center",
				...style,
			}}
		/>
	);
}
