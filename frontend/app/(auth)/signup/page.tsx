"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Personalcard, UserAdd } from "iconsax-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { setToken } from "@/lib/auth";

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
    <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2">
      <Card className="border-0 bg-gradient-to-br from-bg via-panel to-card text-ink">
        <CardContent className="space-y-3 p-6 md:p-8">
          <p className="inline-flex w-fit items-center gap-1 rounded-full bg-highlight px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink/90">
            <UserAdd size={13} variant="Bold" />
            New Teacher
          </p>
          <h1 className="font-[var(--font-heading)] text-3xl text-ink">Create your workspace</h1>
          <p className="text-sm text-ink/85">Get from material upload to live quiz quickly with guided flow.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Personalcard size={17} className="text-accent" variant="Bold" />
            Sign Up
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={submit}>
            <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {error ? <p className="rounded-xl bg-danger/15 border border-danger/40 p-2 text-sm text-danger">{error}</p> : null}
            <Button className="w-full" type="submit">
              Create Account
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
