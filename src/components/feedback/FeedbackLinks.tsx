import { toast } from "@/components/ui/toast";

const RECORDLY_GITHUB_URL = "https://github.com/webadderallorg/Recordly";
export const RECORDLY_ISSUES_URL = `${RECORDLY_GITHUB_URL}/issues`;
export const RECORDLY_DISCORD_URL = "https://discord.gg/sdv2FBVNgE";

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
