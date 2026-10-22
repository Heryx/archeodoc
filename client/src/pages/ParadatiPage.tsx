import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { AlertTriangle, Info, Network, Pencil, Plus, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

type LinkField = "sopraA" | "sottoA" | "fonti" | "estrattori" | "appartieneA" | "provenienza";

type EmNode = {
  id: number;
  uid: string;
  nodeType: string;
  nome: string | null;
  descrizione: string | null;
  dati: Record<string, unknown>;
  links: Partial<Record<LinkField, string[]>>;
};

type EmType = {
  type: string;
  label: string;
  fields: { field: LinkField; label: string; accepts: { us: boolean; em: string[] } }[];
};

type EmData = { nodes: EmNode[]; tipi: EmType[] };

type EmIssue = { livello: "error" | "warning" | "info"; nodo?: string; messaggio: string };

const GROUPS = [
  { id: "virtuali", label: "Unità virtuali", types: ["USVs", "USVn", "VSF"], hint: "Ricostruzioni che entrano nella sequenza della matrix." },
  { id: "documenti", label: "Documenti", types: ["document"], hint: "Fonti: rilievi, fotografie, pubblicazioni, archivi." },
  { id: "estrattori", label: "Estrattori", types: ["extractor"], hint: "Ciò che si estrae da una fonte per sostenere un'affermazione." },
  { id: "combinatori", label: "Combinatori", types: ["combiner"], hint: "Mettono insieme più estrattori." },
  { id: "proprieta", label: "Proprietà", types: ["property"], hint: "Caratteristiche di una US, di un'unità virtuale o di un documento, con la loro provenienza." },
] as const;

const PROPERTY_TYPES = ["material", "shape", "height", "width", "colour", "technique", "function", "dating"];

const splitList = (value: string) =>
  value
    .split(/[;,\n]+/)
    .map((v) => v.trim())
    .filter(Boolean);

function EmNodeDialog({
  open,
  onClose,
  cid,
  tipi,
  types,
  node,
  usCodes,
  allNodes,
  periodi,
}: {
  open: boolean;
  onClose: () => void;
  cid: string;
  tipi: EmType[];
  types: readonly string[];
  node: EmNode | null;
  usCodes: string[];
  allNodes: EmNode[];
  periodi: string[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [nodeType, setNodeType] = useState<string>(node?.nodeType ?? types[0]);
  const [uid, setUid] = useState(node?.uid ?? "");
  const [nome, setNome] = useState(node?.nome ?? "");
  const [descrizione, setDescrizione] = useState(node?.descrizione ?? "");
  const [url, setUrl] = useState(String(node?.dati?.url ?? ""));
  const [periodo, setPeriodo] = useState(String(node?.dati?.periodo ?? ""));
  const [links, setLinks] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const [field, values] of Object.entries(node?.links ?? {})) out[field] = (values ?? []).join(", ");
    return out;
  });

  const tipo = tipi.find((t) => t.type === nodeType);
  const isProperty = nodeType === "property";
  const isVirtual = ["USVs", "USVn", "VSF"].includes(nodeType);
  const isDocument = nodeType === "document";

  const save = useMutation({
    mutationFn: async () => {
      const dati: Record<string, unknown> = { ...(node?.dati ?? {}) };
      if (isDocument) dati.url = url.trim() || undefined;
      if (isVirtual) dati.periodo = periodo.trim() || undefined;
      if (isProperty) dati.property_type = nome.trim() || undefined;
      const body = {
        nodeType,
        uid: uid.trim() || undefined,
        nome: nome.trim() || null,
        descrizione: descrizione.trim() || null,
        dati,
        links: Object.fromEntries((tipo?.fields ?? []).map((f) => [f.field, splitList(links[f.field] ?? "")])),
      };
      const res = node
        ? await apiRequest("PUT", `/api/em/nodi/${node.id}`, body)
        : await apiRequest("POST", `/api/cantieri/${cid}/em/nodi`, body);
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "em", "nodi"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "em", "controlli"] });
      onClose();
    },
    onError: (error: any) =>
      toast({ title: "Salvataggio non riuscito", description: error?.message, variant: "destructive" }),
  });

  const suggestionsFor = (accepts: { us: boolean; em: string[] }) => [
    ...(accepts.us ? usCodes : []),
    ...allNodes.filter((n) => accepts.em.includes(n.nodeType) && n.id !== node?.id).map((n) => n.uid),
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{node ? `Modifica ${node.uid}` : "Nuovo nodo"}</DialogTitle>
          <DialogDescription>{tipo?.label}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto py-1">
          {!node && types.length > 1 && (
            <div>
              <Label>Tipo</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={nodeType}
                onChange={(e) => setNodeType(e.target.value)}
              >
                {types.map((t) => (
                  <option key={t} value={t}>
                    {tipi.find((x) => x.type === t)?.label ?? t}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Nome del nodo</Label>
              <Input value={uid} placeholder="Se vuoto, proposto in automatico" onChange={(e) => setUid(e.target.value)} />
            </div>
            {isProperty ? (
              <div>
                <Label>Tipo di proprietà</Label>
                <Input list="em-property-types" value={nome} onChange={(e) => setNome(e.target.value)} />
                <datalist id="em-property-types">
                  {PROPERTY_TYPES.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>
            ) : (
              <div>
                <Label>Titolo breve</Label>
                <Input value={nome} onChange={(e) => setNome(e.target.value)} />
              </div>
            )}
          </div>

          <div>
            <Label>{isProperty ? "Valore" : "Descrizione"}</Label>
            <Textarea value={descrizione} rows={isProperty ? 2 : 3} onChange={(e) => setDescrizione(e.target.value)} />
          </div>

          {isDocument && (
            <div>
              <Label>Collegamento alla fonte (URL o riferimento)</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
          )}

          {isVirtual && (
            <div>
              <Label>Periodo / epoca</Label>
              <Input list="em-periodi" value={periodo} onChange={(e) => setPeriodo(e.target.value)} />
              <datalist id="em-periodi">
                {periodi.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
          )}

          {(tipo?.fields ?? []).map((f) => (
            <div key={f.field}>
              <Label>{f.label}</Label>
              <Input
                list={`em-list-${f.field}`}
                placeholder="Codici US o nomi di nodi, separati da virgola"
                value={links[f.field] ?? ""}
                onChange={(e) => setLinks((prev) => ({ ...prev, [f.field]: e.target.value }))}
              />
              <datalist id={`em-list-${f.field}`}>
                {suggestionsFor(f.accepts).map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Annulla
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Salvo..." : "Salva"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ParadatiPage() {
  const { cid } = useParams<{ cid: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [group, setGroup] = useState<(typeof GROUPS)[number]["id"]>("virtuali");
  const [editing, setEditing] = useState<{ node: EmNode | null } | null>(null);

  const { data, isLoading } = useQuery<EmData>({
    queryKey: ["/api/cantieri", cid, "em", "nodi"],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/em/nodi`)).json(),
    enabled: !!cid,
  });
  const { data: usList = [] } = useQuery<any[]>({
    queryKey: ["/api/cantieri", cid, "us", "em-page"],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/us`)).json(),
    enabled: !!cid,
  });
  const { data: periodiData } = useQuery<{ periodi: { nome: string }[] }>({
    queryKey: ["/api/cantieri", cid, "periodi"],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/periodi`)).json(),
    enabled: !!cid,
  });

  const { data: controlli } = useQuery<{ issues: EmIssue[] }>({
    queryKey: ["/api/cantieri", cid, "em", "controlli"],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/em/controlli`)).json(),
    enabled: !!cid,
  });
  const issues = controlli?.issues ?? [];
  const [showInfo, setShowInfo] = useState(false);
  const visibleIssues = issues.filter((i) => showInfo || i.livello !== "info");
  const infoCount = issues.filter((i) => i.livello === "info").length;

  const usCodes = useMemo(() => usList.map((u) => String(u.codiceUS)).filter(Boolean), [usList]);
  const current = GROUPS.find((g) => g.id === group)!;
  const nodes = (data?.nodes ?? []).filter((n) => (current.types as readonly string[]).includes(n.nodeType));
  const count = (types: readonly string[]) => (data?.nodes ?? []).filter((n) => types.includes(n.nodeType)).length;

  const remove = useMutation({
    mutationFn: async (node: EmNode) => apiRequest("DELETE", `/api/em/nodi/${node.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "em", "nodi"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/cantieri", cid, "em", "controlli"] });
    },
    onError: (error: any) => toast({ title: "Eliminazione non riuscita", description: error?.message, variant: "destructive" }),
  });

  const typeLabel = (type: string) => data?.tipi.find((t) => t.type === type)?.label ?? type;
  const linkSummary = (node: EmNode) =>
    (data?.tipi.find((t) => t.type === node.nodeType)?.fields ?? [])
      .map((f) => ({ label: f.label, values: node.links[f.field] ?? [] }))
      .filter((l) => l.values.length > 0);

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Network size={22} className="text-primary" /> Paradati e unità virtuali
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Unità virtuali e paradati: documenti, estrattori, combinatori e proprietà. Le unità virtuali compaiono nella
          Harris Matrix.
        </p>
      </div>

      {issues.length > 0 && (
        <section className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">
              Controlli ({issues.filter((i) => i.livello !== "info").length})
            </h2>
            {infoCount > 0 && (
              <button
                type="button"
                className="text-xs text-muted-foreground underline"
                onClick={() => setShowInfo((v) => !v)}
              >
                {showInfo ? "Nascondi le informazioni" : `Mostra anche ${infoCount} informazioni`}
              </button>
            )}
          </div>
          {visibleIssues.map((issue, i) => (
            <p key={i} className="flex items-start gap-2 text-sm">
              {issue.livello === "info" ? (
                <Info size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
              ) : (
                <AlertTriangle
                  size={14}
                  className={`mt-0.5 shrink-0 ${issue.livello === "error" ? "text-destructive" : "text-amber-600"}`}
                />
              )}
              <span>{issue.messaggio}</span>
            </p>
          ))}
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {GROUPS.map((g) => (
          <Button key={g.id} size="sm" variant={group === g.id ? "default" : "outline"} onClick={() => setGroup(g.id)}>
            {g.label} ({count(g.types)})
          </Button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{current.hint}</p>
        <Button className="gap-2 shrink-0" onClick={() => setEditing({ node: null })}>
          <Plus size={15} /> Nuovo
        </Button>
      </div>

      {isLoading ? (
        <div className="h-32 rounded-lg bg-muted animate-pulse" />
      ) : nodes.length === 0 ? (
        <div className="text-center py-14 border-2 border-dashed border-border rounded-xl text-muted-foreground">
          Nessun elemento. Crea il primo con «Nuovo».
        </div>
      ) : (
        <div className="space-y-2">
          {nodes.map((node) => (
            <div key={node.id} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold">{node.uid}</span>
                    <Badge variant="secondary" className="text-xs font-normal">{typeLabel(node.nodeType)}</Badge>
                    {node.nome && <span className="text-sm">{node.nome}</span>}
                    {typeof node.dati?.periodo === "string" && node.dati.periodo && (
                      <Badge variant="outline" className="text-xs font-normal">{String(node.dati.periodo)}</Badge>
                    )}
                  </div>
                  {node.descrizione && <p className="text-sm text-muted-foreground">{node.descrizione}</p>}
                  {linkSummary(node).map((l) => (
                    <p key={l.label} className="text-xs text-muted-foreground">
                      <span className="font-medium">{l.label}:</span> {l.values.join(", ")}
                    </p>
                  ))}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="icon" variant="ghost" onClick={() => setEditing({ node })} aria-label={`Modifica ${node.uid}`}>
                    <Pencil size={14} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      if (window.confirm(`Eliminare ${node.uid} e i suoi collegamenti?`)) remove.mutate(node);
                    }}
                    aria-label={`Elimina ${node.uid}`}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && data && cid && (
        <EmNodeDialog
          key={editing.node?.id ?? `new-${group}`}
          open
          onClose={() => setEditing(null)}
          cid={cid}
          tipi={data.tipi}
          types={current.types}
          node={editing.node}
          usCodes={usCodes}
          allNodes={data.nodes}
          periodi={(periodiData?.periodi ?? []).map((p) => p.nome)}
        />
      )}
    </div>
  );
}
