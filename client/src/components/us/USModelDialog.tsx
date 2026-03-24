import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { USModelDefinition } from "@shared/us_models";

type USModelDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelDraftKey: string;
  activeModelKey: string;
  availableModels: USModelDefinition[];
  isUsModelsLoading: boolean;
  isCantiereModelLoading: boolean;
  usModelsError: unknown;
  cantiereModelError: unknown;
  applyPending: boolean;
  applyError: boolean;
  onSelectModel: (modelKey: string) => void;
  currentDraftModel?: USModelDefinition;
  canDeleteDraftModel: boolean;
  deleteCustomModelPending: boolean;
  onDeleteDraftModel: () => void;
  customModelName: string;
  setCustomModelName: (value: string) => void;
  customModelDescription: string;
  setCustomModelDescription: (value: string) => void;
  customModelFieldsRaw: string;
  setCustomModelFieldsRaw: (value: string) => void;
  createCustomModelPending: boolean;
  onCreateCustomModel: () => void;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Errore sconosciuto";
}

export function USModelDialog({
  open,
  onOpenChange,
  modelDraftKey,
  activeModelKey,
  availableModels,
  isUsModelsLoading,
  isCantiereModelLoading,
  usModelsError,
  cantiereModelError,
  applyPending,
  applyError,
  onSelectModel,
  currentDraftModel,
  canDeleteDraftModel,
  deleteCustomModelPending,
  onDeleteDraftModel,
  customModelName,
  setCustomModelName,
  customModelDescription,
  setCustomModelDescription,
  customModelFieldsRaw,
  setCustomModelFieldsRaw,
  createCustomModelPending,
  onCreateCustomModel,
}: USModelDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Modelli scheda US</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <Label>Modello usato dal cantiere</Label>
            <Select value={modelDraftKey} onValueChange={onSelectModel}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona modello..." />
              </SelectTrigger>
              <SelectContent>
                {availableModels.map((model) => (
                  <SelectItem key={model.key} value={model.key}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">I nuovi record US useranno automaticamente questo modello.</p>
          </div>

          {(isUsModelsLoading || isCantiereModelLoading) && (
            <p className="text-xs text-muted-foreground">Caricamento modelli...</p>
          )}

          {!isUsModelsLoading && availableModels.length === 0 && (
            <p className="text-xs text-red-600">Nessun modello disponibile. Verifica il progetto attivo e riapri la pagina.</p>
          )}

          {Boolean(usModelsError || cantiereModelError) && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2">
              <p className="text-xs text-red-700">
                Errore caricamento modelli: {errorMessage(usModelsError) || errorMessage(cantiereModelError)}
              </p>
              <p className="text-xs text-red-700 mt-1">
                Se il messaggio contiene "Unexpected token &lt;", riavvia il server con `avvia.bat`.
              </p>
            </div>
          )}

          {availableModels.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Modelli disponibili</p>
              {availableModels.map((model) => {
                const selected = model.key === activeModelKey;
                return (
                  <div
                    key={model.key}
                    className={cn(
                      "rounded-md border p-3 flex items-start justify-between gap-3",
                      selected ? "border-primary/60 bg-primary/5" : "border-border",
                    )}
                  >
                    <div>
                      <p className="text-sm font-medium">{model.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Chiave: {model.key} · Fonte: {model.source} · Campi extra: {model.fields.length}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={selected ? "secondary" : "outline"}
                      disabled={applyPending || selected}
                      onClick={() => onSelectModel(model.key)}
                    >
                      {selected ? "Attivo" : "Usa questo"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {applyPending && <p className="text-xs text-muted-foreground">Applicazione modello in corso...</p>}
          {applyError && <p className="text-xs text-red-600">Errore applicazione modello. Riprova.</p>}

          {currentDraftModel && (
            <div className="rounded-md border border-border p-3 bg-muted/20">
              <p className="text-sm font-medium">{currentDraftModel.name}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Fonte: {currentDraftModel.source} · Campi extra: {currentDraftModel.fields.length}
              </p>
              {currentDraftModel.fields.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {currentDraftModel.fields.slice(0, 8).map((field) => (
                    <Badge key={field.key} variant="outline" className="text-[10px]">
                      {field.label}
                    </Badge>
                  ))}
                  {currentDraftModel.fields.length > 8 && (
                    <Badge variant="outline" className="text-[10px]">
                      +{currentDraftModel.fields.length - 8}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          )}

          {canDeleteDraftModel && (
            <div>
              <Button variant="destructive" onClick={onDeleteDraftModel} disabled={deleteCustomModelPending}>
                {deleteCustomModelPending ? "Eliminazione..." : "Elimina modello custom"}
              </Button>
            </div>
          )}

          <div className="pt-3 border-t border-border space-y-3">
            <p className="text-sm font-medium">Nuovo modello personalizzato</p>
            <div>
              <Label>Nome modello *</Label>
              <Input
                placeholder="es. US Cooperativa XYZ"
                value={customModelName}
                onChange={(event) => setCustomModelName(event.target.value)}
              />
            </div>
            <div>
              <Label>Descrizione</Label>
              <Input
                placeholder="Uso interno progetto..."
                value={customModelDescription}
                onChange={(event) => setCustomModelDescription(event.target.value)}
              />
            </div>
            <div>
              <Label>Campi custom (una etichetta per riga) *</Label>
              <Textarea
                rows={6}
                placeholder={
                  "Esempio:\nTipo argilla\nData campionamento|date\nMetodo|select|manuale,strumentale\nNote campione|textarea"
                }
                value={customModelFieldsRaw}
                onChange={(event) => setCustomModelFieldsRaw(event.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Formato riga: Etichetta|tipo|opzioni. Tipi: text, textarea, date, select.
              </p>
            </div>
            <Button className="w-full" onClick={onCreateCustomModel} disabled={!customModelName.trim() || createCustomModelPending}>
              {createCustomModelPending ? "Creazione..." : "Crea modello custom"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
