import { EnvelopeSimple, GithubLogo, XLogo, YoutubeLogo } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { useScopedT } from "@/contexts/I18nContext";

const RECORDLY_GITHUB_URL = "https://github.com/webadderallorg/Recordly";
export const RECORDLY_ISSUES_URL = `${RECORDLY_GITHUB_URL}/issues`;
export const RECORDLY_DISCORD_URL = "https://discord.gg/sdv2FBVNgE";
const RECORDLY_X_URL = "https://x.com/RecordlyHQ";
const RECORDLY_YOUTUBE_URL = "https://www.youtube.com/@recordlydev";

export function DiscordIcon(props: React.SVGProps<SVGSVGElement>) {
	return (
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
			<path d="M20.317 4.369A19.791 19.791 0 0 0 15.418 3a13.255 13.255 0 0 0-.615 1.263 18.27 18.27 0 0 0-5.606 0A13.25 13.25 0 0 0 8.582 3a19.736 19.736 0 0 0-4.9 1.369C.533 9.091-.32 13.697.099 18.237a19.917 19.917 0 0 0 5.993 3.024 14.32 14.32 0 0 0 1.284-2.108 12.804 12.804 0 0 1-2.021-.972c.17-.126.335-.258.495-.395a14.135 14.135 0 0 0 12.3 0c.16.137.325.269.495.395a12.736 12.736 0 0 1-2.026.974 14.103 14.103 0 0 0 1.284 2.106 19.883 19.883 0 0 0 5.996-3.024c.489-5.258-.836-9.822-3.682-13.868ZM8.02 15.331c-1.182 0-2.154-1.085-2.154-2.419 0-1.334.953-2.419 2.154-2.419 1.211 0 2.173 1.095 2.154 2.419 0 1.334-.953 2.419-2.154 2.419Zm7.96 0c-1.182 0-2.154-1.085-2.154-2.419 0-1.334.953-2.419 2.154-2.419 1.211 0 2.173 1.095 2.154 2.419 0 1.334-.943 2.419-2.154 2.419Z" />
		</svg>
	);
}

export async function openExternalLink(url: string, errorMessage: string) {
	try {
		const result = await window.electronAPI.openExternalUrl(url);
		if (!result.success) {
			toast.error(result.error || errorMessage);
		}
	} catch (error) {
		toast.error(`${errorMessage} ${String(error)}`);
	}
}

export function FeedbackLinks() {
	const t = useScopedT("editor");
	const tBilling = useScopedT("billing");
	const tEditing = useScopedT("editing");
	const links = [
		{
			label: "Discord",
			accessibleLabel: tEditing("joinDiscord", "Join Discord"),
			url: RECORDLY_DISCORD_URL,
			Icon: DiscordIcon,
		},
		{ label: "GitHub", accessibleLabel: "GitHub", url: RECORDLY_GITHUB_URL, Icon: GithubLogo },
		{ label: "X", accessibleLabel: "X", url: RECORDLY_X_URL, Icon: XLogo },
		{
			label: "YouTube",
			accessibleLabel: "YouTube",
			url: RECORDLY_YOUTUBE_URL,
			Icon: YoutubeLogo,
		},
	];

	return (
		<div className="flex shrink-0 flex-col">
			<div className="flex items-center gap-1">
				<Dialog>
					<DialogTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-8 min-w-0 flex-1 rounded-lg px-1 text-xs text-muted-foreground hover:text-foreground"
						>
							{t("socials", "Socials")}
						</Button>
					</DialogTrigger>
					<DialogContent className="max-w-sm">
						<DialogHeader>
							<DialogTitle>{t("socials", "Socials")}</DialogTitle>
						</DialogHeader>
						<div className="grid grid-cols-4 gap-2">
							{links.map(({ label, accessibleLabel, url, Icon }) => (
								<Button
									key={label}
									type="button"
									variant="ghost"
									className="h-20 w-full min-w-0 flex-col gap-2 rounded-xl px-1 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
									aria-label={accessibleLabel}
									onClick={() =>
										void openExternalLink(
											url,
											t("feedback.openFailed", "Failed to open link."),
										)
									}
								>
									<Icon className="size-7 shrink-0" aria-hidden="true" />
									<span>{label}</span>
								</Button>
							))}
						</div>
					</DialogContent>
				</Dialog>
				<Dialog>
					<DialogTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-8 min-w-0 flex-1 rounded-lg px-1 text-xs text-muted-foreground hover:text-foreground"
						>
							{tBilling("contact", "Contact")}
						</Button>
					</DialogTrigger>
					<DialogContent className="max-w-sm">
						<DialogHeader>
							<DialogTitle>{tBilling("contact", "Contact")}</DialogTitle>
						</DialogHeader>
						<div className="flex flex-col gap-2">
							{["support@recordly.dev", "youngchen3442@gmail.com"].map((email) => (
								<Button
									key={email}
									type="button"
									variant="ghost"
									className="h-auto min-h-12 w-full justify-start gap-3 rounded-xl px-3 py-3 text-sm hover:bg-foreground/5"
									onClick={() =>
										void openExternalLink(
											`mailto:${email}`,
											t("feedback.openFailed", "Failed to open link."),
										)
									}
								>
									<EnvelopeSimple
										className="size-5 shrink-0 text-muted-foreground"
										aria-hidden="true"
									/>
									<span className="min-w-0 break-all whitespace-normal text-left">
										{email}
									</span>
								</Button>
							))}
						</div>
					</DialogContent>
				</Dialog>
			</div>
		</div>
	);
}
