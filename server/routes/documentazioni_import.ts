import type { Express } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import {
  anteprimaTesto,
  bindImages,
  buildUsIndex,
  docxToPm,
  linkUs,
  statistiche,
  suggerisciMeta,
} from "../relazione_import";
import type { WithProject } from "./types";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });

const TIPI = ["libero", "giornaliera", "settimanale", "mensile", "fine_scavo"] as const;
type Tipo = (typeof TIPI)[number];

const isoDate = (v: unknown): string | null => {
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

function parseFields(raw: unknown): any {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

// Importa una relazione scritta fuori (Word) come documento dell'editor:
// senza `confirm` restituisce l'anteprima, con `confirm` crea il documento.
export function registerDocumentazioniImportRoutes(app: Express, withProject: WithProject) {
  app.post("/api/cantieri/:cid/documentazioni/importa-docx", upload.single("file"), withProject(async (ctx, req, res) => {
    const cid = Number(req.params.cid);
    const cantiere = ctx.storage.getCantiere(cid);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    const file = req.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ error: "Nessun file ricevuto" });
    // multer legge i nomi come latin1
    const fileName = Buffer.from(file.originalname, "latin1").toString("utf8");
    if (!/\.docx$/i.test(fileName)) return res.status(400).json({ error: "Serve un file Word .docx" });

    let converted;
    try {
      converted = await docxToPm(file.buffer);
    } catch (error: any) {
      return res.status(400).json({ error: `Impossibile leggere il file Word: ${error?.message || "formato non valido"}` });
    }

    const fields = parseFields(req.body?.fields);
    const exclude = new Set<number>(Array.isArray(fields.escludiUs) ? fields.escludiUs.map(Number).filter(Number.isFinite) : []);
    const index = buildUsIndex(ctx.storage.getUSList(cid));
    const { doc: linked, report } = linkUs(converted.doc, index, exclude);

    const confirm = String(req.body?.confirm || "") === "true";
    if (!confirm) {
      const meta = suggerisciMeta({ fileName, doc: converted.doc, giornate: ctx.storage.getGiornate(cid) });
      const avvisi = [...converted.avvisi];
      if (index.size === 0) avvisi.push("Il cantiere non ha ancora US: nessun collegamento possibile. Importa prima le schede US, poi la relazione.");
      return res.json({
        preview: {
          fileName,
          ...meta,
          stats: statistiche(linked, converted.images.length),
          usCollegate: report.collegate,
          usNonTrovate: report.nonTrovate,
          avvisi,
          anteprimaTesto: anteprimaTesto(linked),
        },
      });
    }

    const tipo: Tipo = (TIPI as readonly string[]).includes(fields.tipo) ? fields.tipo : "libero";
    const titolo = String(fields.titolo || "").trim() || fileName.replace(/\.docx$/i, "");
    let dataInizio = isoDate(fields.dataInizio);
    let dataFine = isoDate(fields.dataFine);
    if (dataInizio && dataFine && dataFine < dataInizio) [dataInizio, dataFine] = [dataFine, dataInizio];

    // Le immagini vanno nella cartella "Immagini progetto", da dove l'editor e l'export le leggono
    const stamp = Date.now();
    const names: (string | null)[] = [];
    if (converted.images.length) fs.mkdirSync(ctx.project.imgDir, { recursive: true });
    converted.images.forEach((img, i) => {
      const name = `rel_${stamp}_${i + 1}.${img.ext}`;
      try {
        fs.writeFileSync(path.join(ctx.project.imgDir, name), img.buffer);
        names.push(name);
      } catch {
        names.push(null);
      }
    });

    const created = ctx.storage.createDocumentazione({
      cantiereId: cid,
      tipo,
      titolo,
      dataInizio,
      dataFine,
      stato: "bozza",
      allegatoId: null,
      contenuto: JSON.stringify(bindImages(linked, names)),
      intestazione: null,
    });
    res.json({ documentazione: created, usCollegate: report.collegate.filter((u) => !exclude.has(u.id)).length });
  }));
}
