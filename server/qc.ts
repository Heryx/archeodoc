import type { UnitaStratigrafica, Giornata, Allegato } from "@shared/schema";

export interface QcIssue {
  livello: "error" | "warning" | "info";
  categoria: "completezza" | "coerenza" | "nomenclatura" | "associazione";
  messaggio: string;
  campoInteressato?: string;
  usId?: number;
}

type RelationFieldValue = {
  campo: string;
  val: unknown;
};

const EXTRA_RELATION_FIELD_MAP: Record<string, string> = {
  riempie: "riempie",
  riempitoDa: "riempitoDa",
  riempita_da: "riempitoDa",
  riempito_da: "riempitoDa",
  taglia: "taglia",
  tagliatoDa: "tagliatoDa",
  tagliata_da: "tagliatoDa",
  siAppoggiaA: "siAppoggiaA",
  si_appoggia_a: "siAppoggiaA",
  gliSiAppoggia: "gliSiAppoggia",
  gli_si_appoggia: "gliSiAppoggia",
  ugualeAStratigrafico: "ugualeAStratigrafico",
  posterioreA: "posterioreA",
  posteriore_a: "posterioreA",
  anterioreA: "anterioreA",
  anteriore_a: "anterioreA",
};

function normalizeCode(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function parseSchedaData(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseRelationCodes(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];

  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const value of raw) {
      out.push(...parseRelationCodes(value));
    }
    return out;
  }

  const text = String(raw).trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parseRelationCodes(parsed);
    }
  } catch {
    // fallback plain text split
  }

  const tokens = text
    .split(/[;,|\n\r]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const out: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const digitsOnly = token.match(/^\d+$/);
    const normalizedToken = digitsOnly ? `US ${Number(token)}` : token;
    const key = normalizeCode(normalizedToken);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(normalizedToken);
  }

  return out;
}

function extractRelationFields(us: UnitaStratigrafica): RelationFieldValue[] {
  const refs: RelationFieldValue[] = [
    { campo: "coperto_da", val: us.coperto_da },
    { campo: "copre", val: us.copre },
    { campo: "si_lega_a", val: us.si_lega_a },
    { campo: "uguale_a", val: us.uguale_a },
  ];

  const schedaData = parseSchedaData(us.schedaData);
  for (const [key, value] of Object.entries(schedaData)) {
    const mapped = EXTRA_RELATION_FIELD_MAP[key];
    if (!mapped) continue;
    refs.push({ campo: mapped, val: value });
  }

  return refs;
}

export function checkUS(us: UnitaStratigrafica, allegatiUS: Allegato[]): QcIssue[] {
  const issues: QcIssue[] = [];

  // Completezza campi obbligatori
  if (!us.tipo) {
    issues.push({
      livello: "error",
      categoria: "completezza",
      messaggio: `US ${us.codiceUS}: tipo non compilato`,
      campoInteressato: "tipo",
      usId: us.id,
    });
  }
  if (!us.descrizione || us.descrizione.trim().length < 20) {
    issues.push({
      livello: "error",
      categoria: "completezza",
      messaggio: `US ${us.codiceUS}: descrizione assente o troppo breve`,
      campoInteressato: "descrizione",
      usId: us.id,
    });
  }
  if (!us.definizione) {
    issues.push({
      livello: "warning",
      categoria: "completezza",
      messaggio: `US ${us.codiceUS}: definizione non compilata`,
      campoInteressato: "definizione",
      usId: us.id,
    });
  }
  if (
    (us.quota === null || us.quota === undefined) &&
    (us.quotaPianoCampagna === null || us.quotaPianoCampagna === undefined)
  ) {
    issues.push({
      livello: "warning",
      categoria: "completezza",
      messaggio: `US ${us.codiceUS}: quota non rilevata (s.l.m. o da piano campagna)`,
      campoInteressato: "quota",
      usId: us.id,
    });
  }
  if (!us.settore) {
    issues.push({
      livello: "warning",
      categoria: "completezza",
      messaggio: `US ${us.codiceUS}: settore non indicato`,
      campoInteressato: "settore",
      usId: us.id,
    });
  }

  // Nomenclatura
  if (!us.codiceUS.match(/^(US|T|SB|SF)\.?\s*\d{1,4}$/i)) {
    issues.push({
      livello: "warning",
      categoria: "nomenclatura",
      messaggio: `US ${us.codiceUS}: formato codice non conforme (atteso: US 001, T.001, SB 001)`,
      campoInteressato: "codice_us",
      usId: us.id,
    });
  }

  // Associazione foto/disegno
  const foto = allegatiUS.filter((a) => a.tipo === "foto");
  const disegni = allegatiUS.filter((a) => a.tipo === "planimetria" || a.tipo === "disegno");

  if (foto.length === 0) {
    issues.push({
      livello: "warning",
      categoria: "associazione",
      messaggio: `US ${us.codiceUS}: nessuna fotografia allegata`,
      campoInteressato: "ha_foto",
      usId: us.id,
    });
  }
  if (disegni.length === 0 && us.tipo !== "interfaccia") {
    issues.push({
      livello: "info",
      categoria: "associazione",
      messaggio: `US ${us.codiceUS}: nessun disegno/planimetria allegata`,
      campoInteressato: "ha_disegno",
      usId: us.id,
    });
  }

  // Tomba: campi specifici
  if (us.tipo === "tomba" || us.codiceUS.toUpperCase().startsWith("T.") || us.codiceUS.toUpperCase().startsWith("T ")) {
    if (!us.periodoIniziale) {
      issues.push({
        livello: "warning",
        categoria: "completezza",
        messaggio: `US ${us.codiceUS}: per una tomba indicare il periodo/datazione`,
        campoInteressato: "periodo_iniziale",
        usId: us.id,
      });
    }
    if (!us.interpretazione) {
      issues.push({
        livello: "warning",
        categoria: "completezza",
        messaggio: `US ${us.codiceUS}: interpretazione non compilata per la tomba`,
        campoInteressato: "interpretazione",
        usId: us.id,
      });
    }
  }

  return issues;
}

export function checkCoerenzaStratigrafica(usList: UnitaStratigrafica[]): QcIssue[] {
  const issues: QcIssue[] = [];
  const codici = new Set<string>();

  for (const us of usList) {
    codici.add(normalizeCode(us.codiceUS));
  }

  const seen = new Set<string>();

  for (const us of usList) {
    const sourceCode = normalizeCode(us.codiceUS);
    const refs = extractRelationFields(us);

    for (const ref of refs) {
      const targets = parseRelationCodes(ref.val);

      for (const targetRaw of targets) {
        const target = normalizeCode(targetRaw);
        if (!target) continue;

        const key = `${us.id}:${ref.campo}:${target}`;
        if (seen.has(key)) continue;
        seen.add(key);

        if (target === sourceCode) {
          issues.push({
            livello: "warning",
            categoria: "coerenza",
            messaggio: `US ${us.codiceUS}: il campo "${ref.campo}" contiene un auto-riferimento (${targetRaw})`,
            campoInteressato: ref.campo,
            usId: us.id,
          });
          continue;
        }

        if (!codici.has(target)) {
          issues.push({
            livello: "warning",
            categoria: "coerenza",
            messaggio: `US ${us.codiceUS}: il campo "${ref.campo}" fa riferimento a "${targetRaw}" non presente nel cantiere`,
            campoInteressato: ref.campo,
            usId: us.id,
          });
        }
      }
    }
  }

  return issues;
}

export interface GiornataQcResult {
  issues: QcIssue[];
  status: "ok" | "warning" | "error";
}

export function checkGiornata(
  giornata: Giornata,
  usList: UnitaStratigrafica[],
  allegatiGiornata: Allegato[],
  tutteLeUS: UnitaStratigrafica[],
): GiornataQcResult {
  const issues: QcIssue[] = [];

  // Campi giornata
  if (!giornata.operatori) {
    issues.push({
      livello: "error",
      categoria: "completezza",
      messaggio: "Operatori non indicati per la giornata",
      campoInteressato: "operatori",
    });
  }
  if (!giornata.settore) {
    issues.push({
      livello: "warning",
      categoria: "completezza",
      messaggio: "Settore non indicato per la giornata",
      campoInteressato: "settore",
    });
  }

  // Controlla ogni US
  for (const us of usList) {
    const allegatiUS = allegatiGiornata.filter((a) => a.usId === us.id);
    issues.push(...checkUS(us, allegatiUS));
  }

  // Coerenza sull'intero cantiere, filtrata sulla giornata
  const stratigrafiaIssues = checkCoerenzaStratigrafica(tutteLeUS);
  const giornataUsIds = new Set(usList.map((u) => u.id));
  const filteredStrat = stratigrafiaIssues.filter((issue) => issue.usId === undefined || giornataUsIds.has(issue.usId));
  issues.push(...filteredStrat);

  const hasError = issues.some((issue) => issue.livello === "error");
  const hasWarning = issues.some((issue) => issue.livello === "warning");
  const status = hasError ? "error" : hasWarning ? "warning" : "ok";

  return { issues, status };
}
