import type { Express } from "express";
import multer from "multer";
import type { WithProject } from "./types";
import {
  createProject,
  getCurrentProjectId,
  getProjectById,
  getProjectSchemaDefinition,
  getWorkspaceRoot,
  listDocumentationSchemaPresets,
  listProjects,
  resolveProject,
  setProjectSchemaDefinition,
  setProjectSchemaPreset,
  setCurrentProject,
} from "../projects";
import { createProjectBackup } from "../backups";
import {
  createCustomUSModel,
  deleteCustomUSModel,
  listUSModels,
  updateCustomUSModel,
} from "../us_models";
import { BASE_US_MODEL_KEY } from "@shared/us_models";
import { getEntityFields, normalizeDocumentationSchemaDefinition } from "@shared/documentation_schema";
import {
  suggestUsVocabularyFromProjectDb,
  suggestUsVocabularyFromSqlite,
} from "../thesaurus_suggestions";

export function registerProjectRoutes(app: Express, withProject: WithProject) {
  const thesaurusUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 200 * 1024 * 1024 },
  });

  // Projects management
  app.get("/api/projects", (_req, res) => {
    res.json({
      workspaceRoot: getWorkspaceRoot(),
      currentProjectId: getCurrentProjectId(),
      projects: listProjects(),
      schemaPresets: listDocumentationSchemaPresets(),
    });
  });

  app.get("/api/projects/current", (_req, res) => {
    const current = resolveProject(getCurrentProjectId());
    if (!current) return res.status(404).json({ error: "Nessun progetto disponibile" });
    res.json({ project: current });
  });

  app.get("/api/backup", withProject(async (ctx, _req, res) => {
    try {
      const backup = await createProjectBackup(ctx.project, "manual");
      res.download(backup.filePath, backup.fileName);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Errore creazione backup" });
    }
  }));

  app.post("/api/projects", (req, res) => {
    try {
      const project = createProject({
        name: req.body?.name,
        projectId: req.body?.projectId,
        basePath: req.body?.basePath,
        documentationPresetKey: req.body?.documentationPresetKey,
        documentationMode: req.body?.documentationMode,
      });
      res.json(project);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Errore creazione progetto" });
    }
  });

  app.post("/api/projects/:id/select", (req, res) => {
    try {
      const project = setCurrentProject(req.params.id);
      res.json(project);
    } catch (error: any) {
      res.status(404).json({ error: error.message || "Progetto non trovato" });
    }
  });

  app.get("/api/projects/:id/schema", (req, res) => {
    const project = getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: "Progetto non trovato" });

    try {
      const schema = getProjectSchemaDefinition(project.id);
      res.json({
        project,
        schema,
        presets: listDocumentationSchemaPresets(),
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Errore caricamento schema progetto" });
    }
  });

  app.post("/api/projects/:id/schema-preset", (req, res) => {
    const presetKey = typeof req.body?.presetKey === "string" ? req.body.presetKey.trim() : "";
    if (!presetKey) {
      return res.status(400).json({ error: "presetKey obbligatorio" });
    }

    try {
      const project = setProjectSchemaPreset(req.params.id, presetKey);
      res.json(project);
    } catch (error: any) {
      const message = error.message || "Errore aggiornamento preset schema";
      if (message.toLowerCase().includes("non trovato")) {
        return res.status(404).json({ error: message });
      }
      res.status(400).json({ error: message });
    }
  });

  app.patch("/api/projects/:id/schema", (req, res) => {
    const project = getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: "Progetto non trovato" });

    const rawSchema =
      req.body && typeof req.body === "object" && "schema" in req.body
        ? (req.body.schema as Record<string, unknown>)
        : (req.body as Record<string, unknown>);

    if (!rawSchema || typeof rawSchema !== "object") {
      return res.status(400).json({ error: "Schema non valido" });
    }

    try {
      const normalized = normalizeDocumentationSchemaDefinition({
        ...(rawSchema as any),
        key: project.schemaKey,
        mode: project.documentationMode,
        exportMode: project.exportMode,
        usModelKey: project.defaultUsModelKey,
      });
      const schema = setProjectSchemaDefinition(project.id, normalized);
      res.json({
        project: getProjectById(project.id),
        schema,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Errore aggiornamento schema progetto" });
    }
  });

  app.post("/api/projects/:id/thesaurus/suggest-db", (req, res) => {
    const project = getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: "Progetto non trovato" });

    const fieldKey = typeof req.body?.fieldKey === "string" ? req.body.fieldKey.trim() : "";
    if (!fieldKey) {
      return res.status(400).json({ error: "fieldKey obbligatorio" });
    }

    try {
      const schema = getProjectSchemaDefinition(project.id);
      const usFields = getEntityFields(schema, "us");
      const exists = usFields.some((field) => field.key === fieldKey);
      if (!exists) {
        return res.status(400).json({ error: `Campo US '${fieldKey}' non presente nello schema progetto` });
      }

      const limit = Number(req.body?.limit || 300);
      const values = suggestUsVocabularyFromProjectDb(project.id, fieldKey, Number.isFinite(limit) ? limit : 300);
      res.json({
        source: "project-db",
        fieldKey,
        values,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Impossibile generare suggerimenti dal DB progetto" });
    }
  });

  app.post("/api/projects/:id/thesaurus/suggest-sqlite", thesaurusUpload.single("file"), (req, res) => {
    const rawProjectId = req.params?.id;
    const projectId = Array.isArray(rawProjectId) ? rawProjectId[0] : rawProjectId;
    const project = getProjectById(String(projectId || ""));
    if (!project) return res.status(404).json({ error: "Progetto non trovato" });

    const fieldKey = typeof req.body?.fieldKey === "string" ? req.body.fieldKey.trim() : "";
    if (!fieldKey) {
      return res.status(400).json({ error: "fieldKey obbligatorio" });
    }

    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({ error: "File SQLite mancante" });
    }

    try {
      const schema = getProjectSchemaDefinition(project.id);
      const usFields = getEntityFields(schema, "us");
      const exists = usFields.some((field) => field.key === fieldKey);
      if (!exists) {
        return res.status(400).json({ error: `Campo US '${fieldKey}' non presente nello schema progetto` });
      }

      const limit = Number(req.body?.limit || 300);
      const suggestion = suggestUsVocabularyFromSqlite({
        fileBuffer: file.buffer,
        fieldKey,
        tableName: typeof req.body?.tableName === "string" ? req.body.tableName.trim() : undefined,
        columnName: typeof req.body?.columnName === "string" ? req.body.columnName.trim() : undefined,
        limit: Number.isFinite(limit) ? limit : 300,
      });

      res.json({
        source: "sqlite",
        fieldKey,
        ...suggestion,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Impossibile generare suggerimenti dal file SQLite" });
    }
  });

  // Modelli US (base, ministeriali, personalizzati)
  app.get("/api/us-models", withProject((ctx, _req, res) => {
    res.json({
      models: listUSModels(ctx.project),
    });
  }));

  app.post("/api/us-models/custom", withProject((ctx, req, res) => {
    try {
      const model = createCustomUSModel(ctx.project, {
        key: req.body?.key,
        name: req.body?.name,
        description: req.body?.description,
        fields: req.body?.fields,
      });
      res.json(model);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Errore creazione modello personalizzato" });
    }
  }));

  app.patch("/api/us-models/custom/:modelKey", withProject((ctx, req, res) => {
    try {
      const modelKey = String(req.params.modelKey || "").trim();
      const model = updateCustomUSModel(ctx.project, modelKey, {
        name: req.body?.name,
        description: req.body?.description,
        fields: req.body?.fields,
      });
      res.json(model);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Errore aggiornamento modello personalizzato" });
    }
  }));

  app.delete("/api/us-models/custom/:modelKey", withProject((ctx, req, res) => {
    const modelKey = String(req.params.modelKey || "").trim();
    const cantieri = ctx.storage.getCantieri();
    const modelInCantieri = cantieri.some((c) => (c.usModelKey || BASE_US_MODEL_KEY) === modelKey);
    if (modelInCantieri) {
      return res.status(409).json({ error: "Modello in uso in almeno un cantiere" });
    }

    const modelInUS = cantieri.some((c) =>
      ctx.storage
        .getUSList(c.id)
        .some((us) => (us.schedaModelKey || c.usModelKey || BASE_US_MODEL_KEY) === modelKey),
    );
    if (modelInUS) {
      return res.status(409).json({ error: "Modello in uso in almeno una scheda US" });
    }

    try {
      deleteCustomUSModel(ctx.project, modelKey);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Errore eliminazione modello personalizzato" });
    }
  }));
}
