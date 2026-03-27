import type { Express } from "express";
import fs from "fs";
import path from "path";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { insertImageIntoDocx } from "../docx_image_insert";
import type { WithProject } from "./types";

type DocumentazioneTipo = "giornaliera" | "settimanale" | "fine_scavo";

type RegisterDocumentazioniHelpers = {
  withProject: WithProject;
  resolvePathInside: (baseDir: string, relativePath: string) => string | null;
};

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function parseDocumentazioneTipo(value: unknown): DocumentazioneTipo | null {
  if (value === "giornaliera" || value === "settimanale" || value === "fine_scavo") return value;
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

    const created = ctx.storage.createDocumentazione({
      cantiereId: cid,
      tipo,
      titolo,
      dataInizio,
      dataFine,
      stato: "bozza",
      allegatoId: null,
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

    const links = ctx.storage.getDocumentazioneSnapshots(doc.id);
    if (links.length === 0) {
      return res.status(400).json({ error: "Nessuno snapshot collegato alla documentazione" });
    }

    const warnings: string[] = [];
    let buffer = await buildBaseDocumentazioneDocx({
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
