import type { UnitaStratigrafica, Giornata, Allegato } from "@shared/schema";

export interface QcIssue {
  livello: "error" | "warning" | "info";
  categoria: "completezza" | "coerenza" | "nomenclatura" | "associazione";
  messaggio: string;
  campoInteressato?: string;
  usId?: number;
}

// ─── Controlla una singola US ─────────────────────────────────────────────────
export function checkUS(us: UnitaStratigrafica, allegatiUS: Allegato[]): QcIssue[] {
  const issues: QcIssue[] = [];

  // Completezza campi obbligatori
  if (!us.tipo) {
    issues.push({ livello: "error", categoria: "completezza", messaggio: `US ${us.codiceUS}: tipo non compilato`, campoInteressato: "tipo", usId: us.id });
  }
  if (!us.descrizione || us.descrizione.trim().length < 20) {
    issues.push({ livello: "error", categoria: "completezza", messaggio: `US ${us.codiceUS}: descrizione assente o troppo breve`, campoInteressato: "descrizione", usId: us.id });
  }
  if (!us.definizione) {
    issues.push({ livello: "warning", categoria: "completezza", messaggio: `US ${us.codiceUS}: definizione non compilata`, campoInteressato: "definizione", usId: us.id });
  }
  if (us.quota === null || us.quota === undefined) {
    issues.push({ livello: "warning", categoria: "completezza", messaggio: `US ${us.codiceUS}: quota non rilevata`, campoInteressato: "quota", usId: us.id });
  }
  if (!us.settore) {
    issues.push({ livello: "warning", categoria: "completezza", messaggio: `US ${us.codiceUS}: settore non indicato`, campoInteressato: "settore", usId: us.id });
  }

  // Nomenclatura
  if (!us.codiceUS.match(/^(US|T|SB|SF|US\s?)\s?\d{3,4}$/i)) {
    issues.push({ livello: "warning", categoria: "nomenclatura", messaggio: `US ${us.codiceUS}: formato codice non conforme (atteso: US 001, T.001, SB 001)`, campoInteressato: "codice_us", usId: us.id });
  }

  // Associazione foto/disegno
  const foto = allegatiUS.filter(a => a.tipo === "foto");
  const disegni = allegatiUS.filter(a => a.tipo === "planimetria" || a.tipo === "disegno");

  if (foto.length === 0) {
    issues.push({ livello: "warning", categoria: "associazione", messaggio: `US ${us.codiceUS}: nessuna fotografia allegata`, campoInteressato: "ha_foto", usId: us.id });
  }
  if (disegni.length === 0 && us.tipo !== "interfaccia") {
    issues.push({ livello: "info", categoria: "associazione", messaggio: `US ${us.codiceUS}: nessun disegno/planimetria allegata`, campoInteressato: "ha_disegno", usId: us.id });
  }

  // Tomba: campi specifici
  if (us.tipo === "tomba" || us.codiceUS.toUpperCase().startsWith("T.") || us.codiceUS.toUpperCase().startsWith("T ")) {
    if (!us.periodoIniziale) {
      issues.push({ livello: "warning", categoria: "completezza", messaggio: `US ${us.codiceUS}: per una tomba indicare il periodo/datazione`, campoInteressato: "periodo_iniziale", usId: us.id });
    }
    if (!us.interpretazione) {
      issues.push({ livello: "warning", categoria: "completezza", messaggio: `US ${us.codiceUS}: interpretazione non compilata per la tomba`, campoInteressato: "interpretazione", usId: us.id });
    }
  }

  return issues;
}

// ─── Controlla coerenza stratigrafica tra tutte le US di un cantiere ──────────
export function checkCoerenzaStratigrafica(usList: UnitaStratigrafica[]): QcIssue[] {
  const issues: QcIssue[] = [];
  const codicesToIds = new Map<string, number>();
  usList.forEach(us => codicesToIds.set(us.codiceUS.toUpperCase(), us.id));

  for (const us of usList) {
    const refs = [
      { campo: "coperto_da", val: us.coperto_da },
      { campo: "copre", val: us.copre },
      { campo: "si_lega_a", val: us.si_lega_a },
      { campo: "uguale_a", val: us.uguale_a },
    ];
    for (const ref of refs) {
      if (!ref.val) continue;
      let codici: string[] = [];
      try { codici = JSON.parse(ref.val); } catch { codici = [ref.val]; }
      for (const cod of codici) {
        if (cod && !codicesToIds.has(cod.toUpperCase())) {
          issues.push({
            livello: "warning",
            categoria: "coerenza",
            messaggio: `US ${us.codiceUS}: il campo "${ref.campo}" fa riferimento a "${cod}" non presente nel cantiere`,
            campoInteressato: ref.campo,
            usId: us.id,
          });
        }
      }
    }
  }
  return issues;
}

// ─── Controlla una giornata completa ─────────────────────────────────────────
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
    issues.push({ livello: "error", categoria: "completezza", messaggio: "Operatori non indicati per la giornata", campoInteressato: "operatori" });
  }
  if (!giornata.settore) {
    issues.push({ livello: "warning", categoria: "completezza", messaggio: "Settore non indicato per la giornata", campoInteressato: "settore" });
  }

  // Controlla ogni US
  for (const us of usList) {
    const allegatiUS = allegatiGiornata.filter(a => a.usId === us.id);
    const usIssues = checkUS(us, allegatiUS);
    issues.push(...usIssues);
  }

  // Coerenza stratigrafica sull'intero cantiere
  const stratigrafiaIssues = checkCoerenzaStratigrafica(tutteLeUS);
  // filtra solo quelle relative alle US di questa giornata
  const giornataUsIds = new Set(usList.map(u => u.id));
  const filteredStrat = stratigrafiaIssues.filter(i => i.usId === undefined || giornataUsIds.has(i.usId!));
  issues.push(...filteredStrat);

  // Determina status globale
  const hasError = issues.some(i => i.livello === "error");
  const hasWarning = issues.some(i => i.livello === "warning");
  const status = hasError ? "error" : hasWarning ? "warning" : "ok";

  return { issues, status };
}
