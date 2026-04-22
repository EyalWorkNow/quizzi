import { Activity } from "iconsax-react";

export default function LoadingPlay() {
  return (
    <p className="inline-flex items-center gap-2 text-sm text-slate">
      <Activity size={14} className="animate-pulse" />
      Loading question...
    </p>
  );
}
