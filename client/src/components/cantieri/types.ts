export type CantiereForm = {
  codice: string;
  nome: string;
  localita: string;
  committente: string;
  responsabile: string;
  dataInizio: string;
  dataFine: string;
  note: string;
};

export type CantiereDeleteImpact = {
  giornateCount: number;
  usCount: number;
  allegatiCount: number;
  qcLogsCount: number;
};

export type ProjectItem = {
  id: string;
  name: string;
};

export type ProjectsResponse = {
  currentProjectId: string | null;
  projects: ProjectItem[];
};

export type CantiereTransferResult = {
  mode: "copy" | "move";
  targetProjectId: string;
  targetCantiereId: number;
  targetCodice: string;
  codiceRenamed: boolean;
  sourceDeleted: boolean;
  filesCopied: number;
  filesMissing: number;
  counts: {
    giornate: number;
    us: number;
    allegati: number;
    qcLogs: number;
  };
};

export const emptyForm: CantiereForm = {
  codice: "",
  nome: "",
  localita: "",
  committente: "",
  responsabile: "",
  dataInizio: "",
  dataFine: "",
  note: "",
};

export function mapCantiereToForm(c: any): CantiereForm {
  return {
    codice: c.codice || "",
    nome: c.nome || "",
    localita: c.localita || "",
    committente: c.committente || "",
    responsabile: c.responsabile || "",
    dataInizio: c.dataInizio || "",
    dataFine: c.dataFine || "",
    note: c.note || "",
  };
}
