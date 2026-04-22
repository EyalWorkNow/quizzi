"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface GlassCardProps {
    children: ReactNode;
    className?: string;
    variant?: "default" | "premium" | "accent";
}

export function GlassCard({ children, className, variant = "default" }: GlassCardProps) {
    return (
        <div
            className={cn(
                "rounded-lg overflow-hidden transition-all duration-300",
                variant === "default" && "glass",
                variant === "premium" && "glass-premium",
                variant === "accent" && "glass border-accent/20 hover:border-accent/40 bg-accent/5",
                className
            )}
        >
            {children}
        </div>
    );
}
