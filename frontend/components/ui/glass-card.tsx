"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface GlassCardProps {
    children: ReactNode;
    className?: string;
    variant?: "default" | "premium" | "accent" | "glow" | "interactive";
    onClick?: () => void;
}

export function GlassCard({ children, className, variant = "default", onClick }: GlassCardProps) {
    return (
        <div
            onClick={onClick}
            className={cn(
                "rounded-lg overflow-hidden transition-all duration-300 will-change-transform",
                variant === "default" && "glass",
                variant === "premium" && "glass-premium",
                variant === "accent" && "glass border-accent/20 hover:border-accent/40 bg-accent/5",
                variant === "glow" && "glass border-accent/30 bg-accent/5 shadow-accent",
                variant === "interactive" && "glass border-ink/15 hover:border-accent/35 hover:bg-accent/5 hover:shadow-card cursor-pointer",
                className
            )}
        >
            {children}
        </div>
    );
}
