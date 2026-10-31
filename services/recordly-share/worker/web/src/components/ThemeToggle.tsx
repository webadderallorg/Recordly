import { Button } from "@heroui/react";
import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

export default function ThemeToggle({ sidebar = false }: { sidebar?: boolean }) {
	const [dark, setDark] = useState(false);
	useEffect(() => {
		const update = () => setDark(document.documentElement.dataset.theme === "dark");
		update();
		const observer = new MutationObserver(update);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});
		return () => observer.disconnect();
	}, []);
	const label = dark ? "Light mode" : "Dark mode";
	return (
		<Button
			variant="ghost"
			isIconOnly={!sidebar}
			aria-label={`Switch to ${label.toLowerCase()}`}
			className={
				sidebar
					? "h-10 w-full justify-start gap-3 px-3 text-[13px] text-muted-foreground"
					: "size-9 min-w-9 shrink-0"
			}
			onPress={() => {
				const theme = dark ? "light" : "dark";
				document.documentElement.dataset.theme = theme;
				document.documentElement.classList.toggle("dark", theme === "dark");
				document.documentElement.style.colorScheme = theme;
				try {
					localStorage.setItem("recordly.theme", theme);
				} catch {
					/* Theme still works without storage. */
				}
			}}
		>
			{dark ? <SunIcon className="size-[18px]" /> : <MoonIcon className="size-[18px]" />}
			{sidebar && label}
		</Button>
	);
}
