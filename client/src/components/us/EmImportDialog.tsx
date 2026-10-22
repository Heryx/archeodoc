import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GitBranch } from "lucide-react";

export type EmImportPlan = {
  graphName: string;
  formatVersion: string;
  generator: string;
  stats: { nodes: number; edges: number; unchanged: number };
  newUnits: { key: string; code: string; nodeType: string; description: string | null }[];
  newRelations: {
    key: string;
    source: string;
    target: string;
    emEdgeType: string;
    label: string;
    needsNewUnit: boolean;
  }[];
  periods: { key: string; code: string; from: string | null; to: string }[];
  epochs: {
    key: string;
    nome: string;
    descrizione: string | null;
    startTime: number | null;
    endTime: number | null;
    kind: "new" | "dates";
  }[];
  conflicts: { source: string; target: string; emEdgeType: string; reason: string }[];
  ignored: { nodeTypes: Record<string, number>; edgeTypes: Record<string, number> };
};

type Props = {
  open: boolean;
  fileName: string;
  plan: EmImportPlan | null;
  isApplying?: boolean;
  onConfirm: (selected: string[]) => void;
  onClose: () => void;
};

function countText(counts: Record<string, number>) {
  return Object.entries(counts)
    .map(([name, n]) => `${name} (${n})`)
    .join(", ");
}

export function EmImportDialog({ open, fileName, plan, isApplying, onConfirm, onClose }: Props) {
  // Selezione iniziale: tutto cio' che aggiunge senza sovrascrivere; i periodi
  // che cambiano un valore gia' compilato partono deselezionati.
  const initial = useMemo(() => {
    const keys = new Set<string>();
    if (!plan) return keys;
    plan.epochs.forEach((e) => keys.add(e.key));
    plan.newUnits.forEach((u) => keys.add(`unit|${u.key}`));
    plan.newRelations.forEach((r) => keys.add(r.key));
    plan.periods.filter((p) => !p.from).forEach((p) => keys.add(p.key));
    return keys;
  }, [plan]);
  const [checked, setChecked] = useState<Set<string>>(initial);
  useEffect(() => setChecked(new Set(initial)), [initial]);

  const toggle = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const nothing =
    !!plan &&
    !plan.newUnits.length &&
    !plan.newRelations.length &&
    !plan.periods.length &&
    !plan.epochs.length;

  const Row = ({ id, children }: { id: string; children: React.ReactNode }) => (
    <label className="flex items-start gap-3 rounded-md border border-border p-2 cursor-pointer hover:bg-muted/40 transition-colors">
      <Checkbox checked={checked.has(id)} onCheckedChange={() => toggle(id)} className="mt-0.5" />
      <div className="text-sm leading-snug">{children}</div>
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch size={16} /> Importa Extended Matrix
          </DialogTitle>
          <DialogDescription>
            {fileName}
            {plan ? ` — ${plan.stats.nodes} nodi, ${plan.stats.edges} archi, ${plan.stats.unchanged} già presenti.` : ""}{" "}
            Si aggiunge soltanto: nulla viene rimosso.
          </DialogDescription>
        </DialogHeader>

        {plan && (
          <div className="space-y-4 max-h-[55vh] overflow-y-auto py-1">
            {nothing && (
              <p className="text-sm text-muted-foreground">
                Il file non contiene nulla di nuovo rispetto al cantiere.
              </p>
            )}

            {plan.epochs.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold">Periodi nel registro ({plan.epochs.length})</h3>
                {plan.epochs.map((e) => (
                  <Row key={e.key} id={e.key}>
                    <span className="font-semibold">{e.nome}</span>
                    <Badge variant="secondary" className="ml-2 text-xs font-normal">
                      {e.kind === "new" ? "nuovo" : "aggiunge le date"}
                    </Badge>
                    {(e.startTime !== null || e.endTime !== null) && (
                      <span className="text-muted-foreground ml-2">
                        {e.startTime ?? "?"} → {e.endTime ?? "?"}
                      </span>
                    )}
                  </Row>
                ))}
              </section>
            )}

            {plan.newUnits.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold">Nuove US ({plan.newUnits.length})</h3>
                {plan.newUnits.map((u) => (
                  <Row key={u.key} id={`unit|${u.key}`}>
                    <span className="font-mono font-semibold">{u.code}</span>
                    <Badge variant="secondary" className="ml-2 text-xs font-normal">{u.nodeType}</Badge>
                    {u.description && <span className="text-muted-foreground ml-2">{u.description}</span>}
                  </Row>
                ))}
              </section>
            )}

            {plan.newRelations.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold">Nuovi rapporti ({plan.newRelations.length})</h3>
                {plan.newRelations.map((r) => (
                  <Row key={r.key} id={r.key}>
                    <span className="font-mono font-semibold">{r.source}</span>
                    <Badge variant="secondary" className="mx-2 text-xs font-normal">{r.label}</Badge>
                    <span className="font-mono">{r.target}</span>
                    {r.needsNewUnit && (
                      <span className="text-xs text-amber-600 ml-2">richiede la nuova US</span>
                    )}
                  </Row>
                ))}
              </section>
            )}

            {plan.periods.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold">Periodo / epoca ({plan.periods.length})</h3>
                {plan.periods.map((p) => (
                  <Row key={p.key} id={p.key}>
                    <span className="font-mono font-semibold">{p.code}</span>
                    <span className="text-muted-foreground mx-2">
                      {p.from ? `“${p.from}” →` : "→"}
                    </span>
                    <span>{p.to}</span>
                    {p.from && <span className="text-xs text-amber-600 ml-2">sostituisce il valore attuale</span>}
                  </Row>
                ))}
              </section>
            )}

            {plan.conflicts.length > 0 && (
              <section className="space-y-1">
                <h3 className="text-sm font-semibold text-destructive">
                  Conflitti, non applicati ({plan.conflicts.length})
                </h3>
                {plan.conflicts.map((c, i) => (
                  <p key={i} className="text-sm text-muted-foreground">
                    <span className="font-mono">{c.source}</span> → <span className="font-mono">{c.target}</span>{" "}
                    ({c.emEdgeType}): {c.reason}
                  </p>
                ))}
              </section>
            )}

            {(Object.keys(plan.ignored.nodeTypes).length > 0 ||
              Object.keys(plan.ignored.edgeTypes).length > 0) && (
              <p className="text-xs text-muted-foreground">
                Ignorati (non ancora gestiti da ArcheoDoc):{" "}
                {[
                  Object.keys(plan.ignored.nodeTypes).length ? `nodi ${countText(plan.ignored.nodeTypes)}` : "",
                  Object.keys(plan.ignored.edgeTypes).length ? `archi ${countText(plan.ignored.edgeTypes)}` : "",
                ]
                  .filter(Boolean)
                  .join("; ")}
                .
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isApplying}>
            Annulla
          </Button>
          <Button onClick={() => onConfirm(Array.from(checked))} disabled={checked.size === 0 || isApplying}>
            {isApplying ? "Applico..." : `Applica (${checked.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
