export type MaterialeForm = {
  codice: string;
  tipo: string;
  descrizione: string;
  usId: string;
  dataJson: string;
};

export const emptyMaterialeForm: MaterialeForm = {
  codice: "",
  tipo: "",
  descrizione: "",
  usId: "none",
  dataJson: "",
};

function asNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function materialePayload(form: MaterialeForm) {
  let data: Record<string, unknown> | null = null;
  const rawData = form.dataJson.trim();
  if (rawData) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawData);
    } catch {
      throw new Error("JSON campi schema non valido");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Il JSON dei campi schema deve essere un oggetto");
    }
    data = parsed as Record<string, unknown>;
  }

  return {
    codice: form.codice.trim(),
    tipo: asNullable(form.tipo),
    descrizione: asNullable(form.descrizione),
    usId: form.usId && form.usId !== "none" ? Number(form.usId) : null,
    data,
  };
}

export function mapMaterialeToForm(materiale: any): MaterialeForm {
  let dataJson = "";
  if (typeof materiale.data === "string" && materiale.data.trim()) {
    try {
      dataJson = JSON.stringify(JSON.parse(materiale.data), null, 2);
    } catch {
      dataJson = materiale.data;
    }
  }

  return {
    codice: materiale.codice || "",
    tipo: materiale.tipo || "",
    descrizione: materiale.descrizione || "",
    usId: materiale.usId != null ? String(materiale.usId) : "none",
    dataJson,
  };
}
