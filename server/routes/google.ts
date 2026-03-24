import type { Express, Response } from "express";
import type { WithProject } from "./types";
import { logger } from "../logger";
import {
  GOOGLE_REQUIRED_SCOPES,
  assertTokenHasRequiredScopes,
  exchangeCode,
  getAuthUrl,
  getMissingRequiredScopesFromToken,
  hasCredentials,
  hasToken,
  normalizeGoogleError,
  revokeToken,
} from "../google_auth";
import { getDocumentText, mapSectionsToUS, mapSectionsToGiornata } from "../google_docs";
import {
  buildGoogleDocUrl,
  buildGoogleFolderUrl,
  createJournalDocument,
  createProjectFolder,
} from "../google_drive";
import {
  applyGoogleSyncPreview,
  buildGoogleSyncPreview,
  type GoogleSyncDecision,
  type GoogleSyncPreview,
} from "../google_sync";
import { getProjectSchemaDefinition } from "../projects";
import { getUsTopLevelThesaurusFromSchema } from "@shared/us_schema_thesaurus";

function sendGoogleError(
  res: Response,
  error: unknown,
  fallbackMessage: string,
) {
  const normalized = normalizeGoogleError(error, fallbackMessage);
  res.status(normalized.status).json({
    error: normalized.message,
    code: normalized.code,
    missingScopes: normalized.missingScopes,
    requiredScopes: GOOGLE_REQUIRED_SCOPES,
    reauthHint: "Esegui disconnessione Google e poi riconnessione da Impostazioni.",
  });
}

export function registerGoogleRoutes(app: Express, withProject: WithProject) {
  // --- Google Auth status ---
  app.get("/api/google/status", (_req, res) => {
    res.json({
      hasCredentials: hasCredentials(),
      hasToken: hasToken(),
      credentialsPath: process.cwd() + "/credentials.json",
      requiredScopes: GOOGLE_REQUIRED_SCOPES,
      missingScopes: getMissingRequiredScopesFromToken(),
    });
  });

  // --- Avvia il flusso OAuth: redirige al login Google ---
  app.get("/api/google/auth", (_req, res) => {
    try {
      const url = getAuthUrl();
      res.redirect(url);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // --- Callback OAuth: riceve il code e salva il token ---
  app.get("/api/google/callback", async (req, res) => {
    const code = req.query.code as string;
    if (!code) {
      res.status(400).send("Codice mancante");
      return;
    }
    try {
      await exchangeCode(code);
      res.redirect("/?google=connected");
    } catch (e: any) {
      res.status(500).send("Errore autenticazione: " + e.message);
    }
  });

  // --- Revoca token (disconnect) ---
  app.post("/api/google/revoke", (_req, res) => {
    revokeToken();
    res.json({ ok: true });
  });

  // --- Import da Google Docs per una US ---
  app.post("/api/google/import/us", withProject(async (_ctx, req, res) => {
    const { url } = req.body as { url: string };
    if (!url) {
      res.status(400).json({ error: "url obbligatorio" });
      return;
    }
    try {
      assertTokenHasRequiredScopes();
      const { title, text, sections } = await getDocumentText(url);
      const mapped = mapSectionsToUS(sections);
      const hasMappedFields = Object.keys(mapped).length >= 2;

      if (hasMappedFields) {
        res.json({ mode: "structured", title, mapped, text });
      } else {
        res.json({ mode: "ai", title, text, mapped: {} });
      }
    } catch (e: any) {
      logger.error("Import Google Docs US fallito", { err: e.message });
      sendGoogleError(res, e, "Import Google Docs US fallito");
    }
  }));

  // --- Import da Google Docs per una giornata ---
  app.post("/api/google/import/giornata", withProject(async (_ctx, req, res) => {
    const { url } = req.body as { url: string };
    if (!url) {
      res.status(400).json({ error: "url obbligatorio" });
      return;
    }
    try {
      assertTokenHasRequiredScopes();
      const { title, text, sections } = await getDocumentText(url);
      const mapped = mapSectionsToGiornata(sections);
      const hasMappedFields = Object.keys(mapped).length >= 2;

      if (hasMappedFields) {
        res.json({ mode: "structured", title, mapped, text });
      } else {
        res.json({ mode: "ai", title, text, mapped: {} });
      }
    } catch (e: any) {
      logger.error("Import Google Docs giornata fallito", { err: e.message });
      sendGoogleError(res, e, "Import Google Docs giornata fallito");
    }
  }));

  app.post("/api/cantieri/:id/google/setup", withProject(async (ctx, req, res) => {
    const cantiereId = Number(req.params.id);
    const cantiere = ctx.storage.getCantiere(cantiereId);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    if (!hasCredentials()) {
      return res.status(400).json({ error: "credentials.json non trovato. Configura Google OAuth prima del setup." });
    }
    if (!hasToken()) {
      return res.status(400).json({ error: "Account Google non collegato. Esegui prima /api/google/auth." });
    }
    try {
      assertTokenHasRequiredScopes();
    } catch (error) {
      return sendGoogleError(res, error, "Permessi Google non validi");
    }

    const force = req.body?.force === true;
    if (!force && cantiere.googleFolderId && cantiere.googleDocId) {
      return res.json({
        ok: true,
        reused: true,
        folderId: cantiere.googleFolderId,
        docId: cantiere.googleDocId,
        folderUrl: buildGoogleFolderUrl(cantiere.googleFolderId),
        docUrl: buildGoogleDocUrl(cantiere.googleDocId),
      });
    }

    try {
      const folderId = await createProjectFolder(cantiere.nome);
      const docId = await createJournalDocument(cantiere.nome, folderId);
      ctx.storage.updateCantiere(cantiereId, {
        googleFolderId: folderId,
        googleDocId: docId,
      });

      res.json({
        ok: true,
        reused: false,
        folderId,
        docId,
        folderUrl: buildGoogleFolderUrl(folderId),
        docUrl: buildGoogleDocUrl(docId),
      });
    } catch (error: any) {
      logger.error("Google setup cantiere fallito", {
        cantiereId,
        message: error?.message || String(error),
      });
      sendGoogleError(res, error, "Impossibile configurare Google per il cantiere");
    }
  }));

  app.post("/api/cantieri/:id/google/sync", withProject(async (ctx, req, res) => {
    const cantiereId = Number(req.params.id);
    const cantiere = ctx.storage.getCantiere(cantiereId);
    if (!cantiere) return res.status(404).json({ error: "Cantiere non trovato" });

    if (!cantiere.googleDocId) {
      return res.status(400).json({ error: "Cantiere non collegato a Google Docs. Esegui prima il setup." });
    }
    try {
      assertTokenHasRequiredScopes();
    } catch (error) {
      return sendGoogleError(res, error, "Permessi Google non validi");
    }

    const apply = req.body?.apply === true;
    const previewFromClient = req.body?.preview as GoogleSyncPreview | undefined;
    const canReusePreview =
      apply &&
      !!previewFromClient &&
      typeof previewFromClient.docId === "string" &&
      previewFromClient.docId === cantiere.googleDocId &&
      Array.isArray(previewFromClient.items);

    let preview: GoogleSyncPreview;
    try {
      preview = canReusePreview
        ? (previewFromClient as GoogleSyncPreview)
        : await buildGoogleSyncPreview(ctx.storage, cantiereId, cantiere.googleDocId);
    } catch (error) {
      logger.error("Google sync preview fallita", {
        cantiereId,
        message: error instanceof Error ? error.message : String(error),
      });
      return sendGoogleError(res, error, "Errore durante la lettura del documento Google");
    }

    if (!apply) {
      return res.json({
        mode: "preview",
        preview,
      });
    }

    const decisionsRaw =
      req.body?.decisions && typeof req.body.decisions === "object"
        ? (req.body.decisions as Record<string, GoogleSyncDecision>)
        : {};
    const usThesaurus = getUsTopLevelThesaurusFromSchema(getProjectSchemaDefinition(ctx.project.id));

    let report;
    try {
      report = applyGoogleSyncPreview(ctx.storage, cantiere, preview, decisionsRaw, usThesaurus);
    } catch (error) {
      logger.error("Google sync apply fallita", {
        cantiereId,
        message: error instanceof Error ? error.message : String(error),
      });
      return sendGoogleError(res, error, "Errore durante l'applicazione della sincronizzazione");
    }
    const lastSyncAt = new Date().toISOString();
    const lastSyncReport = {
      docId: cantiere.googleDocId,
      preview: {
        giornate: preview.giornate,
        usTotali: preview.usTotali,
        warnings: preview.warnings,
      },
      report,
    };

    ctx.storage.updateCantiere(cantiereId, {
      lastSyncAt,
      lastSyncReport: JSON.stringify(lastSyncReport),
    });

    res.json({
      mode: "applied",
      lastSyncAt,
      report,
      preview: {
        giornate: preview.giornate,
        usTotali: preview.usTotali,
        warnings: preview.warnings,
      },
    });
  }));
}
