import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import GoogleDocsImport from "@/components/GoogleDocsImport";
import { USFormFields } from "@/components/us/USForm";
import type { USForm } from "@/components/us/types";
import type { USThesaurusConfig } from "@shared/us_thesaurus";
import type { USModelDefinition } from "@shared/us_models";

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
  onImportedAiTextNotice: () => void;
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
  onImportedAiTextNotice,
}: USFormDialogProps) {
  function handleImport(data: GoogleImportPayload) {
    if (data.mode === "structured") {
      setForm((previous) => ({ ...previous, ...data.mapped }));
      return;
    }

    setForm((previous) => ({ ...previous, descrizione: data.text }));
    onImportedAiTextNotice();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <GoogleDocsImport mode="us" onImport={handleImport} />
        <USFormFields form={form} setForm={setForm} giornate={giornate} usThesaurus={usThesaurus} activeModel={activeModel} />

        {missingRequired.length > 0 && (
          <p className="text-xs text-red-600">
            Campi obbligatori mancanti: {missingRequired.slice(0, 3).join(", ")}
            {missingRequired.length > 3 ? "..." : ""}
          </p>
        )}

        <Button className="w-full" onClick={onSubmit} disabled={submitDisabled}>
          {submitPending ? submitLabelPending : submitLabelIdle}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
