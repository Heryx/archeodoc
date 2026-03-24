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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <GoogleDocsImport mode="giornata" onImport={handleImport} />
        <GiornataFormFields form={form} setForm={setForm} />

        <Button className="w-full" onClick={onSubmit} disabled={submitDisabled}>
          {submitPending ? submitLabelPending : submitLabelIdle}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
