import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RecordlyDemoVideo } from "@/components/ui/RecordlyDemoVideo";
import "@/index.css";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<RecordlyDemoVideo />
	</StrictMode>,
);
