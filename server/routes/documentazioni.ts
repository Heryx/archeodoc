import type { Express } from "express";
import fs from "fs";
import path from "path";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { insertImageIntoDocx } from "../docx_image_insert";
import { generateRelazioneTesto, usKey, usLabel } from "../relazione_generate";
import { generaBlocco, normalizeFonti } from "../relazione_blocco";
import { MODELLI_BUILTIN, applyPlaceholders, clearAiBlocks, findBuiltin, placeholderValues } from "../relazione_modelli";
import { buildRelazioneDocx, type PmNode, type RelazioneIntestazione } from "../relazione_export";
import type { WithProject } from "./types";

type DocumentazioneTipo = "giornaliera" | "settimanale" | "mensile" | "fine_scavo";

type RegisterDocumentazioniHelpers = {
  withProject: WithProject;
  resolvePathInside: (baseDir: string, relativePath: string) => string | null;
};

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function parseDocumentazioneTipo(value: unknown): DocumentazioneTipo | null {
  if (value === "giornaliera" || value === "settimanale" || value === "mensile" || value === "fine_scavo") return value;
  return null;
}

function parseOptionalDate(value: unknown): string | null {
  const text = String(value || "").trim();
  if (!text) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function sanitizeSlug(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "documentazione";
}

function encodeUploadPath(relativePath: string): string {
  return relativePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function documentazioneTipoLabel(tipo: DocumentazioneTipo): string {
  if (tipo === "giornaliera") return "Documentazione giornaliera";
  if (tipo === "settimanale") return "Documentazione settimanale";
  if (tipo === "mensile") return "Documentazione mensile";
  return "Documentazione fine scavo";
}

function defaultTitolo(tipo: DocumentazioneTipo, dataInizio: string | null, dataFine: string | null): string {
  if (tipo === "giornaliera") {
    return dataInizio ? `Giornata ${dataInizio}` : "Giornata";
  }
  if (tipo === "settimanale") {
    if (dataInizio && dataFine) return `Settimana ${dataInizio} - ${dataFine}`;
    if (dataInizio) return `Settimana da ${dataInizio}`;
    return "Settimana";
  }
  if (tipo === "mensile") return dataInizio ? `Mese ${dataInizio.slice(0, 7)}` : "Mese";
  if (dataInizio && dataFine) return `Fine scavo ${dataInizio} - ${dataFine}`;
  if (dataInizio) return `Fine scavo ${dataInizio}`;
  return "Fine scavo";
}

async function buildBaseDocumentazioneDocx(input: {
  tipo: DocumentazioneTipo;
  titolo: string;
  cantiereNome: string;
  cantiereCodice: string;
  dataInizio: string | null;
  dataFine: string | null;
  snapshotCount: number;
}): Promise<Buffer> {
  const subtitleParts: string[] = [];
  if (input.dataInizio) subtitleParts.push(`Inizio: ${input.dataInizio}`);
  if (input.dataFine) subtitleParts.push(`Fine: ${input.dataFine}`);

  const doc = new Document({
    creator: "ArcheoDoc",
    title: input.titolo,
    description: `${documentazioneTipoLabel(input.tipo)} - ${input.cantiereNome}`,
    sections: [
      {
        children: [
          new Paragraph({
            text: documentazioneTipoLabel(input.tipo),
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            children: [new TextRun({ text: input.titolo, bold: true, size: 30 })],
          }),
          new Paragraph({ text: `Cantiere: ${input.cantiereNome} (${input.cantiereCodice || "-"})` }),
          new Paragraph({ text: subtitleParts.join("  |  ") || "Periodo non specificato" }),
          new Paragraph({ text: `Snapshot collegati: ${input.snapshotCount}` }),
          new Paragraph({ text: `Generato il ${new Date().toLocaleString("it-IT")}` }),
          new Paragraph({ text: "" }),
          new Paragraph({
            children: [new TextRun({ text: "Figure cartografiche", bold: true })],
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({ text: "" }),
        ],
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

function computeImageSizeEmu(width: number | null, height: number | null): { widthEmu: number; heightEmu: number } {
  const targetWidthCm = 15;
  const minHeightCm = 6;
  const maxHeightCm = 18;
  const ratio = width && height && width > 0 && height > 0 ? width / height : 16 / 9;
  const computedHeightCm = Math.max(minHeightCm, Math.min(maxHeightCm, targetWidthCm / Math.max(0.2, ratio)));
  return {
    widthEmu: Math.round(targetWidthCm * 360_000),
    heightEmu: Math.round(computedHeightCm * 360_000),
  };
}

// ID delle US richiamate (mark "usLink") nel contenuto JSON di un documento
function collectUsLinks(contenuto: string | null): number[] {
  if (!contenuto) return [];
  let root: PmNode | null = null;
  try { root = JSON.parse(contenuto); } catch { return []; }
  const found = new Set<number>();
  const visit = (node: PmNode | null | undefined) => {
    if (!node) return;
    for (const mark of node.marks || []) {
      const id = Number(mark.attrs?.usId);
      if (mark.type === "usLink" && Number.isFinite(id)) found.add(id);
    }
    (node.content || []).forEach(visit);
  };
  visit(root);
  return Array.from(found);
}

export function registerDocumentazioniRoutes(app: Express, helpers: RegisterDocumentazioniHelpers) {
  const { withProject, resolvePathInside } = helpers;

  app.get("/api/cantieri/:cid/documentazioni", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const rows = ctx.storage.getDocumentazioni(cid).map((doc) => {
      const allegato = doc.allegatoId ? ctx.storage.getAllegato(doc.allegatoId) : undefined;
      return {
        ...doc,
        allegato: allegato
          ? {
              id: allegato.id,
              nomeFile: allegato.nomeFile,
              url: `/uploads/${encodeUploadPath(allegato.percorso)}?projectId=${encodeURIComponent(ctx.project.id)}`,
            }
          : null,
      };
    });

    res.json({ documentazioni: rows });
  }));

  app.post("/api/cantieri/:cid/documentazioni", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const tipo = parseDocumentazioneTipo(req.body?.tipo);
    if (!tipo) return res.status(400).json({ error: "Tipo documentazione non valido" });

    const dataInizio = parseOptionalDate(req.body?.dataInizio);
    const dataFine = parseOptionalDate(req.body?.dataFine);
    const titoloRaw = String(req.body?.titolo || "").trim();
    const titolo = titoloRaw || defaultTitolo(tipo, dataInizio, dataFine);

    // Con un modello il documento nasce già strutturato (titoli, testo fisso, blocchi IA da compilare)
    let contenuto: string | null = null;
    let intestazione: string | null = null;
    const modelloId = String(req.body?.modello ?? "").trim();
    if (modelloId) {
      let struttura: PmNode | null = null;
      if (modelloId.startsWith("builtin:")) {
        struttura = findBuiltin(modelloId)?.contenuto ?? null;
      } else {
        const saved = ctx.storage.getModelloElaborato(Number(modelloId));
        if (saved) {
          try { struttura = JSON.parse(saved.contenuto); } catch { struttura = null; }
          intestazione = saved.intestazione;
        }
      }
      if (!struttura) return res.status(400).json({ error: "Modello non trovato" });
      contenuto = JSON.stringify(applyPlaceholders(struttura, placeholderValues(cantiere, titolo)));
    }

    const created = ctx.storage.createDocumentazione({
      cantiereId: cid,
      tipo,
      titolo,
      dataInizio,
      dataFine,
      stato: "bozza",
      allegatoId: null,
      contenuto,
      intestazione,
    });

    res.json({ documentazione: created });
  }));

  app.get("/api/cantieri/:cid/documentazioni/:id", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const docId = Number(req.params.id);

    const doc = ctx.storage.getDocumentazione(docId);
    if (!doc || doc.cantiereId !== cid) {
      return res.status(404).json({ error: "Documentazione non trovata" });
    }

    const allegato = doc.allegatoId ? ctx.storage.getAllegato(doc.allegatoId) : undefined;
    const links = ctx.storage.getDocumentazioneSnapshots(doc.id);
    const snapshots = links
      .map((link) => {
        const snapshot = ctx.storage.getMapSnapshot(link.snapshotId);
        if (!snapshot || snapshot.cantiereId !== cid) return null;
        return {
          ...link,
          snapshot: {
            ...snapshot,
            url: `/uploads/${encodeUploadPath(snapshot.percorso)}?projectId=${encodeURIComponent(ctx.project.id)}`,
          },
        };
      })
      .filter(Boolean);

    res.json({
      documentazione: {
        ...doc,
        allegato: allegato
          ? {
              id: allegato.id,
              nomeFile: allegato.nomeFile,
              url: `/uploads/${encodeUploadPath(allegato.percorso)}?projectId=${encodeURIComponent(ctx.project.id)}`,
            }
          : null,
      },
      snapshots,
    });
  }));

  // Genera il testo dal giornale di scavo (con o senza IA); l'inserimento nel documento lo fa il client
  app.post("/api/cantieri/:cid/documentazioni/genera-testo", withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const da = parseOptionalDate(req.body?.da);
    const a = parseOptionalDate(req.body?.a);
    const giornate = ctx.storage
      .getGiornate(cid)
      .filter((g) => (!da || g.data >= da) && (!a || g.data <= a))
      .sort((x, y) => x.data.localeCompare(y.data));

    try {
      const result = await generateRelazioneTesto({
        cantiere,
        giornate,
        usList: ctx.storage.getUSList(cid),
        useAI: req.body?.useAI === true,
        includiUS: req.body?.includiUS !== false,
      });
      res.json({ ...result, giornate: giornate.length });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Errore nella generazione del testo" });
    }
  }));

  // Compila un blocco IA dell'editor: prompt + fonti scelte (US, giornale, periodi…); l'inserimento lo fa il client
  app.post("/api/cantieri/:cid/documentazioni/genera-blocco", withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const fonti = normalizeFonti(req.body?.fonti);
    if (fonti.giornate === "documento") {
      // Periodo del documento che contiene il blocco; senza date si usano tutte le giornate
      const doc = ctx.storage.getDocumentazione(Number(req.body?.docId));
      if (doc && doc.cantiereId === cid && (doc.dataInizio || doc.dataFine)) {
        fonti.da = doc.dataInizio;
        fonti.a = doc.dataFine || doc.dataInizio;
        fonti.giornate = "periodo";
      } else {
        fonti.giornate = "tutte";
      }
    }
    const giornate = fonti.giornate === "nessuna"
      ? []
      : ctx.storage
          .getGiornate(cid)
          .filter((g) => fonti.giornate === "tutte" || ((!fonti.da || g.data >= fonti.da) && (!fonti.a || g.data <= fonti.a)))
          .sort((x, y) => x.data.localeCompare(y.data));

    try {
      const result = await generaBlocco({
        cantiere,
        prompt: String(req.body?.prompt || ""),
        fonti,
        useAI: req.body?.useAI === true,
        usList: ctx.storage.getUSList(cid),
        giornate,
        periodi: fonti.periodi ? ctx.storage.getPeriodi(cid) : [],
        reperti: fonti.reperti ? ctx.storage.getRaRecords(cid) : [],
        saggi: fonti.saggi ? ctx.storage.getSasRecords(cid) : [],
      });
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Errore nella generazione del blocco" });
    }
  }));

  // Modelli di elaborato: predefiniti (nel codice) e salvati dall'utente (condivisi tra i cantieri del progetto)
  app.get("/api/modelli-elaborato", withProject((ctx, _req, res) => {
    res.json({
      builtin: MODELLI_BUILTIN.map(({ id, nome, descrizione }) => ({ id, nome, descrizione })),
      custom: ctx.storage.getModelliElaborato().map(({ id, nome, descrizione }) => ({ id: String(id), nome, descrizione })),
    });
  }));

  app.post("/api/modelli-elaborato", withProject((ctx, req, res) => {
    const nome = String(req.body?.nome || "").trim();
    if (!nome) return res.status(400).json({ error: "Dai un nome al modello" });
    const contenuto = req.body?.contenuto as PmNode | undefined;
    if (!contenuto || contenuto.type !== "doc") return res.status(400).json({ error: "Contenuto del modello non valido" });
    const descrizione = String(req.body?.descrizione || "").trim() || null;
    const intestazione = req.body?.intestazione == null ? null : JSON.stringify(req.body.intestazione);
    const created = ctx.storage.createModelloElaborato({
      nome,
      descrizione,
      contenuto: JSON.stringify(clearAiBlocks(contenuto)),
      intestazione,
    });
    res.json({ modello: { id: String(created.id), nome: created.nome, descrizione: created.descrizione } });
  }));

  app.delete("/api/modelli-elaborato/:id", withProject((ctx, req, res) => {
    if (!ctx.storage.deleteModelloElaborato(Number(req.params.id))) return res.status(404).json({ error: "Modello non trovato" });
    res.json({ ok: true });
  }));

  // Grafo: documenti e US collegate; con ?stratigrafia=1 tutte le US e le loro relazioni
  app.get("/api/cantieri/:cid/relazioni-grafo", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const withStrat = req.query.stratigrafia === "1";
    const usList = ctx.storage.getUSList(cid);
    const usById = new Map(usList.map((u) => [u.id, u]));
    const usByKey = new Map<string, number>();
    for (const u of usList) {
      const key = usKey(u.codiceUS, u.tipo);
      if (key && !usByKey.has(key)) usByKey.set(key, u.id);
    }

    type GNode = { id: string; kind: "doc" | "us"; label: string; sub: string | null; ref: number };
    type GEdge = { from: string; to: string; kind: "cita" | "copre" | "si_lega_a" | "uguale_a" };
    const nodes = new Map<string, GNode>();
    const edges: GEdge[] = [];
    const addUs = (id: number) => {
      const u = usById.get(id);
      if (!u) return null;
      const nid = `u${id}`;
      if (!nodes.has(nid)) {
        nodes.set(nid, { id: nid, kind: "us", label: usLabel(u), sub: u.definizione || u.tipo || null, ref: id });
      }
      return nid;
    };

    for (const doc of ctx.storage.getDocumentazioni(cid)) {
      const targets = collectUsLinks(doc.contenuto).map(addUs).filter((x): x is string => !!x);
      if (targets.length === 0 && !withStrat) continue;
      const nid = `d${doc.id}`;
      nodes.set(nid, { id: nid, kind: "doc", label: doc.titolo, sub: doc.stato, ref: doc.id });
      targets.forEach((t) => edges.push({ from: nid, to: t, kind: "cita" }));
    }

    if (withStrat) {
      usList.forEach((u) => addUs(u.id));
      const seen = new Set<string>();
      const parseTargets = (raw: string | null) =>
        String(raw || "")
          .split(/[,;/\n]+/)
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => {
            const m = /^(US|T|SB|SF)?\.?\s?(\d{1,4})$/i.exec(t);
            if (!m) return null;
            const direct = usByKey.get(`${(m[1] || "US").toUpperCase()}:${Number(m[2])}`);
            return direct ?? null;
          })
          .filter((x): x is number => x != null);
      const link = (a: number, b: number, kind: GEdge["kind"]) => {
        if (a === b) return;
        const symmetric = kind !== "copre";
        const key = symmetric ? `${kind}:${Math.min(a, b)}:${Math.max(a, b)}` : `${kind}:${a}:${b}`;
        if (seen.has(key)) return;
        seen.add(key);
        edges.push({ from: `u${a}`, to: `u${b}`, kind });
      };
      for (const u of usList) {
        parseTargets(u.copre).forEach((t) => link(u.id, t, "copre"));
        parseTargets(u.coperto_da).forEach((t) => link(t, u.id, "copre"));
        parseTargets(u.si_lega_a).forEach((t) => link(u.id, t, "si_lega_a"));
        parseTargets(u.uguale_a).forEach((t) => link(u.id, t, "uguale_a"));
      }
    }

    res.json({ nodes: Array.from(nodes.values()), edges });
  }));

  // Backlink: per ogni US, i documenti che la richiamano con un [[link]]
  app.get("/api/cantieri/:cid/relazioni-links", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const links: Record<number, { id: number; titolo: string }[]> = {};
    for (const doc of ctx.storage.getDocumentazioni(cid)) {
      for (const usId of collectUsLinks(doc.contenuto)) {
        (links[usId] ||= []).push({ id: doc.id, titolo: doc.titolo });
      }
    }
    res.json({ links });
  }));

  app.patch("/api/cantieri/:cid/documentazioni/:id", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const docId = Number(req.params.id);
    const doc = ctx.storage.getDocumentazione(docId);
    if (!doc || doc.cantiereId !== cid) {
      return res.status(404).json({ error: "Documentazione non trovata" });
    }

    const patch: Record<string, unknown> = {};
    const body = req.body || {};
    if (typeof body.titolo === "string" && body.titolo.trim()) patch.titolo = body.titolo.trim();
    if ("dataInizio" in body) patch.dataInizio = parseOptionalDate(body.dataInizio);
    if ("dataFine" in body) patch.dataFine = parseOptionalDate(body.dataFine);
    if (body.stato === "bozza" || body.stato === "completata") patch.stato = body.stato;
    if ("contenuto" in body) {
      patch.contenuto = body.contenuto == null ? null : JSON.stringify(body.contenuto);
    }
    if ("intestazione" in body) {
      patch.intestazione = body.intestazione == null ? null : JSON.stringify(body.intestazione);
    }

    const updated = ctx.storage.updateDocumentazione(docId, patch);
    res.json({ documentazione: updated });
  }));

  app.delete("/api/cantieri/:cid/documentazioni/:id", withProject((ctx, req, res) => {
    const cid = Number(req.params.cid);
    const docId = Number(req.params.id);

    const doc = ctx.storage.getDocumentazione(docId);
    if (!doc || doc.cantiereId !== cid) {
      return res.status(404).json({ error: "Documentazione non trovata" });
    }

    const deleted = ctx.storage.deleteDocumentazione(docId);
    if (!deleted) return res.status(404).json({ error: "Documentazione non trovata" });

    res.json({ ok: true });
  }));

  app.post("/api/documentazioni/:id/snapshots", withProject((ctx, req, res) => {
    const docId = Number(req.params.id);
    const doc = ctx.storage.getDocumentazione(docId);
    if (!doc) return res.status(404).json({ error: "Documentazione non trovata" });

    const snapshotId = Number(req.body?.snapshotId);
    if (!Number.isFinite(snapshotId)) {
      return res.status(400).json({ error: "snapshotId obbligatorio" });
    }

    const snapshot = ctx.storage.getMapSnapshot(snapshotId);
    if (!snapshot || snapshot.cantiereId !== doc.cantiereId) {
      return res.status(400).json({ error: "Snapshot non valido per la documentazione" });
    }

    const posizioneInput = Number(req.body?.posizione);
    const current = ctx.storage.getDocumentazioneSnapshots(docId);
    const maxPosizione = current.reduce((max, item) => Math.max(max, Number(item.posizione || 0)), 0);
    const posizione = Number.isFinite(posizioneInput) ? Math.trunc(posizioneInput) : maxPosizione + 10;

    const created = ctx.storage.addDocumentazioneSnapshot({
      documentazioneId: docId,
      snapshotId,
      posizione,
    });

    res.json({ documentazioneSnapshot: created });
  }));

  app.patch("/api/documentazioni/:id/snapshots/:sid", withProject((ctx, req, res) => {
    const docId = Number(req.params.id);
    const snapshotId = Number(req.params.sid);

    const doc = ctx.storage.getDocumentazione(docId);
    if (!doc) return res.status(404).json({ error: "Documentazione non trovata" });

    const posizione = Number(req.body?.posizione);
    if (!Number.isFinite(posizione)) {
      return res.status(400).json({ error: "posizione obbligatoria" });
    }

    const updated = ctx.storage.updateDocumentazioneSnapshotPosition(docId, snapshotId, Math.trunc(posizione));
    if (!updated) return res.status(404).json({ error: "Collegamento snapshot non trovato" });

    res.json({ documentazioneSnapshot: updated });
  }));

  app.delete("/api/documentazioni/:id/snapshots/:sid", withProject((ctx, req, res) => {
    const docId = Number(req.params.id);
    const snapshotId = Number(req.params.sid);

    const doc = ctx.storage.getDocumentazione(docId);
    if (!doc) return res.status(404).json({ error: "Documentazione non trovata" });

    const deleted = ctx.storage.removeDocumentazioneSnapshot(docId, snapshotId);
    if (!deleted) return res.status(404).json({ error: "Collegamento snapshot non trovato" });

    res.json({ ok: true });
  }));

  app.post("/api/documentazioni/:id/genera-docx", withProject(async (ctx, req, res) => {
    const docId = Number(req.params.id);
    const doc = ctx.storage.getDocumentazione(docId);
    if (!doc) return res.status(404).json({ error: "Documentazione non trovata" });

    const cantiere = ctx.storage.getCantiere(doc.cantiereId);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const warnings: string[] = [];
    let buffer: Buffer;

    if (doc.contenuto) {
      // Documento scritto nell'editor: export dal contenuto strutturato
      let contenuto: PmNode | null = null;
      let intestazione: RelazioneIntestazione | null = null;
      try { contenuto = JSON.parse(doc.contenuto); } catch { /* contenuto non valido */ }
      try { intestazione = doc.intestazione ? JSON.parse(doc.intestazione) : null; } catch { /* ignora */ }

      const built = await buildRelazioneDocx({
        titolo: doc.titolo,
        contenuto,
        intestazione,
        loadSnapshot: (snapshotId) => {
          const snapshot = ctx.storage.getMapSnapshot(snapshotId);
          if (!snapshot || snapshot.cantiereId !== doc.cantiereId) return null;
          const type = snapshot.mimeType === "image/jpeg" ? "jpg" : snapshot.mimeType === "image/png" ? "png" : null;
          const filePath = resolvePathInside(ctx.project.mediaDir, snapshot.percorso);
          if (!type || !filePath || !fs.existsSync(filePath)) return null;
          return { buffer: fs.readFileSync(filePath), type, width: snapshot.width, height: snapshot.height };
        },
      });
      buffer = built.buffer;
      warnings.push(...built.warnings);
    } else {
      const links = ctx.storage.getDocumentazioneSnapshots(doc.id);
      if (links.length === 0) {
        return res.status(400).json({ error: "Documento vuoto: scrivi del contenuto o collega uno snapshot" });
      }
      buffer = await buildBaseDocumentazioneDocx({
        tipo: doc.tipo as DocumentazioneTipo,
        titolo: doc.titolo,
        cantiereNome: cantiere.nome,
        cantiereCodice: cantiere.codice,
        dataInizio: doc.dataInizio,
        dataFine: doc.dataFine,
        snapshotCount: links.length,
      });

      for (const link of links) {
        const snapshot = ctx.storage.getMapSnapshot(link.snapshotId);
        if (!snapshot) {
          warnings.push(`Snapshot ${link.snapshotId} non trovato`);
          continue;
        }

        const snapshotPath = resolvePathInside(ctx.project.mediaDir, snapshot.percorso);
        if (!snapshotPath || !fs.existsSync(snapshotPath)) {
          warnings.push(`File snapshot mancante: ${snapshot.titolo}`);
          continue;
        }

        const mimeType = snapshot.mimeType === "image/jpeg" ? "image/jpeg" : snapshot.mimeType === "image/png" ? "image/png" : null;
        if (!mimeType) {
          warnings.push(`Snapshot non supportato in DOCX (usa PNG/JPEG): ${snapshot.titolo}`);
          continue;
        }

        try {
          const imageBuffer = fs.readFileSync(snapshotPath);
          const size = computeImageSizeEmu(snapshot.width, snapshot.height);
          const inserted = await insertImageIntoDocx({
            docxBuffer: buffer,
            imageBuffer,
            imageMimeType: mimeType,
            title: snapshot.titolo,
            caption: snapshot.didascalia,
            widthEmu: size.widthEmu,
            heightEmu: size.heightEmu,
            afterParagraphIndex: -1,
          });
          buffer = inserted.buffer;
          warnings.push(...inserted.warnings);
        } catch (error: any) {
          warnings.push(`Errore inserimento snapshot ${snapshot.titolo}: ${error?.message || "sconosciuto"}`);
        }
      }
    }

    const baseName = `${doc.tipo}_${sanitizeSlug(doc.titolo)}_${Date.now()}.docx`;
    const relativePath = path.posix.join("_documentazioni", String(doc.cantiereId), baseName);
    const absolutePath = resolvePathInside(ctx.project.mediaDir, relativePath);
    if (!absolutePath) {
      return res.status(400).json({ error: "Percorso output documentazione non valido" });
    }

    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, buffer);

    const previousAttachment = doc.allegatoId ? ctx.storage.getAllegato(doc.allegatoId) : undefined;
    if (previousAttachment && previousAttachment.percorso && previousAttachment.percorso !== relativePath) {
      const oldPath = resolvePathInside(ctx.project.mediaDir, previousAttachment.percorso);
      if (oldPath && fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch {
          // noop
        }
      }
    }

    const nextAttachmentData = {
      cantiereId: doc.cantiereId,
      giornataId: null,
      usId: null,
      tipo: "documento",
      nomeFile: baseName,
      percorso: relativePath,
      mimeType: DOCX_MIME,
      dimensione: buffer.length,
      dataRilievo: doc.dataInizio,
      operatore: null,
      descrizione: `${documentazioneTipoLabel(doc.tipo as DocumentazioneTipo)}: ${doc.titolo}`,
      coordX: null,
      coordY: null,
      quota: null,
      descrizionAi: null,
    };

    const allegato = previousAttachment
      ? ctx.storage.updateAllegato(previousAttachment.id, nextAttachmentData)
      : ctx.storage.createAllegato(nextAttachmentData);

    if (!allegato) {
      return res.status(500).json({ error: "Errore salvataggio allegato documentazione" });
    }

    const updated = ctx.storage.updateDocumentazione(doc.id, {
      allegatoId: allegato.id,
      stato: "completata",
    });

    res.json({
      ok: true,
      warnings,
      documentazione: updated,
      allegato: {
        ...allegato,
        url: `/uploads/${encodeUploadPath(allegato.percorso)}?projectId=${encodeURIComponent(ctx.project.id)}`,
      },
    });
  }));
}
