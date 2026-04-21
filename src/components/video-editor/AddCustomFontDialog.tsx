import { Plus } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	addCustomFont,
	type CustomFont,
	DuplicateFontError,
	generateFontId,
	isValidGoogleFontsUrl,
	parseFontFamilyFromImport,
} from "@/lib/customFonts";
import { useScopedT } from "../../contexts/I18nContext";

interface AddCustomFontDialogProps {
	onFontAdded?: (font: CustomFont) => void;
}

export function AddCustomFontDialog({ onFontAdded }: AddCustomFontDialogProps) {
	const t = useScopedT("dialogs");
	const [open, setOpen] = useState(false);
	const [importUrl, setImportUrl] = useState("");
	const [fontName, setFontName] = useState("");
	const [loading, setLoading] = useState(false);

	const resetForm = () => {
		setImportUrl("");
		setFontName("");
		setLoading(false);
	};

	const handleOpenChange = (nextOpen: boolean) => {
		setOpen(nextOpen);
		if (!nextOpen) {
			resetForm();
		}
	};

	const handleImportUrlChange = (url: string) => {
		setImportUrl(url);

		// Auto-extract font name if valid Google Fonts URL
		if (isValidGoogleFontsUrl(url)) {
			const extracted = parseFontFamilyFromImport(url);
			if (extracted && !fontName) {
				setFontName(extracted);
			}
		}
	};

	const handleAdd = async () => {
		const normalizedImportUrl = importUrl.trim();
		const normalizedFontName = fontName.trim();

		// Validate inputs
		if (!normalizedImportUrl) {
			toast.error(t("addFont.enterUrl"));
			return;
		}

		if (!isValidGoogleFontsUrl(normalizedImportUrl)) {
			toast.error(t("addFont.invalidUrl"));
			return;
		}

		if (!normalizedFontName) {
			toast.error(t("addFont.enterName"));
			return;
		}

		setLoading(true);

		try {
			// Extract font family from URL
			const fontFamily = parseFontFamilyFromImport(normalizedImportUrl);
			if (!fontFamily) {
				toast.error(t("addFont.extractFailed"));
				return;
			}

			// Create custom font object
			const newFont: CustomFont = {
				id: generateFontId(normalizedFontName),
				name: normalizedFontName,
				fontFamily: fontFamily,
				importUrl: normalizedImportUrl,
			};

			// Add font (this will load and verify it) - throws if it fails
			await addCustomFont(newFont);

			// Notify parent
			if (onFontAdded) {
				onFontAdded(newFont);
			}

			toast.success(t("addFont.addSuccess", undefined, { name: normalizedFontName }));

			// Reset and close
			handleOpenChange(false);
		} catch (error) {
			console.error("Failed to add custom font:", error);
			if (error instanceof DuplicateFontError) {
				toast.error(t("addFont.addFailed"), {
					description: t("addFont.alreadyAdded", "This font has already been added."),
				});
				return;
			}

			const errorMessage = error instanceof Error ? error.message : "Failed to load font";
			toast.error(t("addFont.addFailed"), {
				description: errorMessage.includes("timeout")
					? t("addFont.loadTimeout")
					: t("addFont.loadFailed"),
			});
		} finally {
			setLoading(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					className="w-full bg-foreground/5 border-foreground/10 text-foreground hover:bg-foreground/10 h-9 text-xs"
				>
					<Plus className="w-3 h-3 me-1" />
					{t("addFont.title")}
				</Button>
			</DialogTrigger>
			<DialogContent className="bg-editor-surface-alt border-foreground/10 text-foreground">
				<DialogHeader>
					<DialogTitle>{t("addFont.heading")}</DialogTitle>
					<DialogDescription className="text-muted-foreground">
						{t("addFont.description")}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 mt-4">
					<div className="space-y-2">
						<Label htmlFor="import-url" className="text-foreground">
							{t("addFont.urlLabel")}
						</Label>
						<Input
							id="import-url"
							placeholder={t("addFont.urlPlaceholder")}
							value={importUrl}
							onChange={(e) => handleImportUrlChange(e.target.value)}
							className="bg-foreground/5 border-foreground/10 text-foreground"
						/>
						<p className="text-xs text-muted-foreground">{t("addFont.urlHelp")}</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="font-name" className="text-foreground">
							{t("addFont.nameLabel")}
						</Label>
						<Input
							id="font-name"
							placeholder={t("addFont.namePlaceholder")}
							value={fontName}
							onChange={(e) => setFontName(e.target.value)}
							className="bg-foreground/5 border-foreground/10 text-foreground"
						/>
						<p className="text-xs text-muted-foreground">{t("addFont.nameHelp")}</p>
					</div>

					<div className="flex justify-end gap-2 mt-6">
						<Button
							variant="outline"
							onClick={() => handleOpenChange(false)}
							className="bg-foreground/5 border-foreground/10 text-foreground hover:bg-foreground/10"
						>
							{t("addFont.cancel")}
						</Button>
						<Button
							onClick={handleAdd}
							disabled={loading}
							className="bg-blue-600 hover:bg-blue-700 text-white"
						>
							{loading ? t("addFont.adding") : t("addFont.addFont")}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
