"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Flash, TickCircle, UserAdd, Personalcard } from "iconsax-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { setToken } from "@/lib/auth";

const SIGNUP_FEATURES = [
  "Upload any material and get quiz questions instantly",
  "Run live sessions — students join with a PIN in seconds",
  "See exactly where each student needs more help",
];

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const res = await api.signup(email, password);
      setToken(res.access_token);
      router.push("/teacher/dashboard");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4">
      <div className="w-full max-w-4xl glass-premium rounded-2xl overflow-hidden border border-ink/15 shadow-card">
        <div className="grid md:grid-cols-2">
          {/* Left brand panel */}
          <div className="hidden md:flex flex-col justify-between p-10 bg-gradient-to-br from-accent/20 via-accent/5 to-transparent border-r border-ink/15">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-bg shadow-accent">
                <Flash size={20} variant="Bold" />
              </span>
              <span className="text-xl font-bold text-ink tracking-tight">Quizzi</span>
            </div>
            <div className="space-y-6">
              <div className="space-y-2">
                <h2 className="text-3xl font-bold text-ink leading-tight">
                  Your classroom,<br />
                  <span className="gradient-text">supercharged.</span>
                </h2>
                <p className="text-slate text-sm leading-relaxed">
                  Create your free account and start running live quizzes today.
                </p>
              </div>
              <ul className="space-y-4">
                {SIGNUP_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <TickCircle size={18} variant="Bold" className="text-accent shrink-0 mt-0.5" />
                    <span className="text-sm text-ink/80 leading-snug">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-[11px] text-slate/50 uppercase tracking-widest">
              Trusted by teachers worldwide
            </p>
          </div>

          {/* Right form panel */}
          <div className="p-8 md:p-10 flex flex-col justify-center">
            <div className="mb-8 space-y-1">
              <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-highlight border border-accent/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent">
                <UserAdd size={12} variant="Bold" />
                New Teacher
              </p>
              <h1 className="text-2xl font-bold text-ink mt-3">Create your account</h1>
              <p className="text-sm text-slate">Set up your Quizzi teacher workspace.</p>
            </div>
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate uppercase tracking-wider" htmlFor="signup-email">
                  Email
                </label>
                <Input
                  id="signup-email"
                  type="email"
                  placeholder="teacher@school.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate uppercase tracking-wider" htmlFor="signup-password">
                  Password
                </label>
                <Input
                  id="signup-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error ? (
                <p className="rounded-xl bg-danger/15 border border-danger/40 p-3 text-sm text-danger">{error}</p>
              ) : null}
              <Button className="w-full h-11 font-bold" type="submit">
                <Personalcard size={16} variant="Bold" className="mr-1.5" />
                Create Account
              </Button>
            </form>
            <p className="mt-6 text-center text-xs text-slate">
              Already have an account?{" "}
              <Link href="/login" className="text-accent hover:underline font-semibold">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
