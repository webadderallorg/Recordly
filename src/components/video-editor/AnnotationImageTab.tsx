import { UploadSimple as Upload } from "@phosphor-icons/react";
import { useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { useScopedT } from "../../contexts/I18nContext";
import type { AnnotationSettingsPanelProps } from "./annotationSettingsShared";

interface AnnotationImageTabProps extends Pick<AnnotationSettingsPanelProps, "annotation" | "onContentChange"> {}

export function AnnotationImageTab({ annotation, onContentChange }: AnnotationImageTabProps) {
	const t = useScopedT("editor");
	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
		const files = event.target.files;
		if (!files || files.length === 0) return;

		const file = files[0];
		const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
		if (!validTypes.includes(file.type)) {
			toast.error(t("annotations.imageUploadError"), {
				description: t("annotations.imageUploadErrorDescription"),
			});
			event.target.value = "";
			return;
		}

		const reader = new FileReader();
		reader.onload = (loadEvent) => {
			const dataUrl = loadEvent.target?.result as string;
			if (dataUrl) {
				onContentChange(dataUrl);
				toast.success(t("annotations.imageUploadSuccess"));
			}
		};
		reader.onerror = () => {
			toast.error(t("annotations.imageUploadFailed"), {
				description: t("annotations.imageUploadFailedDescription"),
			});
		};

		reader.readAsDataURL(file);
		if (event.target) {
			event.target.value = "";
		}
	};

	return (
		<TabsContent value="image" className="mt-0 space-y-4">
			<input
				type="file"
				ref={fileInputRef}
				onChange={handleImageUpload}
				accept=".jpg,.jpeg,.png,.gif,.webp,image/*"
				className="hidden"
			/>
			<Button
				onClick={() => fileInputRef.current?.click()}
				variant="outline"
				className="w-full gap-2 bg-foreground/5 text-foreground border-foreground/10 hover:bg-[#2563EB] hover:text-white hover:border-[#2563EB] transition-all py-8"
			>
				<Upload className="w-5 h-5" />
				{t("annotations.uploadImage")}
			</Button>

			{annotation.content && annotation.content.startsWith("data:image") && (
				<div className="rounded-lg border border-foreground/10 overflow-hidden bg-foreground/5 p-2">
					<img src={annotation.content} alt="Uploaded annotation" className="w-full h-auto rounded-md" />
				</div>
			)}

			<p className="text-xs text-muted-foreground/70 text-center leading-relaxed">
				{t("annotations.supportedFormats")}
			</p>
		</TabsContent>
	);
}