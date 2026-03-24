import test from "node:test";
import assert from "node:assert/strict";

import { applyGoogleSyncPreview, type GoogleSyncPreview } from "../server/google_sync";

test("google_sync: createUS salva quota numerica e campi avanzati", () => {
  const createdPayloads: Array<Record<string, unknown>> = [];

  const storage: any = {
    getGiornate: () => [
      {
        id: 10,
        cantiereId: 1,
        data: "2026-03-24",
        operatori: null,
        condMeteo: null,
        settore: null,
        note: null,
        qcStatus: "pending",
        qcReport: null,
        aiReportText: null,
        createdAt: "2026-03-24T08:00:00.000Z",
      },
    ],
    createGiornata: () => {
      throw new Error("non dovrebbe creare giornata in questo test");
    },
    createUS: (payload: Record<string, unknown>) => {
      createdPayloads.push(payload);
      return { id: 99, ...payload };
    },
    updateUS: () => undefined,
  };

  const preview: GoogleSyncPreview = {
    docId: "doc-1",
    giornate: 1,
    usTotali: 1,
    warnings: [],
    items: [
      {
        key: "2026-03-24::US 205",
        giornataData: "2026-03-24",
        codiceUS: "US 205",
        usNumero: 205,
        status: "new",
        missingFields: [],
        deterministic: {},
        ai: {},
        proposed: {
          tipo: "Strato",
          definizione: "Riporto",
          descrizione: "Descrizione importata",
          interpretazione: "Interpretazione",
          quota: "12,5",
          settore: "A",
          coperto_da: "[\"US 198\"]",
          copre: null,
          si_lega_a: null,
          uguale_a: null,
          periodoIniziale: "XIII sec.",
          periodoFinale: "XIV sec.",
          materialiRinvenuti: "Ceramica comune",
          campioni: "C1",
          schedaData: {
            naturaUs: "ART - Artificiale",
            criteriDistinzione: "Distinta per colore e componenti",
          },
        },
        rawText: "",
      },
    ],
  };

  const result = applyGoogleSyncPreview(storage, { id: 1, usModelKey: "iccd-us-2021" } as any, preview, {});

  assert.equal(result.created, 1);
  assert.equal(createdPayloads.length, 1);
  assert.equal(createdPayloads[0].tipo, "strato");
  assert.equal(createdPayloads[0].definizione, "strato di riporto");
  assert.equal(createdPayloads[0].quota, 12.5);
  assert.equal(createdPayloads[0].settore, "A");
  assert.equal(createdPayloads[0].periodoIniziale, "XIII sec.");

  const schedaData = JSON.parse(String(createdPayloads[0].schedaData));
  assert.equal(schedaData.naturaUs, "ART - Artificiale");
  assert.equal(schedaData.criteriDistinzione, "Distinta per colore e componenti");
});

test("google_sync: updateUS valorizza solo campi vuoti e converte quota", () => {
  const updates: Array<{ id: number; patch: Record<string, unknown> }> = [];

  const storage: any = {
    getGiornate: () => [
      {
        id: 20,
        cantiereId: 1,
        data: "2026-03-24",
        operatori: null,
        condMeteo: null,
        settore: null,
        note: null,
        qcStatus: "pending",
        qcReport: null,
        aiReportText: null,
        createdAt: "2026-03-24T08:00:00.000Z",
      },
    ],
    createGiornata: () => {
      throw new Error("non dovrebbe creare giornata in questo test");
    },
    createUS: () => {
      throw new Error("non dovrebbe creare US in questo test");
    },
    updateUS: (id: number, patch: Record<string, unknown>) => {
      updates.push({ id, patch });
      return { id, ...patch };
    },
  };

  const preview: GoogleSyncPreview = {
    docId: "doc-2",
    giornate: 1,
    usTotali: 1,
    warnings: [],
    items: [
      {
        key: "2026-03-24::US 206",
        giornataData: "2026-03-24",
        codiceUS: "US 206",
        usNumero: 206,
        status: "existing",
        missingFields: [],
        deterministic: {},
        ai: {},
        proposed: {
          tipo: "Strato",
          definizione: "Riempimento",
          descrizione: null,
          interpretazione: null,
          quota: "3.2",
          settore: "B",
          coperto_da: null,
          copre: null,
          si_lega_a: null,
          uguale_a: null,
          periodoIniziale: null,
          periodoFinale: null,
          materialiRinvenuti: null,
          campioni: null,
          schedaData: {
            affidabilitaStratigrafica: "Buona",
          },
        },
        existing: {
          id: 206,
          tipo: null,
          definizione: null,
          descrizione: null,
          interpretazione: null,
          quota: null,
          settore: null,
          coperto_da: null,
          copre: null,
          si_lega_a: null,
          uguale_a: null,
          periodoIniziale: null,
          periodoFinale: null,
          materialiRinvenuti: null,
          campioni: null,
          giornataId: 20,
          schedaData: {},
        },
        rawText: "",
      },
    ],
  };

  const result = applyGoogleSyncPreview(storage, { id: 1, usModelKey: "iccd-us-2021" } as any, preview, {});

  assert.equal(result.updated, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, 206);
  assert.equal(updates[0].patch.tipo, "strato");
  assert.equal(updates[0].patch.definizione, "Riempimento");
  assert.equal(updates[0].patch.quota, 3.2);
  assert.equal(updates[0].patch.settore, "B");

  const schedaData = JSON.parse(String(updates[0].patch.schedaData));
  assert.equal(schedaData.affidabilitaStratigrafica, "Buona");
});
