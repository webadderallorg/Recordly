import { Avatar } from "@heroui/react";
import { createContext, useContext } from "react";
import type { User } from "@supabase/supabase-js";

export const AccountProfileContext = createContext<User | null>(null);
export function getAccountProfile(user: User | null, fallback?: string) {
	const metadata = user?.user_metadata;
	const name = [metadata?.full_name, metadata?.name, user?.email, fallback, "Local profile"].find(
		(value) => typeof value === "string" && value.trim(),
	) as string;
	const initials = name
		.split("@")[0]
		.split(/[\s._-]+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0])
		.join("")
		.toUpperCase();
	const picture = [metadata?.avatar_url, metadata?.picture].find(
		(value) => typeof value === "string" && /^https?:\/\//.test(value),
	);
	return { name, initials, picture };
}
export function AccountAvatar({
	label,
	className = "",
	user,
}: {
	label?: string;
	className?: string;
	user?: User | null;
}) {
	const context = useContext(AccountProfileContext);
	const profile = getAccountProfile(user === undefined ? context : user, label);
	return (
		<Avatar
			aria-label={profile.name}
			className={`shrink-0 !rounded-full bg-accent/15 text-accent ${className}`}
		>
			{profile.picture && (
				<Avatar.Image
					src={profile.picture}
					alt={profile.name}
					className="!rounded-full object-cover"
				/>
			)}
			<Avatar.Fallback className="!rounded-full bg-accent/15 text-xs font-medium text-accent">
				{profile.initials}
			</Avatar.Fallback>
		</Avatar>
	);
}
