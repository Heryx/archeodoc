import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Link2, Plus, FileText, Loader2, ArrowUp, ArrowDown, Trash2, Download } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

type DocumentazioneTipo = "giornaliera" | "settimanale" | "fine_scavo";

type DocumentazioneRecord = {
  id: number;
  cantiereId: number;
  tipo: DocumentazioneTipo;
  titolo: string;
  dataInizio: string | null;
  dataFine: string | null;
  stato: "bozza" | "completata";
  allegatoId: number | null;
  createdAt: string;
  updatedAt: string;
  allegato?: {
    id: number;
    nomeFile: string;
    url: string;
  } | null;
};

type MapSnapshotRecord = {
  id: number;
  titolo: string;
  didascalia: string | null;
  url: string;
  createdAt: string;
};

type DocumentazioneSnapshotLink = {
  documentazioneId: number;
  snapshotId: number;
  posizione: number;
  snapshot: MapSnapshotRecord;
};

type DocumentazioneDetailResponse = {
  documentazione: DocumentazioneRecord;
  snapshots: DocumentazioneSnapshotLink[];
};

function tipoLabel(tipo: DocumentazioneTipo): string {
  if (tipo === "giornaliera") return "Giornaliera";
  if (tipo === "settimanale") return "Settimanale";
  return "Fine scavo";
}

export function DocumentazioniPage() {
  const { cid } = useParams<{ cid: string }>();
  const cantiereId = Number(cid);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tipo, setTipo] = useState<DocumentazioneTipo>("giornaliera");
  const [titolo, setTitolo] = useState("");
  const [dataInizio, setDataInizio] = useState("");
  const [dataFine, setDataFine] = useState("");

  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(null);
  const [posizione, setPosizione] = useState("");

  const docsQuery = useQuery<{ documentazioni: DocumentazioneRecord[] }>({
    queryKey: ["/api/cantieri", String(cantiereId), "documentazioni"],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cantiereId}/documentazioni`)).json(),
    enabled: Number.isFinite(cantiereId),
  });

  const snapshotsQuery = useQuery<{ snapshots: MapSnapshotRecord[] }>({
    queryKey: ["/api/cantieri", String(cantiereId), "map-snapshots"],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cantiereId}/map-snapshots`)).json(),
    enabled: Number.isFinite(cantiereId),
  });

  const detailQuery = useQuery<DocumentazioneDetailResponse>({
    queryKey: ["/api/cantieri", String(cantiereId), "documentazioni", String(selectedId)],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cantiereId}/documentazioni/${selectedId}`)).json(),
    enabled: Number.isFinite(cantiereId) && !!selectedId,
  });

  const documentazioni = docsQuery.data?.documentazioni || [];
  const allSnapshots = snapshotsQuery.data?.snapshots || [];
  const linkedSnapshots = detailQuery.data?.snapshots || [];

  useEffect(() => {
    if (!selectedId && documentazioni.length > 0) {
      setSelectedId(documentazioni[0].id);
    }
  }, [documentazioni, selectedId]);

  const availableSnapshots = useMemo(() => {
    const linked = new Set(linkedSnapshots.map((item) => item.snapshotId));
    return allSnapshots.filter((snapshot) => !linked.has(snapshot.id));
  }, [allSnapshots, linkedSnapshots]);

  useEffect(() => {
    if (!selectedSnapshotId && availableSnapshots.length > 0) {
      setSelectedSnapshotId(availableSnapshots[0].id);
    }
  }, [availableSnapshots, selectedSnapshotId]);

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", String(cantiereId), "documentazioni"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/cantieri", String(cantiereId), "documentazioni", String(selectedId)] }),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/cantieri/${cantiereId}/documentazioni`, {
      tipo,
      titolo: titolo.trim() || null,
      dataInizio: dataInizio || null,
      dataFine: dataFine || null,
    })).json(),
    onSuccess: async (data: any) => {
      await invalidateAll();
      const createdId = Number(data?.documentazione?.id);
      if (Number.isFinite(createdId)) setSelectedId(createdId);
      setTitolo("");
      toast({ title: "Documentazione creata" });
    },
    onError: (error: any) => {
      toast({ title: "Errore creazione", description: error?.message || "Operazione non riuscita", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/cantieri/${cantiereId}/documentazioni/${id}`);
    },
    onSuccess: async (_data, id) => {
      await invalidateAll();
      if (selectedId === id) setSelectedId(null);
      toast({ title: "Documentazione eliminata" });
    },
    onError: (error: any) => {
      toast({ title: "Errore eliminazione", description: error?.message || "Operazione non riuscita", variant: "destructive" });
    },
  });

  const linkMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("Seleziona una documentazione");
      if (!selectedSnapshotId) throw new Error("Seleziona uno snapshot");
      const positionValue = Number(posizione);
      return (await apiRequest("POST", `/api/documentazioni/${selectedId}/snapshots`, {
        snapshotId: selectedSnapshotId,
        posizione: Number.isFinite(positionValue) ? Math.trunc(positionValue) : undefined,
      })).json();
    },
    onSuccess: async () => {
      await invalidateAll();
      setPosizione("");
      toast({ title: "Snapshot collegato" });
    },
    onError: (error: any) => {
      toast({ title: "Errore collegamento", description: error?.message || "Operazione non riuscita", variant: "destructive" });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (snapshotId: number) => {
      if (!selectedId) throw new Error("Documentazione non selezionata");
      await apiRequest("DELETE", `/api/documentazioni/${selectedId}/snapshots/${snapshotId}`);
    },
    onSuccess: async () => {
      await invalidateAll();
      toast({ title: "Snapshot rimosso" });
    },
    onError: (error: any) => {
      toast({ title: "Errore rimozione", description: error?.message || "Operazione non riuscita", variant: "destructive" });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async ({ snapshotId, posizione }: { snapshotId: number; posizione: number }) => {
      if (!selectedId) throw new Error("Documentazione non selezionata");
      await apiRequest("PATCH", `/api/documentazioni/${selectedId}/snapshots/${snapshotId}`, { posizione });
    },
    onSuccess: async () => {
      await invalidateAll();
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("Seleziona una documentazione");
      return (await apiRequest("POST", `/api/documentazioni/${selectedId}/genera-docx`, {})).json();
    },
    onSuccess: async (data: any) => {
      await invalidateAll();
      const warnings = Number(data?.warnings?.length || 0);
      toast({
        title: "DOCX generato",
        description: warnings > 0 ? `Generato con ${warnings} avviso/i` : "Documento aggiornato",
      });
    },
    onError: (error: any) => {
      toast({ title: "Errore generazione DOCX", description: error?.message || "Operazione non riuscita", variant: "destructive" });
    },
  });

  const selectedDetail = detailQuery.data?.documentazione;

  const orderedLinks = [...linkedSnapshots].sort((a, b) => a.posizione - b.posizione);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Documentazioni</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Collega gli snapshot WebMap a documentazioni giornaliere, settimanali o fine scavo e genera un DOCX unico.
        </p>
      </div>

      <div className="grid grid-cols-[320px_1fr] gap-4 min-h-[70vh]">
        <Card className="h-full">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Nuova documentazione</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Tipo</Label>
              <select
                value={tipo}
                onChange={(event) => setTipo(event.target.value as DocumentazioneTipo)}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                <option value="giornaliera">Giornaliera</option>
                <option value="settimanale">Settimanale</option>
                <option value="fine_scavo">Fine scavo</option>
              </select>
            </div>
            <div>
              <Label>Titolo</Label>
              <Input value={titolo} onChange={(event) => setTitolo(event.target.value)} placeholder="Titolo (opzionale)" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Data inizio</Label>
                <Input type="date" value={dataInizio} onChange={(event) => setDataInizio(event.target.value)} />
              </div>
              <div>
                <Label>Data fine</Label>
                <Input type="date" value={dataFine} onChange={(event) => setDataFine(event.target.value)} />
              </div>
            </div>
            <Button
              className="w-full gap-2"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Crea bozza
            </Button>

            <div className="pt-3 border-t border-border space-y-2 max-h-[320px] overflow-y-auto">
              <div className="text-xs font-medium text-muted-foreground">Documentazioni cantiere</div>
              {documentazioni.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => setSelectedId(doc.id)}
                  className={`w-full text-left rounded border px-2 py-2 text-sm ${
                    selectedId === doc.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                  }`}
                >
                  <div className="font-medium truncate">{doc.titolo}</div>
                  <div className="text-xs text-muted-foreground flex items-center justify-between mt-0.5">
                    <span>{tipoLabel(doc.tipo)}</span>
                    <span>{doc.stato}</span>
                  </div>
                </button>
              ))}
              {!docsQuery.isLoading && documentazioni.length === 0 && (
                <div className="text-xs text-muted-foreground">Nessuna documentazione disponibile.</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Dettaglio documentazione</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedId ? (
              <div className="text-sm text-muted-foreground">Seleziona o crea una documentazione.</div>
            ) : detailQuery.isLoading ? (
              <div className="text-sm text-muted-foreground">Caricamento dettaglio...</div>
            ) : !selectedDetail ? (
              <div className="text-sm text-muted-foreground">Documentazione non trovata.</div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold">{selectedDetail.titolo}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {selectedDetail.dataInizio || "-"}
                      {selectedDetail.dataFine ? ` -> ${selectedDetail.dataFine}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{tipoLabel(selectedDetail.tipo)}</Badge>
                    <Badge variant={selectedDetail.stato === "completata" ? "default" : "outline"}>{selectedDetail.stato}</Badge>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-1"
                      onClick={() => deleteMutation.mutate(selectedDetail.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 size={12} /> Elimina
                    </Button>
                  </div>
                </div>

                <div className="rounded border border-border p-3 space-y-2">
                  <div className="text-sm font-medium">Aggiungi snapshot</div>
                  <div className="grid grid-cols-[1fr_140px_auto] gap-2 items-end">
                    <div>
                      <Label>Snapshot</Label>
                      <select
                        value={selectedSnapshotId ?? ""}
                        onChange={(event) => setSelectedSnapshotId(Number(event.target.value))}
                        className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      >
                        <option value="" disabled>Seleziona...</option>
                        {availableSnapshots.map((snapshot) => (
                          <option key={snapshot.id} value={snapshot.id}>{snapshot.titolo}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label>Posizione</Label>
                      <Input value={posizione} onChange={(event) => setPosizione(event.target.value)} placeholder="10" />
                    </div>
                    <Button className="gap-1" onClick={() => linkMutation.mutate()} disabled={!selectedSnapshotId || linkMutation.isPending}>
                      {linkMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                      Collega
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">Snapshot inclusi</div>
                  {orderedLinks.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Nessuno snapshot collegato.</div>
                  ) : (
                    <div className="space-y-2">
                      {orderedLinks.map((entry, idx) => (
                        <div key={entry.snapshotId} className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-sm truncate">{entry.snapshot.titolo}</div>
                            <div className="text-xs text-muted-foreground">
                              pos {entry.posizione} - {new Date(entry.snapshot.createdAt).toLocaleString("it-IT")}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2"
                              onClick={() => reorderMutation.mutate({ snapshotId: entry.snapshotId, posizione: entry.posizione - 10 })}
                              disabled={reorderMutation.isPending || idx === 0}
                            >
                              <ArrowUp size={12} />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2"
                              onClick={() => reorderMutation.mutate({ snapshotId: entry.snapshotId, posizione: entry.posizione + 10 })}
                              disabled={reorderMutation.isPending || idx === orderedLinks.length - 1}
                            >
                              <ArrowDown size={12} />
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-7 px-2"
                              onClick={() => unlinkMutation.mutate(entry.snapshotId)}
                              disabled={unlinkMutation.isPending}
                            >
                              <Trash2 size={12} />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded border border-border p-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">Export documentazione</div>
                    <div className="text-xs text-muted-foreground">Genera il DOCX completo con gli snapshot nell'ordine impostato.</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedDetail.allegato?.url && (
                      <a
                        href={selectedDetail.allegato.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs rounded border border-border px-2 py-1 hover:bg-muted"
                      >
                        <Download size={12} />
                        Apri DOCX
                      </a>
                    )}
                    <Button className="gap-2" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending || orderedLinks.length === 0}>
                      {generateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                      Genera DOCX
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
