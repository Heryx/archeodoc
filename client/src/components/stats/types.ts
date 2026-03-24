export type Stats = {
  cantiere: { nome: string; codice: string; localita: string };
  giornate: { totale: number; qcStatus: Record<string, number>; reportGenerati: number };
  us: { totale: number; perTipo: Record<string, number>; schedeGenerate: number };
  allegati: { totale: number; perTipo: Record<string, number> };
  qc: { erroriAperti: number; warningAperti: number };
};
