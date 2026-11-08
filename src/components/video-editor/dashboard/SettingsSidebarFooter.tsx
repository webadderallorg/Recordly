import { CaretRight } from "@phosphor-icons/react";
import { useContext } from "react";
import { useOptionalBilling } from "@/components/billing/BillingProvider";
import {
	AccountAvatar,
	AccountProfileContext,
	getAccountProfile,
} from "@/components/ui/account-avatar";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/I18nContext";
import styles from "./SettingsSidebarFooter.module.css";

export function SettingsSidebarFooter({ onAccount }: { onAccount: () => void }) {
	const { t } = useI18n();
	const billing = useOptionalBilling();
	const contextUser = useContext(AccountProfileContext);
	const user = contextUser ?? billing?.user ?? null;
	const profile = getAccountProfile(user);
	return (
		<Button
			variant="ghost"
			className={styles.account}
			onClick={onAccount}
			aria-label={t("settings.account.manage", "Manage account")}
		>
			<AccountAvatar user={user} className="!size-7" />
			<span className={styles.identity}>
				<span className={styles.name}>
					{profile.name === user?.email
						? t("settings.account.yourAccount", "Your account")
						: profile.name}
				</span>
				{user?.email && <span className={styles.email}>{user.email}</span>}
			</span>
			<CaretRight size={13} aria-hidden="true" className={styles.chevron} />
		</Button>
	);
}
