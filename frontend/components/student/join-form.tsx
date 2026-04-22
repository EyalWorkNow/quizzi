"use client";

import { FormEvent, useState } from "react";
import { Game, People, Profile2User, ScanBarcode } from "iconsax-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function JoinForm({
  onSubmit,
  initialPin
}: {
  onSubmit: (pin: string, nickname: string, teamName?: string) => Promise<void>;
  initialPin?: string;
}) {
  const [pin, setPin] = useState(initialPin ?? "");
  const [nickname, setNickname] = useState("");
  const [teamName, setTeamName] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    await onSubmit(pin, nickname, teamName || undefined);
    setLoading(false);
  };

  return (
    <form className="space-y-3" onSubmit={submit}>
      <Field label="Game PIN" icon={<ScanBarcode size={14} />}>
        <Input placeholder="Game PIN" value={pin} onChange={(event) => setPin(event.target.value)} required />
      </Field>

      <Field label="Nickname" icon={<Profile2User size={14} />}>
        <Input placeholder="Nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} required />
      </Field>

      <Field label="Team (optional)" icon={<People size={14} />}>
        <Input placeholder="Team name" value={teamName} onChange={(event) => setTeamName(event.target.value)} />
      </Field>

      <Button className="w-full" disabled={loading} type="submit">
        <Game size={16} variant="Bold" />
        {loading ? "Joining..." : "Join Game"}
      </Button>
    </form>
  );
}

function Field({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wide text-slate">
      <span className="mb-1 inline-flex items-center gap-1">
        {icon}
        {label}
      </span>
      {children}
    </label>
  );
}
