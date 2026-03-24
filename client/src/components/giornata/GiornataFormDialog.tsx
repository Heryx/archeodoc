import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import GoogleDocsImport from "@/components/GoogleDocsImport";
import { GiornataFormFields } from "@/components/giornata/GiornataFormFields";
import type { GiornataForm } from "@/components/giornata/types";

type GoogleImportPayload = {
  mapped: Record<string, string>;
  text: string;
  mode: "structured" | "ai";
};

type GiornataFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  form: GiornataForm;
  setForm: Dispatch<SetStateAction<GiornataForm>>;
  onSubmit: () => void;
  submitPending: boolean;
  submitLabelIdle: string;
  submitLabelPending: string;
  submitDisabled: boolean;
  onImportedTextNotice: () => void;
};

export function GiornataFormDialog({
  open,
  onOpenChange,
  title,
  form,
  setForm,
  onSubmit,
  submitPending,
  submitLabelIdle,
  submitLabelPending,
  submitDisabled,
  onImportedTextNotice,
}: GiornataFormDialogProps) {
  function handleImport(payload: GoogleImportPayload) {
    if (payload.mode === "structured") {
      setForm((previous) => ({ ...previous, ...payload.mapped }));
      return;
    }

    setForm((previous) => ({ ...previous, note: payload.text }));
    onImportedTextNotice();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-5xl max-h-[92vh] overflow-hidden p-0">
        <DialogHeader className="border-b border-border bg-muted/20 px-4 py-3 sm:px-6">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[calc(92vh-146px)] overflow-y-auto px-4 py-4 sm:px-6">
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/10 p-3">
              <GoogleDocsImport mode="giornata" onImport={handleImport} />
            </div>
            <GiornataFormFields form={form} setForm={setForm} />
          </div>
        </div>

        <div className="border-t border-border bg-background px-4 py-3 sm:px-6">
          <div className="flex justify-end">
            <Button className="w-full sm:w-auto sm:min-w-56" onClick={onSubmit} disabled={submitDisabled}>
              {submitPending ? submitLabelPending : submitLabelIdle}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
