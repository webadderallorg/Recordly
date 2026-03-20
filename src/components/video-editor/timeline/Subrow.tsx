import { cn } from "@/lib/utils";
interface SubrowProps {
  children: React.ReactNode;
}

export default function Subrow({ children }: SubrowProps) {
  return (
    <div className={cn("flex items-center min-h-[24px] gap-1 px-1.5 py-0 bg-[#23232a] rounded-md text-slate-300")}>
      {children}
    </div>
  );
}
