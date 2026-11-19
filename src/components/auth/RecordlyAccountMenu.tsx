import { ChatWarning } from "@/components/ui/icons";
import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { Modal } from "@heroui/react";
import { FolderOpen, GearSix, Palette, SignOut, UserCircle } from "@phosphor-icons/react";
import type { User } from "@supabase/supabase-js";
import { useContext, useEffect, useState } from "react";
import { AccountSettings } from "@/components/auth/AccountSettings";
import { useBilling } from "@/components/billing/BillingProvider";
import { PlusBadge } from "@/components/billing/PlusBadge";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import {
	AccountAvatar,
	AccountProfileContext,
	getAccountProfile,
} from "@/components/ui/account-avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/contexts/I18nContext";
import type { SettingsSection } from "@/components/video-editor/SettingsSections";
import { signOutRecordly } from "@/lib/auth/recordlyAuth";

export function RecordlyAccountMenu({
	onSignIn,
	onSettings,
	className,
	user: suppliedUser,
	compact = false,
	triggerLabel,
	placement,
}: {
	onSignIn: () => void;
	onSettings: (section?: SettingsSection) => void;
	className: string;
	user?: User | null;
	compact?: boolean;
	triggerLabel?: string;
	placement?: "header";
}) {
	const { t } = useI18n();
	const accountMenuLabel = triggerLabel ?? t("settings.account.openMenu", "Open account menu");
	const contextUser = useContext(AccountProfileContext);
	const user = suppliedUser === undefined ? contextUser : suppliedUser;
	const profile = getAccountProfile(user);
	const billing = useBilling();
	const [open, setOpen] = useState(false);
	const [accountOpen, setAccountOpen] = useState(false);
	const [feedbackOpen, setFeedbackOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [openingRawFolder, setOpeningRawFolder] = useState(false);
	const [error, setError] = useState<string>();
	useEffect(() => {
		if (!user) {
			setOpen(false);
			setAccountOpen(false);
		}
	}, [user]);
	if (!user)
		return (
			<Button
				variant="ghost"
				isIconOnly={compact}
				aria-label={compact ? accountMenuLabel : t("editor.cloud.signIn", "Sign in")}
				className={className}
				onClick={onSignIn}
			>
				<UserCircle className="size-[18px]" />
				{!compact && t("editor.cloud.signIn", "Sign in")}
			</Button>
		);
	return (
		<>
			<Popover
				open={open}
				onOpenChange={(value) => {
					setOpen(value);
					if (!value) setError(undefined);
				}}
			>
				<PopoverTrigger>
					<Button
						variant="ghost"
						isIconOnly={compact}
						aria-label={accountMenuLabel}
						className={className}
					>
						<span className="relative inline-flex shrink-0">
							<AccountAvatar user={user} className={compact ? "!size-7" : "size-6"} />
							{compact && billing.status?.billing.plan === "pro" && (
								<PlusBadge className="plus-badge--avatar" />
							)}
						</span>
						{!compact && <span className="truncate">{profile.name}</span>}
						{!compact && billing.status?.billing.plan === "pro" && <PlusBadge />}
					</Button>
				</PopoverTrigger>
				<PopoverContent
					side={placement === "header" ? "bottom" : compact ? "right" : "top"}
					align={compact ? "end" : "start"}
					sideOffset={10}
					aria-label={t("settings.account.menu", "Account menu")}
					className="w-[280px] rounded-2xl border border-border bg-background p-2 shadow-xl"
				>
					<Button
						variant="ghost"
						className="h-auto w-full justify-start gap-3 rounded-xl p-3 text-left"
						aria-label={t("settings.account.manage", "Manage account")}
						onClick={() => {
							setOpen(false);
							setAccountOpen(true);
						}}
					>
						<AccountAvatar user={user} className="size-9" />
						<span className="min-w-0 flex-1">
							<span className="block truncate text-sm font-medium">
								{profile.name}
							</span>
							<span className="mt-1 block text-xs text-muted">
								{billing.status?.billing.plan === "pro" ? (
									<span aria-label={t("settings.account.plusPlan", "Cloud plan")}>
										<PlusBadge />
									</span>
								) : (
									t("settings.account.yourAccount", "Your account")
								)}
							</span>
						</span>
					</Button>
					<div className="my-2 border-t border-border" />
					<Button
						variant="ghost"
						className="h-11 w-full justify-start gap-3 rounded-xl px-3 text-sm font-normal"
						onClick={() => {
							setOpen(false);
							setFeedbackOpen(true);
						}}
					>
						<ChatWarning weight="fill" className="size-5" />
						{t("settings.account.feedback", "Feedback")}
					</Button>
					<Button
						variant="ghost"
						className="h-11 w-full justify-start gap-3 rounded-xl px-3 text-sm font-normal"
						onClick={() => {
							setOpen(false);
							onSettings();
						}}
					>
						<GearSix className="size-5" />
						{t("settings.account.settings", "Settings")}
					</Button>

					<Button
						variant="ghost"
						className="h-11 w-full justify-start gap-3 rounded-xl px-3 text-sm font-normal"
						onClick={() => {
							setOpen(false);
							onSettings("appearance");
						}}
					>
						<Palette className="size-5" />
						{t("settings.appPreferences.appearance", "Appearance")}
					</Button>

					<Button
						variant="ghost"
						className="h-11 w-full justify-start gap-3 rounded-xl px-3 text-sm font-normal"
						disabled={openingRawFolder}
						onClick={async () => {
							if (openingRawFolder) return;
							setOpeningRawFolder(true);
							setError(undefined);
							try {
								const result = await window.electronAPI.openRecordingsFolder();
								if (!result?.success) throw new Error("Open folder failed");
								setOpen(false);
							} catch {
								setError(
									t(
										"settings.appPreferences.openFolderFailed",
										"Could not open this folder.",
									),
								);
							} finally {
								setOpeningRawFolder(false);
							}
						}}
					>
						<FolderOpen className="size-5" />
						{t("ui.openRawFiles", "Open raw folder")}
					</Button>

					<Button
						variant="ghost"
						className="h-11 w-full justify-start gap-3 rounded-xl px-3 text-sm font-normal"
						disabled={busy}
						onClick={async () => {
							if (busy) return;
							setBusy(true);
							setError(undefined);
							try {
								await signOutRecordly();
								setOpen(false);
							} catch {
								setError(t("support.signOutFailure"));
							} finally {
								setBusy(false);
							}
						}}
					>
						<SignOut className="size-5" />
						{busy
							? t("settings.account.loggingOut", "Logging out…")
							: t("settings.account.logOut", "Log out")}
					</Button>
					{error && (
						<p role="alert" className="px-3 py-2 text-xs text-danger">
							{error} <ErrorReportButton error={error} />
						</p>
					)}
				</PopoverContent>
			</Popover>
			<FeedbackDialog
				hideTrigger
				open={feedbackOpen}
				onOpenChange={setFeedbackOpen}
				onSignIn={onSignIn}
			/>
			<Modal isOpen={accountOpen} onOpenChange={setAccountOpen}>
				<Modal.Backdrop variant="blur">
					<Modal.Container size="lg" scroll="inside">
						<Modal.Dialog
							aria-label={t("settings.account.settingsLabel", "Account settings")}
							className="account-modal"
						>
							<Modal.CloseTrigger aria-label={t("common.actions.close", "Close")} />
							<Modal.Header>
								<Modal.Heading>
									{t("settings.account.title", "Account")}
								</Modal.Heading>
								<p className="text-sm text-muted">
									{t(
										"settings.account.description",
										"Manage your profile and sign-in details.",
									)}
								</p>
							</Modal.Header>
							<Modal.Body className="account-modal-body">
								<AccountSettings key={user.id} user={user} layout="modal" />
							</Modal.Body>
						</Modal.Dialog>
					</Modal.Container>
				</Modal.Backdrop>
			</Modal>
		</>
	);
}
