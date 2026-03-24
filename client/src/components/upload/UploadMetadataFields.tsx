import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { GiornataOption, USOption } from "@/components/upload/types";

type UploadMetadataFieldsProps = {
  giornate: GiornataOption[];
  usList: USOption[];
  selectedGiornata: string;
  setSelectedGiornata: (value: string) => void;
  selectedUS: string;
  setSelectedUS: (value: string) => void;
  operatore: string;
  setOperatore: (value: string) => void;
  descrizione: string;
  setDescrizione: (value: string) => void;
};

export function UploadMetadataFields({
  giornate,
  usList,
  selectedGiornata,
  setSelectedGiornata,
  selectedUS,
  setSelectedUS,
  operatore,
  setOperatore,
  descrizione,
  setDescrizione,
}: UploadMetadataFieldsProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <Label>Associa a giornata</Label>
        <Select value={selectedGiornata} onValueChange={setSelectedGiornata}>
          <SelectTrigger data-testid="select-giornata-upload">
            <SelectValue placeholder="Seleziona giornata..." />
          </SelectTrigger>
          <SelectContent>
            {giornate.map((giornata) => (
              <SelectItem key={giornata.id} value={String(giornata.id)}>
                {giornata.data}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Associa a US (opzionale)</Label>
        <Select value={selectedUS} onValueChange={setSelectedUS}>
          <SelectTrigger>
            <SelectValue placeholder="Seleziona US..." />
          </SelectTrigger>
          <SelectContent>
            {usList.map((us) => (
              <SelectItem key={us.id} value={String(us.id)}>
                {us.codiceUS}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Operatore</Label>
        <Input value={operatore} onChange={(event) => setOperatore(event.target.value)} placeholder="Nome operatore" />
      </div>
      <div>
        <Label>Descrizione</Label>
        <Input value={descrizione} onChange={(event) => setDescrizione(event.target.value)} placeholder="Note sui file" />
      </div>
    </div>
  );
}
