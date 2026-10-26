/**
 * Controllo incrociato scheda US ↔ documentazione esterna (schede materiali, ecc.).
 *
 * POST /api/cantieri/:cid/us/crosscheck/prepare   → carica il documento, lo divide in pagine, consiglia la dimensione dei blocchi
 * POST /api/cantieri/:cid/us/crosscheck/analyze   → analizza un intervallo di pagine con l'AI e confronta con le schede US
 * POST /api/cantieri/:cid/us/crosscheck/apply     → applica alle schede US solo le proposte accettate
 */
import type { Express, Request, Response } from "express";
import type multer from "multer";
import type { WithProject, ProjectContext } from "./types";
import { usCodeKey } from "@shared/normalize_us_code";
import { AI_PROVIDER, callAI } from "../ai";
import { buildCrosscheckPatch, normalizeCrosscheckEntry } from "../ai_fill";
import { buildUSCrosscheckPrompt } from "../prompts/us_crosscheck_prompt";
import {
  MAX_CHARS_PER_PASS,
  compareWithUS,
  crosscheckFieldLabel,
  extractCrosscheckPages,
  getCrosscheckDocument,
  getCrosscheckFields,
  recommendPagesPerPass,
  storeCrosscheckDocument,
  type CrosscheckFound,
  type CrosscheckPreset,
  type CrosscheckUSResult,
} from "../us_crosscheck";

type NonPresente = { codiceUS: string; riepilogo: string[] };

function parseJsonObject(raw: string): Record<string, unknown> {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parsePageNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : parseInt(String(value ?? "").replace(/\D+/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function describeValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "sì" : "no";
  if (Array.isArray(value)) return value.join(", ");
  return String(value ?? "");
}

export function registerUSCrosscheckRoutes(app: Express, upload: multer.Multer, withProject: WithProject): void {
  app.post(
    "/api/cantieri/:cid/us/crosscheck/prepare",
    upload.single("documento"),
    withProject(async (_ctx: ProjectContext, req: Request, res: Response) => {
      const file = (req as any).file as Express.Multer.File | undefined;
      const fs = await import("fs");
      try {
        if (!file) return res.status(400).json({ error: "Nessun file ricevuto" });
        let buf: Buffer;
        try {
          buf = fs.readFileSync(file.path);
        } finally {
          try { fs.unlinkSync(file.path); } catch { /* ignore */ }
        }

        const originalName = Buffer.from(file.originalname, "latin1").toString("utf8");
        const { pages, pageKind, warnings } = await extractCrosscheckPages(originalName, buf);
        const doc = storeCrosscheckDocument({ name: originalName, pages, pageKind, warnings });
        const totalChars = pages.reduce((sum, p) => sum + p.length, 0);

        return res.json({
          docId: doc.id,
          nome: doc.name,
          totalePagine: pages.length,
          tipoPagine: pageKind,
          totaleCaratteri: totalChars,
          consiglio: recommendPagesPerPass(pages, AI_PROVIDER),
          avvisi: warnings,
        });
      } catch (e: any) {
        try { if (file?.path) (await import("fs")).unlinkSync(file.path); } catch { /* ignore */ }
        return res.status(400).json({ error: e?.message || "Errore nella lettura del documento" });
      }
    }),
  );

  app.post(
    "/api/cantieri/:cid/us/crosscheck/analyze",
    withProject(async (ctx: ProjectContext, req: Request, res: Response) => {
      const cid = Number(req.params.cid);
      const body = (req.body || {}) as {
        docId?: string;
        da?: number;
        a?: number;
        preset?: CrosscheckPreset;
        note?: string;
      };

      const doc = body.docId ? getCrosscheckDocument(body.docId) : undefined;
      if (!doc) {
        return res.status(404).json({ error: "Documento non più disponibile (sessione scaduta o server riavviato): ricaricalo." });
      }

      const total = doc.pages.length;
      const da = Math.max(1, Math.min(total, Math.floor(Number(body.da) || 1)));
      const a = Math.max(da, Math.min(total, Math.floor(Number(body.a) || da)));
      const preset: CrosscheckPreset = body.preset === "tutti" ? "tutti" : "materiali";

      const testo = doc.pages
        .slice(da - 1, a)
        .map((p, i) => `[[Pagina ${da + i}]]\n${p}`)
        .join("\n\n");
      if (testo.length > MAX_CHARS_PER_PASS) {
        return res.status(400).json({
          error: `L'intervallo scelto contiene troppo testo (${testo.length} caratteri, massimo ${MAX_CHARS_PER_PASS}): riduci il numero di pagine.`,
        });
      }

      const prompt = buildUSCrosscheckPrompt({ testo, fields: getCrosscheckFields(preset), note: body.note });
      let raw: string;
      try {
        raw = await callAI(prompt, 8000, "Sei un assistente archeologico esperto nel controllo della documentazione di scavo.");
      } catch (e: any) {
        return res.status(502).json({ error: `Errore AI: ${e?.message || "sconosciuto"}` });
      }

      const parsed = parseJsonObject(raw);
      const rawUs = Array.isArray(parsed.us) ? (parsed.us as unknown[]) : [];
      const avvisi: string[] = [];
      if (!rawUs.length && !raw.includes("{")) {
        avvisi.push("La risposta dell'AI non era nel formato atteso: riprova o riduci l'intervallo di pagine.");
      }

      // Raggruppa per codice (la stessa US può comparire più volte nel blocco)
      const byKey = new Map<string, { codiceUS: string; found: Map<string, CrosscheckFound> }>();
      for (const entry of rawUs) {
        if (!entry || typeof entry !== "object") continue;
        const rec = entry as Record<string, unknown>;
        const codiceUS = String(rec.codiceUS || "").trim();
        const key = usCodeKey(codiceUS);
        if (!codiceUS || !key) continue;
        const campi = rec.campi && typeof rec.campi === "object" && !Array.isArray(rec.campi)
          ? (rec.campi as Record<string, unknown>)
          : {};

        const slot = byKey.get(key) ?? { codiceUS, found: new Map<string, CrosscheckFound>() };
        for (const [rawKey, rawValue] of Object.entries(campi)) {
          const norm = normalizeCrosscheckEntry(rawKey, rawValue);
          if (!norm) continue;
          const pagina = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
            ? parsePageNumber((rawValue as Record<string, unknown>).pagina)
            : null;
          const prev = slot.found.get(norm.key);
          // Se lo stesso campo compare più volte, i testi si accumulano; i checkbox restano veri
          if (prev && typeof prev.value === "string" && typeof norm.entry.value === "string" && prev.value !== norm.entry.value) {
            prev.value = `${prev.value}; ${norm.entry.value}`;
          } else if (!prev) {
            slot.found.set(norm.key, {
              key: norm.key,
              value: norm.entry.value,
              confidence: norm.entry.confidence,
              source: norm.entry.source,
              pagina,
            });
          }
        }
        byKey.set(key, slot);
      }

      const esistenti = ctx.storage.getUSList(cid);
      const risultati: CrosscheckUSResult[] = [];
      const nonPresenti: NonPresente[] = [];

      byKey.forEach((slot, key) => {
        const found = Array.from(slot.found.values());
        if (!found.length) return;
        const us = esistenti.find((u) => usCodeKey(u.codiceUS) === key);
        if (!us) {
          nonPresenti.push({
            codiceUS: slot.codiceUS,
            riepilogo: found.map((f) => `${crosscheckFieldLabel(f.key)}: ${describeValue(f.value)}`),
          });
          return;
        }
        risultati.push(compareWithUS(us, found));
      });

      risultati.sort((x, y) => x.codiceUS.localeCompare(y.codiceUS, "it", { numeric: true }));

      return res.json({
        da,
        a,
        totalePagine: total,
        prossimaDa: a < total ? a + 1 : null,
        risultati,
        nonPresenti,
        avvisi,
      });
    }),
  );

  app.post(
    "/api/cantieri/:cid/us/crosscheck/apply",
    withProject((ctx: ProjectContext, req: Request, res: Response) => {
      const cid = Number(req.params.cid);
      const body = (req.body || {}) as { items?: Array<{ usId: number; campi: Record<string, unknown> }> };
      const items = Array.isArray(body.items) ? body.items : [];

      let aggiornate = 0;
      let campiApplicati = 0;
      const errori: Array<{ usId: number; errore: string }> = [];

      for (const item of items) {
        try {
          const us = ctx.storage.getUS(Number(item.usId));
          if (!us || us.cantiereId !== cid) {
            errori.push({ usId: Number(item.usId), errore: "US non trovata in questo cantiere" });
            continue;
          }
          const campi = item.campi && typeof item.campi === "object" ? item.campi : {};
          if (!Object.keys(campi).length) continue;
          const patch = buildCrosscheckPatch(us, campi);
          ctx.storage.updateUS(us.id, patch);
          aggiornate++;
          campiApplicati += Object.keys(campi).length;
        } catch (e: any) {
          errori.push({ usId: Number(item.usId), errore: e?.message || "Errore sconosciuto" });
        }
      }

      return res.json({ aggiornate, campiApplicati, errori });
    }),
  );
}
