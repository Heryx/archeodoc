import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import type { DuplicateUSGroup } from "@/hooks/useDuplicateUSCheck";

type DuplicateUSBannerProps = {
  duplicates: DuplicateUSGroup[];
  onGoToUS: (id: number) => void;
};

export function DuplicateUSBanner({ duplicates, onGoToUS }: DuplicateUSBannerProps) {
  const [open, setOpen] = useState(false);

  if (duplicates.length === 0) return null;

  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 space-y-2">
      <button
        type="button"
        className="w-full flex items-center gap-2 text-sm font-medium text-amber-400"
        onClick={() => setOpen((prev) => !prev)}
      >
        <AlertTriangle size={14} className="shrink-0" />
        <span>
          {duplicates.length === 1
            ? "1 possibile US duplicata rilevata"
            : `${duplicates.length} possibili US duplicate rilevate`}
          {" - controlla prima di procedere"}
        </span>
        {open ? <ChevronUp size={14} className="ml-auto" /> : <ChevronDown size={14} className="ml-auto" />}
      </button>

      {open && (
        <div className="space-y-2 pt-1">
          {duplicates.map((group) => (
            <div
              key={group.normalizedCode}
              className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2"
            >
              <div className="text-xs text-amber-300 font-semibold mb-1">
                Codice normalizzato: <span className="font-mono">{group.normalizedCode}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {group.schede.map((scheda) => (
                  <button
                    key={scheda.id}
                    type="button"
                    onClick={() => onGoToUS(scheda.id)}
                    className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-200 hover:bg-amber-500/20 transition-colors"
                  >
                    {scheda.codiceUS}
                    <span className="opacity-60 text-[10px]">-&gt;</span>
                  </button>
                ))}
              </div>
              <div className="mt-1.5 text-[11px] text-amber-400/70">
                Potrebbero riferirsi alla stessa Unita Stratigrafica. Verifica e unifica se necessario.
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
