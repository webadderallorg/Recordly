import { Button as HeroButton, type ButtonProps as HeroButtonProps } from "@heroui/react";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant =
	| "default"
	| "destructive"
	| "destructive-soft"
	| "outline"
	| "secondary"
	| "ghost"
	| "link";
export interface ButtonProps
	extends Omit<
			HeroButtonProps,
			"variant" | "size" | "className" | "children" | "render" | "style"
		>,
		Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof HeroButtonProps | "onChange"> {
	style?: import("react").CSSProperties;
	className?: string;
	children?: import("react").ReactNode;
	disabled?: boolean;
	variant?: Variant;
	size?: "default" | "sm" | "lg" | "icon";
	iconSize?: "default" | "sm" | "lg" | "xl";
	onPress?: HeroButtonProps["onPress"];
}
const variants = {
	default: "primary",
	destructive: "danger",
	"destructive-soft": "danger-soft",
	outline: "outline",
	secondary: "secondary",
	ghost: "ghost",
	link: "ghost",
} as const;
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
	{
		variant = "default",
		size = "default",
		iconSize = "default",
		disabled,
		isDisabled,
		className,
		title,
		...props
	},
	ref,
) {
	const shared = {
		...props,
		ref,
		title,
		"aria-label": props["aria-label"] ?? title,
		isDisabled: disabled ?? isDisabled,
		size: size === "default" || size === "icon" ? ("md" as const) : size,
		isIconOnly: size === "icon",
		className: cn(
			{
				"[&_svg:not([class*=size-])]:size-4": iconSize === "default",
				"[&_svg:not([class*=size-])]:size-3.5": iconSize === "sm",
				"[&_svg:not([class*=size-])]:size-5": iconSize === "lg",
				"[&_svg:not([class*=size-])]:size-6": iconSize === "xl",
			},
			variant === "link" && "h-auto p-0 underline underline-offset-4",
			className,
		),
	};
	return (
		<HeroButton
			{...shared}
			variant={
				props["aria-pressed"] === true && variant === "ghost"
					? "secondary"
					: variants[variant]
			}
		/>
	);
});
