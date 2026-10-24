import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Loader2, Upload, X } from "lucide-react";
import { buildProjectUrl } from "@/lib/project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

type Tipo = "libero" | "giornaliera" | "settimanale" | "mensile" | "fine_scavo";

const TIPI: { value: Tipo; label: string }[] = [
  { value: "libero", label: "Libero" },
  { value: "giornaliera", label: "Giornaliera" },
  { value: "settimanale", label: "Settimanale" },
  { value: "mensile", label: "Mensile" },
  { value: "fine_scavo", label: "Finale (tutto lo scavo)" },
];

type Preview = {
  fileName: string;
  titolo: string;
  tipo: Tipo;
  dataInizio: string | null;
  dataFine: string | null;
  fonteDate: string | null;
  stats: { paragrafi: number; titoli: number; tabelle: number; immagini: number; parole: number };
  usCollegate: { id: number; label: string; occorrenze: number }[];
  usNonTrovate: { testo: string; occorrenze: number }[];
  avvisi: string[];
  anteprimaTesto: string;
};

type Item = {
  key: string;
  file: File;
  status: "loading" | "ready" | "error" | "saving" | "saved";
  error?: string;
  preview?: Preview;
  titolo: string;
  tipo: Tipo;
  dataInizio: string;
  dataFine: string;
  escluse: number[];
  include: boolean;
  open: boolean;
  savedId?: number;
};

const selectCls = "mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm";

async function postFile(cantiereId: number, file: File, confirmFields?: object) {
  const fd = new FormData();
  fd.append("file", file);
  if (confirmFields) {
    fd.append("confirm", "true");
    fd.append("fields", JSON.stringify(confirmFields));
  } else {
    fd.append("fields", "{}");
  }
  const res = await fetch(buildProjectUrl(`/api/cantieri/${cantiereId}/documentazioni/importa-docx`), { method: "POST", body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Errore del server");
  return data;
}

export function RelazioneImportDialog({ open, onOpenChange, cantiereId, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cantiereId: number;
  onCreated: (id: number | null) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [saving, setSaving] = useState(false);

  const patch = (key: string, p: Partial<Item>) => setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...p } : it)));

  function close(v: boolean) {
    if (saving) return;
    if (!v) {
      setItems([]);
      if (fileRef.current) fileRef.current.value = "";
    }
    onOpenChange(v);
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const added: Item[] = Array.from(files).map((file, i) => ({
      key: `${Date.now()}-${i}-${file.name}`,
      file,
      status: "loading",
      titolo: "",
      tipo: "libero",
      dataInizio: "",
      dataFine: "",
      escluse: [],
      include: true,
      open: files.length === 1,
    }));
    setItems((prev) => [...prev, ...added]);
    if (fileRef.current) fileRef.current.value = "";

    for (const it of added) {
      try {
        const { preview } = (await postFile(cantiereId, it.file)) as { preview: Preview };
        patch(it.key, {
          status: "ready",
          preview,
          titolo: preview.titolo,
          tipo: preview.tipo,
          dataInizio: preview.dataInizio || "",
          dataFine: preview.dataFine || "",
        });
      } catch (e: any) {
        patch(it.key, { status: "error", error: e?.message || "Errore", include: false });
      }
    }
  }

  async function handleSave() {
    const todo = items.filter((it) => it.include && it.status === "ready");
    if (!todo.length) return;
    setSaving(true);
    let ok = 0;
    let lastId: number | null = null;
    for (const it of todo) {
      patch(it.key, { status: "saving" });
      try {
        const data = await postFile(cantiereId, it.file, {
          titolo: it.titolo,
          tipo: it.tipo,
          dataInizio: it.dataInizio || null,
          dataFine: it.dataFine || null,
          escludiUs: it.escluse,
        });
        lastId = Number(data?.documentazione?.id) || null;
        patch(it.key, { status: "saved", savedId: lastId ?? undefined });
        ok++;
      } catch (e: any) {
        patch(it.key, { status: "error", error: e?.message || "Errore", include: false });
      }
    }
    setSaving(false);
    await queryClient.invalidateQueries({ queryKey: ["/api/cantieri", String(cantiereId), "documentazioni"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/cantieri", String(cantiereId), "relazioni-grafo"] });
    if (ok) {
      toast({ title: ok === 1 ? "Relazione importata" : `${ok} relazioni importate`, description: "Sono in bozza: aprili per rivedere il testo e i collegamenti alle US." });
      const remaining = items.filter((it) => it.status === "error" || (it.status === "ready" && !it.include)).length;
      if (!remaining) {
        close(false);
        onCreated(ok === 1 ? lastId : null);
      }
    }
  }

  const ready = items.filter((it) => it.include && it.status === "ready");
  const loading = items.some((it) => it.status === "loading");

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Importa relazioni da Word</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          Carica uno o più file .docx (relazioni giornaliere, settimanali, mensili…). Il testo diventa un documento modificabile; le US citate (es. «US 101», «UUSS 102 e 103», «T.12») vengono collegate alle schede del cantiere. Prima di salvare puoi controllare tutto.
        </p>

        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".docx" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
          <Button variant="outline" className="gap-2" onClick={() => fileRef.current?.click()} disabled={saving}>
            <Upload size={14} /> {items.length ? "Aggiungi altri file" : "Scegli file Word"}
          </Button>
          {loading && <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 size={13} className="animate-spin" /> Analisi in corso…</span>}
        </div>

        <div className="space-y-2">
          {items.map((it) => (
            <ItemCard key={it.key} it={it} disabled={saving}
              onPatch={(p) => patch(it.key, p)}
              onRemove={() => setItems((prev) => prev.filter((x) => x.key !== it.key))} />
          ))}
        </div>

        {items.length > 0 && (
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs text-muted-foreground">I documenti vengono creati in bozza.</span>
            <Button className="gap-2" onClick={handleSave} disabled={saving || loading || ready.length === 0}>
              {saving && <Loader2 size={14} className="animate-spin" />}
              {ready.length > 1 ? `Importa ${ready.length} relazioni` : "Importa relazione"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ItemCard({ it, disabled, onPatch, onRemove }: {
  it: Item;
  disabled: boolean;
  onPatch: (p: Partial<Item>) => void;
  onRemove: () => void;
}) {
  const p = it.preview;
  const busy = it.status === "loading" || it.status === "saving";
  const toggleUs = (id: number) =>
    onPatch({ escluse: it.escluse.includes(id) ? it.escluse.filter((x) => x !== id) : [...it.escluse, id] });

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center gap-2 px-3 py-2">
        {it.status === "ready" && (
          <input type="checkbox" checked={it.include} disabled={disabled} onChange={(e) => onPatch({ include: e.target.checked })} title="Includi nell'importazione" />
        )}
        {it.status === "ready" && (
          <button type="button" onClick={() => onPatch({ open: !it.open })} className="text-muted-foreground">
            {it.open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        )}
        {busy && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
        {it.status === "saved" && <CheckCircle2 size={15} className="text-green-600" />}
        {it.status === "error" && <AlertCircle size={15} className="text-destructive" />}
        <span className="text-sm font-medium truncate flex-1">{it.file.name}</span>
        {p && it.status !== "saved" && (
          <span className="text-xs text-muted-foreground shrink-0">
            {p.usCollegate.length} US collegate · {p.stats.parole} parole
          </span>
        )}
        {it.status !== "saved" && !busy && (
          <button type="button" onClick={onRemove} disabled={disabled} className="text-muted-foreground hover:text-destructive" title="Togli dall'elenco"><X size={14} /></button>
        )}
      </div>

      {it.status === "error" && <p className="px-3 pb-2 text-xs text-destructive">{it.error}</p>}

      {it.status === "ready" && p && it.open && (
        <div className="border-t border-border px-3 py-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Titolo</Label>
              <Input value={it.titolo} onChange={(e) => onPatch({ titolo: e.target.value })} />
            </div>
            <div>
              <Label>Tipo</Label>
              <select value={it.tipo} onChange={(e) => onPatch({ tipo: e.target.value as Tipo })} className={selectCls}>
                {TIPI.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Dal</Label>
                <Input type="date" value={it.dataInizio} onChange={(e) => onPatch({ dataInizio: e.target.value })} />
              </div>
              <div>
                <Label>Al</Label>
                <Input type="date" value={it.dataFine} onChange={(e) => onPatch({ dataFine: e.target.value })} />
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-1">
            {p.fonteDate ? `Periodo ricavato da: ${p.fonteDate}. Controllalo.` : "Nel file non ho trovato date: indicale se servono."}
          </p>

          <div className="flex flex-wrap gap-1.5 text-xs">
            <Badge variant="outline">{p.stats.titoli} titoli</Badge>
            <Badge variant="outline">{p.stats.paragrafi} paragrafi</Badge>
            <Badge variant="outline">{p.stats.tabelle} tabelle</Badge>
            <Badge variant="outline">{p.stats.immagini} immagini</Badge>
          </div>

          {p.avvisi.map((a, i) => (
            <p key={i} className="rounded bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">{a}</p>
          ))}

          <div>
            <Label>US collegate ({p.usCollegate.length})</Label>
            {p.usCollegate.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">Nessuna US citata nel testo corrisponde alle schede del cantiere.</p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {p.usCollegate.map((u) => {
                  const off = it.escluse.includes(u.id);
                  return (
                    <button key={u.id} type="button" onClick={() => toggleUs(u.id)} disabled={disabled}
                      title={off ? "Non verrà collegata: clicca per ripristinare" : "Clicca per non collegarla"}
                      className={`rounded-full border px-2 py-0.5 text-xs ${off ? "border-border text-muted-foreground line-through" : "border-primary/50 bg-primary/10 text-primary"}`}>
                      {u.label}{u.occorrenze > 1 ? ` ×${u.occorrenze}` : ""}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {p.usNonTrovate.length > 0 && (
            <div>
              <Label>Citate ma non presenti nel cantiere ({p.usNonTrovate.length})</Label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {p.usNonTrovate.map((u) => (
                  <span key={u.testo} className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground">
                    {u.testo}{u.occorrenze > 1 ? ` ×${u.occorrenze}` : ""}
                  </span>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Restano testo semplice. Se importi quelle schede più tardi, potrai collegarle dall'editor con «[[».</p>
            </div>
          )}

          <div>
            <Label>Inizio del testo</Label>
            <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs leading-relaxed font-sans">{p.anteprimaTesto || "(vuoto)"}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
