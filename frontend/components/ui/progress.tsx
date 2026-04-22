export function Progress({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2.5 w-full rounded-full bg-ink/10">
      <div className="h-2.5 rounded-full bg-gradient-to-r from-accent to-info" style={{ width: `${clamped}%` }} />
    </div>
  );
}
