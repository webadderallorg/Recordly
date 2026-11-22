import "./PlusBadge.css";

export function PlusBadge({
	size = "sm",
	className = "",
}: {
	size?: "sm" | "md" | "lg";
	className?: string;
}) {
	return (
		<span className={`plus-badge ${className}`} data-size={size}>
			<span className="plus-badge__label">CLOUD</span>
		</span>
	);
}
