"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight2, Profile2User, ScanBarcode, TickCircle } from "iconsax-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

export default function StudentRegisterPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate">Loading...</p>}>
      <StudentRegisterContent />
    </Suspense>
  );
}

function StudentRegisterContent() {
  const search = useSearchParams();
  const [joinCode, setJoinCode] = useState(search.get("class_code") ?? "");
  const [pseudonym, setPseudonym] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    try {
      const payload = await api.studentRegister({
        join_code: joinCode.trim().toUpperCase(),
        pseudonym: pseudonym.trim(),
        display_name: displayName.trim() || undefined
      });
      setMessage(`Registered as ${payload.pseudonym}. You can now join games in this class.`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Card className="border-0 bg-gradient-to-r from-bg via-panel to-card text-ink">
        <CardContent className="space-y-2 p-6">
          <p className="inline-flex w-fit items-center gap-1 rounded-full bg-highlight px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink/90">
            <Profile2User size={13} variant="Bold" />
            Class Registration
          </p>
          <h1 className="font-[var(--font-heading)] text-2xl text-ink">Create Student Identity</h1>
          <p className="text-sm text-ink/85">Pseudonymous by default for privacy-safe classroom participation.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ScanBarcode size={17} className="text-accent" variant="Bold" />
            Registration Form
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form className="space-y-3" onSubmit={submit}>
            <Input placeholder="Class code" value={joinCode} onChange={(event) => setJoinCode(event.target.value)} required />
            <Input placeholder="Nickname" value={pseudonym} onChange={(event) => setPseudonym(event.target.value)} required />
            <Input
              placeholder="Display name (optional)"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <Button className="w-full" type="submit">
              <TickCircle size={15} variant="Bold" />
              Register
            </Button>
          </form>

          {message ? <p className="rounded-xl bg-success/15 border border-success/35 p-2 text-xs text-success">{message}</p> : null}
          {error ? <p className="rounded-xl bg-danger/15 border border-danger/40 p-2 text-xs text-danger">{error}</p> : null}

          <p className="text-xs text-slate">
            Ready to play?{" "}
            <Link className="inline-flex items-center gap-1 font-semibold text-accent hover:text-ink" href="/student/join">
              Go to join
              <ArrowRight2 size={14} />
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
