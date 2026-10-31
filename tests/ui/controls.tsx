import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Card, Label } from "@heroui/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Select,
	SelectTrigger,
	SelectValue,
	SelectContent,
	SelectItem,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SliderControl } from "@/components/video-editor/SliderControl";
import { ColorControl } from "@/components/ui/color-picker";
import { Toaster, toast } from "@/components/ui/toast";
import { I18nProvider } from "@/contexts/I18nContext";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";
import "@/index.css";
function Controls() {
	const [enabled, setEnabled] = useState(false),
		[selection, setSelection] = useState("mp4"),
		[value, setValue] = useState(20),
		[format, setFormat] = useState("wide"),
		[action, setAction] = useState(""),
		[color, setColor] = useState("#2563eb");
	const { toggleTheme } = useTheme();
	return (
		<main className="mx-auto max-w-3xl p-8">
			<Card>
				<Card.Header>
					<Card.Title>Recordly controls</Card.Title>
				</Card.Header>
				<Card.Content className="gap-5">
					<Button onClick={toggleTheme}>Toggle theme</Button>
					<Switch
						aria-label="Capture audio"
						checked={enabled}
						onCheckedChange={setEnabled}
					>
						<Label>Capture audio</Label>
					</Switch>
					<Select
						aria-label="Export format"
						value={selection}
						onValueChange={setSelection}
					>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="mp4">MP4</SelectItem>
							<SelectItem value="gif">GIF</SelectItem>
						</SelectContent>
					</Select>
					<SliderControl
						label="Padding"
						value={value}
						defaultValue={20}
						min={0}
						max={100}
						step={1}
						onChange={setValue}
						formatValue={(v) => `${v}px`}
						parseInput={Number}
					/>
					<ToggleGroup
						type="single"
						value={format}
						onValueChange={setFormat}
						aria-label="Aspect ratio"
					>
						<ToggleGroupItem value="wide">Wide</ToggleGroupItem>
						<ToggleGroupItem value="square">Square</ToggleGroupItem>
					</ToggleGroup>
					<Tabs defaultValue="scene">
						<TabsList aria-label="Settings sections">
							<TabsTrigger value="scene">Scene</TabsTrigger>
							<TabsTrigger value="cursor">Cursor</TabsTrigger>
						</TabsList>
						<TabsContent value="scene">Scene settings</TabsContent>
						<TabsContent value="cursor">Cursor settings</TabsContent>
					</Tabs>
					<Dialog>
						<DialogTrigger asChild>
							<Button>Save project</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Project name</DialogTitle>
							</DialogHeader>
							<Input aria-label="Project name" />
							<Button onClick={() => toast.success("Saved")}>Save</Button>
						</DialogContent>
					</Dialog>
					<Popover>
						<PopoverTrigger asChild>
							<Button>Export options</Button>
						</PopoverTrigger>
						<PopoverContent aria-label="Export options">
							<Input aria-label="Filename" />
							<Switch aria-label="Loop" />
							<Button onClick={() => setAction("export")}>Export video</Button>
						</PopoverContent>
					</Popover>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button>Actions</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent>
							<DropdownMenuItem
								textValue="Duplicate"
								onSelect={() => setAction("duplicate")}
							>
								Duplicate
							</DropdownMenuItem>
							<DropdownMenuItem
								textValue="Delete"
								onSelect={() => setAction("delete")}
							>
								Delete
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<ColorControl label="Caption color" value={color} onChange={setColor} />
					<Button
						onClick={() =>
							toast.success("Project saved", {
								action: { label: "Show file", onClick: () => setAction("reveal") },
							})
						}
					>
						Notify
					</Button>
					<output data-testid="state">
						{JSON.stringify({ enabled, selection, value, format, action, color })}
					</output>
				</Card.Content>
			</Card>
			<Toaster />
		</main>
	);
}
createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<ThemeProvider>
			<I18nProvider>
				<Controls />
			</I18nProvider>
		</ThemeProvider>
	</React.StrictMode>,
);
