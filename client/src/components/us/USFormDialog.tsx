import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import GoogleDocsImport from "@/components/GoogleDocsImport";
import { USFormFields } from "@/components/us/USForm";
import type { USForm } from "@/components/us/types";
import type { USThesaurusConfig } from "@shared/us_thesaurus";
import type { USModelDefinition } from "@shared/us_models";
import { buildPanelHref } from "@/lib/location";

type GoogleImportPayload = {
  mapped: Record<string, string>;
  text: string;
  mode: "structured" | "ai";
};

type USFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  form: USForm;
  setForm: Dispatch<SetStateAction<USForm>>;
  giornate: any[];
  usThesaurus?: USThesaurusConfig;
  activeModel?: USModelDefinition;
  missingRequired: string[];
  onSubmit: () => void;
  submitPending: boolean;
  submitLabelIdle: string;
  submitLabelPending: string;
  submitDisabled: boolean;
  onSaveDraft: () => void;
  draftLabelIdle: string;
  draftLabelPending: string;
  draftDisabled: boolean;
  onImportedAiTextNotice: () => void;
  onTriggerAiAnalysis?: (text: string) => void;
  potentialDuplicate?: { id: number; codiceUS: string } | null;
  onOpenDuplicate?: (id: number) => void;
  /** All US codes in the cantiere for autocomplete in relation fields */
  usCodeSuggestions?: string[];
  /** Full US list for relation consistency indicators */
  usFullList?: any[];
  /** Called when user clicks a relation tag to navigate to that US */
  onNavigateToUS?: (code: string) => void;
  /** ID cantiere, usato solo per il link "Guida terminologica" verso il pannello Thesaurus */
  cid?: string;
};

export function USFormDialog({
  open,
  onOpenChange,
  title,
  form,
  setForm,
  giornate,
  usThesaurus,
  activeModel,
  missingRequired,
  onSubmit,
  submitPending,
  submitLabelIdle,
  submitLabelPending,
  submitDisabled,
  onSaveDraft,
  draftLabelIdle,
  draftLabelPending,
  draftDisabled,
  onImportedAiTextNotice,
  onTriggerAiAnalysis,
  potentialDuplicate,
  onOpenDuplicate,
  usCodeSuggestions = [],
  usFullList = [],
  onNavigateToUS,
  cid,
}: USFormDialogProps) {
  const [showAiHint, setShowAiHint] = useState(false);
  const [location] = useLocation();
  const thesaurusHref = buildPanelHref(location, "thesaurus");

  const { data: periodiData } = useQuery<{
    periodi: { nome: string }[];
    unregistered: { nome: string }[];
  }>({
    queryKey: ["/api/cantieri", cid, "periodi"],
    queryFn: async () => (await apiRequest("GET", `/api/cantieri/${cid}/periodi`)).json(),
    enabled: !!cid && open,
  });
  const periodiSuggestions = useMemo(
    () => [...(periodiData?.periodi ?? []), ...(periodiData?.unregistered ?? [])].map((p) => p.nome),
    [periodiData],
  );

  function handleImport(data: GoogleImportPayload) {
    if (data.mode === "structured") {
      setForm((previous) => ({ ...previous, ...data.mapped }));
      return;
    }

    // AI mode: put text in descrizione AND trigger AI analysis
    setForm((previous) => ({ ...previous, descrizione: data.text }));
    if (onTriggerAiAnalysis) {
      onTriggerAiAnalysis(data.text);
    } else {
      setShowAiHint(true);
      onImportedAiTextNotice();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[97vw] max-w-[1400px] max-h-[95vh] overflow-hidden p-0">
        <DialogHeader className="border-b border-border bg-muted/20 px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle>{title}</DialogTitle>
            {cid && (
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground shrink-0" asChild>
                <a href={thesaurusHref} title="Apri Indice e Guida (vocabolario e note tecniche ICCD)">
                  <BookOpen size={14} /> Guida terminologica
                </a>
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="max-h-[calc(95vh-158px)] overflow-y-auto px-4 py-4 sm:px-6">
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/10 p-3">
              <GoogleDocsImport mode="us" onImport={handleImport} />
            </div>
            {showAiHint && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Testo importato nel campo Descrizione. Salva prima come bozza, poi usa il pulsante <strong>Compilazione AI</strong> per compilare automaticamente tutti i campi.
              </div>
            )}
            <USFormFields
              periodiSuggestions={periodiSuggestions}
              form={form}
              setForm={setForm}
              giornate={giornate}
              usThesaurus={usThesaurus}
              activeModel={activeModel}
              potentialDuplicate={potentialDuplicate}
              onOpenDuplicate={onOpenDuplicate}
              usCodeSuggestions={usCodeSuggestions}
              usFullList={usFullList}
              onNavigateToUS={onNavigateToUS}
            />
          </div>
        </div>

        <div className="border-t border-border bg-background px-4 py-3 sm:px-6">
          {missingRequired.length > 0 ? (
            <p className="mb-2 text-xs text-amber-700">
              Campi obbligatori mancanti: {missingRequired.slice(0, 3).join(", ")}
              {missingRequired.length > 3 ? "..." : ""}. Puoi comunque salvare in bozza.
            </p>
          ) : (
            <p className="mb-2 text-xs text-muted-foreground">Scheda completa: puoi registrarla come definitiva.</p>
          )}

          <div className="flex flex-col justify-end gap-2 sm:flex-row">
            <Button
              variant="outline"
              className="w-full sm:w-auto sm:min-w-48"
              onClick={onSaveDraft}
              disabled={draftDisabled}
            >
              {submitPending ? draftLabelPending : draftLabelIdle}
            </Button>
            <Button className="w-full sm:w-auto sm:min-w-56" onClick={onSubmit} disabled={submitDisabled}>
              {submitPending ? submitLabelPending : submitLabelIdle}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
