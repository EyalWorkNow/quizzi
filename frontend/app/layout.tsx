import type { Metadata } from "next";
import { Nunito_Sans, Sora } from "next/font/google";

import { TopNav } from "@/components/layout/top-nav";
import { Providers } from "@/components/providers";

import "./globals.css";

const bodyFont = Nunito_Sans({ subsets: ["latin"], variable: "--font-body", weight: ["400", "600", "700", "800"] });
const headingFont = Sora({ subsets: ["latin"], variable: "--font-heading", weight: ["600", "700", "800"] });

export const metadata: Metadata = {
  title: "Quizzi",
  description: "Live classroom quizzes — create, run, and review in real time"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${bodyFont.variable} ${headingFont.variable} font-sans antialiased text-ink bg-bg`} suppressHydrationWarning>
        <Providers>
          <div className="bg-mesh" />
          <div className="bg-grid absolute inset-0 z-0 pointer-events-none" />
          <div className="relative z-10 min-h-screen">
            <TopNav />
            <main className="container mx-auto p-4 md:p-6 lg:p-10 max-w-7xl">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
