import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Layers3, Plus, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type PeriodoRow = {
  id: number;
  nome: string;
  descrizione: string | null;
  ordine: number;
  startTime: number | null;
  endTime: number | null;
  usCount: number;
};

type PeriodiData = { periodi: PeriodoRow[]; unregistered: { nome: string; count: number }[] };

type Props = { open: boolean; onClose: () => void; cid: string };

function PeriodoRowEditor({
  row,
  first,
  last,
  onPatch,
  onMove,
  onDelete,
}: {
  row: PeriodoRow;
  first: boolean;
  last: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [nome, setNome] = useState(row.nome);
  const [descrizione, setDescrizione] = useState(row.descrizione ?? "");
  const [start, setStart] = useState(row.startTime?.toString() ?? "");
  const [end, setEnd] = useState(row.endTime?.toString() ?? "");

  const commitText = () => {
    if (nome.trim() && nome.trim() !== row.nome) onPatch({ nome: nome.trim() });
    else setNome(row.nome);
    if (descrizione.trim() !== (row.descrizione ?? "")) onPatch({ descrizione });
  };
  const commitYear = (key: "startTime" | "endTime", value: string, current: number | null) => {
    const next = value.trim() === "" ? null : Number(value);
    if (next !== null && !Number.isFinite(next)) return;
    if (next !== current) onPatch({ [key]: next });
  };

  return (
    <div className="grid grid-cols-[auto_1fr_1.2fr_5.5rem_5.5rem_auto] items-center gap-2">
      <div className="flex flex-col">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          disabled={first}
          onClick={() => onMove(-1)}
          aria-label="Sposta verso il più recente"
        >
          <ArrowUp size={14} />
        </button>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          disabled={last}
          onClick={() => onMove(1)}
          aria-label="Sposta verso il più antico"
        >
          <ArrowDown size={14} />
        </button>
      </div>
      <Input value={nome} onChange={(e) => setNome(e.target.value)} onBlur={commitText} className="h-8" />
      <Input
        value={descrizione}
        placeholder="Descrizione (es. età romana)"
        onChange={(e) => setDescrizione(e.target.value)}
        onBlur={commitText}
        className="h-8"
      />
      <Input
        value={start}
        inputMode="numeric"
        placeholder="dal"
        title="Anno iniziale (negativo = a.C.)"
        onChange={(e) => setStart(e.target.value)}
        onBlur={() => commitYear("startTime", start, row.startTime)}
        className="h-8"
      />
      <Input
        value={end}
        inputMode="numeric"
        placeholder="al"
        title="Anno finale (negativo = a.C.)"
        onChange={(e) => setEnd(e.target.value)}
        onBlur={() => commitYear("endTime", end, row.endTime)}
        className="h-8"
      />
      <div className="flex items-center gap-2">
        <span className="w-12 text-right text-xs text-muted-foreground" title="US con questo periodo">
          {row.usCount} US
        </span>
        <button
          type="button"
          className="text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          aria-label={`Elimina ${row.nome}`}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export function PeriodiDialog({ open, onClose, cid }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const base = `/api/cantieri/${cid}/periodi`;
  const [newNome, setNewNome] = useState("");
  const [assignNome, setAssignNome] = useState("");
  const [assignCodes, setAssignCodes] = useState("");

  const { data, isLoading } = useQuery<PeriodiData>({
    queryKey: ["/api/cantieri", cid, "periodi"],
    queryFn: async () => (await apiRequest("GET", base)).json(),
    enabled: open && !!cid,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "periodi"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "us"] });
  };
  const fail = (title: string) => (error: any) =>
    toast({ title, description: error?.message || "Operazione non riuscita", variant: "destructive" });

  const run = useMutation({
    mutationFn: async (job: () => Promise<unknown>) => job(),
    onSuccess: refresh,
    onError: fail("Operazione sui periodi non riuscita"),
  });

  // Elenco mostrato dal più recente (in alto) al più antico, come nella matrix.
  const rows = [...(data?.periodi ?? [])].sort((a, b) => b.ordine - a.ordine || b.id - a.id);

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    // il server vuole l'ordine dal più antico al più recente
    run.mutate(() => apiRequest("POST", `${base}/reorder`, { ids: next.map((r) => r.id).reverse() }));
  };

  const add = () => {
    const nome = newNome.trim();
    if (!nome) return;
    run.mutate(async () => {
      await apiRequest("POST", base, { nome });
      setNewNome("");
    });
  };

  const assign = () => {
    run.mutate(async () => {
      const res = await apiRequest("POST", `${base}/assign`, { nome: assignNome, codes: assignCodes });
      const r = await res.json();
      toast({
        title: `${r.updated} US assegnate a “${assignNome.trim()}”`,
        description: r.notFound?.length ? `Non trovate: ${r.notFound.join(", ")}` : undefined,
      });
      setAssignCodes("");
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers3 size={16} /> Periodi del cantiere
          </DialogTitle>
          <DialogDescription>
            Dal più recente (in alto) al più antico. Le date sono facoltative: con le date EM Studio ordina le
            epoche da solo. Rinominare un periodo lo aggiorna anche nelle US.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto py-1">
          {data && data.unregistered.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <span>
                {data.unregistered.length} nomi scritti nelle US ma non nel registro:{" "}
                {data.unregistered
                  .slice(0, 6)
                  .map((p) => `${p.nome} (${p.count})`)
                  .join(", ")}
                {data.unregistered.length > 6 ? "…" : ""}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={run.isPending}
                onClick={() => run.mutate(() => apiRequest("POST", `${base}/from-us`))}
              >
                Registrali (ordine dalla stratigrafia)
              </Button>
            </div>
          )}

          {isLoading ? (
            <div className="h-24 animate-pulse rounded-md bg-muted" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nessun periodo. Aggiungine uno qui sotto, oppure assegna un periodo a un gruppo di US.
            </p>
          ) : (
            <div className="space-y-1.5">
              <div className="grid grid-cols-[auto_1fr_1.2fr_5.5rem_5.5rem_auto] gap-2 px-0.5 text-xs text-muted-foreground">
                <span className="w-3.5" />
                <span>Nome</span>
                <span>Descrizione</span>
                <span>Dal (anno)</span>
                <span>Al (anno)</span>
                <span className="w-[4.75rem]" />
              </div>
              {rows.map((row, index) => (
                <PeriodoRowEditor
                  key={`${row.id}-${row.nome}-${row.startTime}-${row.endTime}-${row.descrizione}`}
                  row={row}
                  first={index === 0}
                  last={index === rows.length - 1}
                  onPatch={(patch) => run.mutate(() => apiRequest("PATCH", `/api/periodi/${row.id}`, patch))}
                  onMove={(dir) => move(index, dir)}
                  onDelete={() => run.mutate(() => apiRequest("DELETE", `/api/periodi/${row.id}`))}
                />
              ))}
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-muted-foreground"
                disabled={run.isPending}
                onClick={() => run.mutate(() => apiRequest("POST", `${base}/reorder`, { auto: true }))}
              >
                <Wand2 size={13} /> Ordina dalla stratigrafia
              </Button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Input
              value={newNome}
              placeholder="Nuovo periodo (es. Periodo II)"
              onChange={(e) => setNewNome(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              className="h-8"
            />
            <Button size="sm" variant="outline" className="gap-1.5" onClick={add} disabled={!newNome.trim() || run.isPending}>
              <Plus size={14} /> Aggiungi
            </Button>
          </div>

          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-sm font-semibold">Assegna un periodo a più US</p>
            <div className="grid grid-cols-[1fr_1.5fr_auto] items-center gap-2">
              <Input
                list="periodi-assign-list"
                value={assignNome}
                placeholder="Periodo"
                onChange={(e) => setAssignNome(e.target.value)}
                className="h-8"
              />
              <datalist id="periodi-assign-list">
                {rows.map((r) => (
                  <option key={r.id} value={r.nome} />
                ))}
              </datalist>
              <Input
                value={assignCodes}
                placeholder="US: 100-118, 125, 130"
                onChange={(e) => setAssignCodes(e.target.value)}
                className="h-8"
              />
              <Button
                size="sm"
                disabled={!assignNome.trim() || !assignCodes.trim() || run.isPending}
                onClick={assign}
              >
                Assegna
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Imposta il periodo iniziale delle US indicate. Gli intervalli valgono per i codici numerici.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
