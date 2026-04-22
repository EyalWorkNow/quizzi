"use client";

import { motion } from "framer-motion";
import { Book, Flash, Home2, Teacher } from "iconsax-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Home", icon: Home2 },
  { href: "/teacher/dashboard", label: "Dashboard", icon: Teacher },
  { href: "/student/join", label: "Join Game", icon: Book },
];

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-6 z-50 mx-auto w-full max-w-5xl px-4">
      <div className="glass-premium flex items-center justify-between gap-4 rounded-full border border-ink/15 px-6 py-3">
        <Link className="group flex items-center gap-3" href="/">
          <div className="relative">
            <div className="absolute inset-0 bg-accent blur-md opacity-20 transition-all group-hover:opacity-40" />
            <span className="relative grid h-10 w-10 place-items-center rounded-xl bg-accent text-bg shadow-lg transition-transform group-hover:scale-110">
              <Flash size={20} variant="Bold" />
            </span>
          </div>
          <div className="hidden sm:block">
            <p className="text-lg font-bold leading-none tracking-tight text-ink">Quizzy</p>
            <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-slate">Decision Engine</p>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {links.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/");

            return (
              <Link
                key={item.href}
                className={cn(
                  "group relative overflow-hidden rounded-full px-4 py-2 text-xs font-bold transition-all",
                  active ? "text-accent" : "text-slate hover:text-ink",
                )}
                href={item.href}
              >
                {active ? <motion.div layoutId="nav-pill" className="absolute inset-0 rounded-full border border-accent/25 bg-highlight" /> : null}
                <div className="relative flex items-center gap-2">
                  <Icon size={16} variant={active ? "Bold" : "Outline"} />
                  <span>{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/login" className="hidden sm:block">
            <Button variant="ghost" size="sm" className="text-xs font-bold">
              Login
            </Button>
          </Link>
          <Link href="/teacher/dashboard">
            <Button size="sm" className="text-xs font-bold">
              Primary Access
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
