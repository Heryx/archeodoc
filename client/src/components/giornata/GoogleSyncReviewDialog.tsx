import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  googleFieldLabel,
  type GoogleSyncDecisionState,
  type GoogleSyncPreview,
  type GoogleSyncPreviewItem,
} from "@/components/giornata/types";

type GoogleSyncReviewDialogProps = {
  open: boolean;
  preview: GoogleSyncPreview | null;
  decisions: Record<string, GoogleSyncDecisionState>;
  applyPending: boolean;
  onOpenChange: (open: boolean) => void;
  onActionChange: (itemKey: string, action: "confirm" | "skip" | "edit") => void;
  onTopFieldOverride: (
    itemKey: string,
    field: Exclude<keyof GoogleSyncPreviewItem["proposed"], "schedaData">,
    value: string,
  ) => void;
  onSchedaOverride: (itemKey: string, fieldKey: string, value: string) => void;
  onApply: () => void;
};

function resolvedTopField(
  item: GoogleSyncPreviewItem,
  decisions: Record<string, GoogleSyncDecisionState>,
  field: Exclude<keyof GoogleSyncPreviewItem["proposed"], "schedaData">,
): string {
  const decision = decisions[item.key];
  const override = decision?.overrides?.[field];
  if (override !== undefined && override !== null) return String(override);
  if (override === null) return "";
  return item.proposed[field] || "";
}

function resolvedSchedaField(
  item: GoogleSyncPreviewItem,
  decisions: Record<string, GoogleSyncDecisionState>,
  field: string,
): string {
  const decision = decisions[item.key];
  const override = decision?.overrides?.schedaData?.[field];
  if (override !== undefined && override !== null) return String(override);
  if (override === null) return "";
  return item.proposed.schedaData[field] || "";
}

export function GoogleSyncReviewDialog({
  open,
  preview,
  decisions,
  applyPending,
  onOpenChange,
  onActionChange,
  onTopFieldOverride,
  onSchedaOverride,
  onApply,
}: GoogleSyncReviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Revisione sincronizzazione Google</DialogTitle>
        </DialogHeader>

        {!preview ? (
          <p className="text-sm text-muted-foreground">Nessuna anteprima disponibile.</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
              <p className="font-medium">Anteprima</p>
              <p className="text-muted-foreground mt-1">
                Giornate: {preview.giornate} · US rilevate: {preview.usTotali}
              </p>
              {preview.warnings.length > 0 && (
                <ul className="mt-2 text-amber-700 text-xs space-y-1">
                  {preview.warnings.map((w, idx) => (
                    <li key={`${w}-${idx}`}>- {w}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-3">
              {preview.items.map((item) => {
                const decision = decisions[item.key] || { action: "confirm" as const, overrides: {} };
                const deterministicFields = Object.entries(item.deterministic).filter(([, value]) => !!String(value || "").trim());
                const aiFields = Object.entries(item.ai).filter(([, value]) => !!String(value || "").trim());
                const unresolvedMissing = item.missingFields.filter((field) => {
                  const aiValue = item.ai[field];
                  const detValue = item.deterministic[field];
                  const topValue = (item.proposed as Record<string, unknown>)[field];
                  const schedaValue = item.proposed.schedaData[field];
                  return !aiValue && !detValue && !topValue && !schedaValue;
                });
                const schedaKeys = Array.from(
                  new Set([
                    ...Object.keys(item.proposed.schedaData || {}),
                    ...Object.keys(decision.overrides.schedaData || {}),
                  ]),
                ).sort();

                return (
                  <Card key={item.key}>
                    <CardContent className="py-4 px-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            {item.codiceUS} · giornata {item.giornataData}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Stato: {item.status === "new" ? "NUOVA" : "ESISTENTE"}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <Select
                            value={decision.action}
                            onValueChange={(value) =>
                              onActionChange(item.key, value as "confirm" | "skip" | "edit")
                            }
                          >
                            <SelectTrigger className="w-40">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="confirm">Conferma</SelectItem>
                              <SelectItem value="edit">Modifica</SelectItem>
                              <SelectItem value="skip">Salta</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid md:grid-cols-2 gap-3 text-sm">
                        <div className="rounded-md border border-border p-2">
                          <p className="text-xs font-medium text-muted-foreground mb-1">Estratti dal testo (deterministico)</p>
                          {deterministicFields.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Nessun campo strutturato trovato.</p>
                          ) : (
                            <div className="space-y-1">
                              {deterministicFields.map(([key, value]) => (
                                <p key={`${item.key}-det-${key}`} className="text-xs">
                                  <span className="font-medium">{googleFieldLabel(key)}:</span> {String(value)}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="rounded-md border border-border p-2">
                          <p className="text-xs font-medium text-muted-foreground mb-1">Inferiti da AI</p>
                          {aiFields.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Nessuna inferenza necessaria.</p>
                          ) : (
                            <div className="space-y-1">
                              {aiFields.map(([key, value]) => (
                                <p key={`${item.key}-ai-${key}`} className="text-xs">
                                  <span className="font-medium">{googleFieldLabel(key)}:</span> {String(value)}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {unresolvedMissing.length > 0 && (
                        <p className="text-xs text-amber-700">
                          Campi non dedotti: {unresolvedMissing.map((field) => googleFieldLabel(field)).join(", ")}
                        </p>
                      )}

                      {decision.action === "edit" && (
                        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-3">
                          <p className="text-sm font-medium">Modifica proposta prima del salvataggio</p>

                          {(
                            [
                              "tipo",
                              "definizione",
                              "descrizione",
                              "interpretazione",
                              "quota",
                              "settore",
                              "coperto_da",
                              "copre",
                              "si_lega_a",
                              "uguale_a",
                              "periodoIniziale",
                              "periodoFinale",
                              "materialiRinvenuti",
                              "campioni",
                            ] as const
                          ).map((field) => (
                            <div key={`${item.key}-edit-${field}`}>
                              <Label>{googleFieldLabel(field)}</Label>
                              {field === "descrizione" || field === "interpretazione" || field === "materialiRinvenuti" || field === "campioni" ? (
                                <Textarea
                                  rows={2}
                                  value={resolvedTopField(item, decisions, field)}
                                  onChange={(event) => onTopFieldOverride(item.key, field, event.target.value)}
                                />
                              ) : (
                                <Input
                                  value={resolvedTopField(item, decisions, field)}
                                  onChange={(event) => onTopFieldOverride(item.key, field, event.target.value)}
                                />
                              )}
                            </div>
                          ))}

                          {schedaKeys.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                Campi scheda extra
                              </p>
                              {schedaKeys.map((fieldKey) => (
                                <div key={`${item.key}-edit-scheda-${fieldKey}`}>
                                  <Label>{googleFieldLabel(fieldKey)}</Label>
                                  <Input
                                    value={resolvedSchedaField(item, decisions, fieldKey)}
                                    onChange={(event) => onSchedaOverride(item.key, fieldKey, event.target.value)}
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applyPending}>
                Chiudi
              </Button>
              <Button onClick={onApply} disabled={!preview || applyPending}>
                {applyPending ? "Applicazione..." : "Applica sincronizzazione"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
