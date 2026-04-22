import { cn } from "@/lib/utils";

export function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-full border border-accent/25 bg-highlight px-2.5 py-1 text-xs font-semibold text-accent",
        className
      )}
    >
      {children}
    </span>
  );
}
