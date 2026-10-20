import type { Express } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { exec, execFile } from "child_process";
import type { WithProject } from "./types";
import {
  createProject,
  deleteProject,
  getCurrentProjectId,
  getProjectById,
  getProjectContentStats,
  getProjectSchemaDefinition,
  getWorkspaceRoot,
  listDocumentationSchemaPresets,
  listProjects,
  resolveProject,
  setProjectCodeSettings,
  setProjectSchemaDefinition,
  setProjectSchemaFieldVocabulary,
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

  app.post("/api/projects/:id/open-folder", (req, res) => {
    const project = getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: "Progetto non trovato" });

    const folderPath = project.projectRoot;
    const platform = process.platform;
    let cmd: string;
    if (platform === "win32") {
      cmd = `explorer "${folderPath.replace(/\//g, "\\")}"`;
    } else if (platform === "darwin") {
      cmd = `open "${folderPath}"`;
    } else {
      cmd = `xdg-open "${folderPath}"`;
    }

    exec(cmd, (error) => {
      if (error) {
        return res.status(500).json({ error: "Impossibile aprire la cartella: " + error.message });
      }
      res.json({ ok: true, path: folderPath });
    });
  });

  // Opens a native folder-picker dialog and returns the chosen path
  app.post("/api/browse-folder", (req, res) => {
    const initialPath: string =
      typeof req.body?.initialPath === "string" && req.body.initialPath.trim()
        ? req.body.initialPath.trim()
        : getWorkspaceRoot();

    const platform = process.platform;

    if (platform === "win32") {
      const ps = `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Seleziona cartella'
$d.SelectedPath = '${initialPath.replace(/'/g, "''")}'
$d.ShowNewFolderButton = $true
if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }
`.trim();
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { timeout: 60000 }, (err, stdout) => {
        const chosen = stdout.trim();
        if (err || !chosen) return res.json({ cancelled: true });
        res.json({ cancelled: false, path: chosen });
      });
    } else if (platform === "darwin") {
      exec(`osascript -e 'POSIX path of (choose folder with prompt "Seleziona cartella")'`, { timeout: 60000 }, (err, stdout) => {
        const chosen = stdout.trim().replace(/\/$/, "");
        if (err || !chosen) return res.json({ cancelled: true });
        res.json({ cancelled: false, path: chosen });
      });
    } else {
      exec(`zenity --file-selection --directory --title="Seleziona cartella" 2>/dev/null`, { timeout: 60000 }, (err, stdout) => {
        const chosen = stdout.trim();
        if (err || !chosen) return res.json({ cancelled: true });
        res.json({ cancelled: false, path: chosen });
      });
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

  app.put("/api/projects/:id/code-settings", (req, res) => {
    try {
      const body = req.body ?? {};
      const settings = setProjectCodeSettings(req.params.id, {
        tombaStyle: body.tombaStyle,
        flagPrefixMismatch: body.flagPrefixMismatch,
      });
      res.json(settings);
    } catch (error: any) {
      const message = error.message || "Errore salvataggio impostazioni codici";
      res.status(message.toLowerCase().includes("non trovato") ? 404 : 400).json({ error: message });
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

  // Aggiornamento del solo vocabolario controllato di un campo: consentito anche
  // ai progetti ICCD (la struttura resta bloccata, le voci del thesaurus no).
  app.patch("/api/projects/:id/schema/vocabulary", (req, res) => {
    const project = getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: "Progetto non trovato" });

    const entityRaw = typeof req.body?.entity === "string" ? req.body.entity.trim() : "us";
    const entity = (["us", "sas", "ra"] as const).includes(entityRaw as any)
      ? (entityRaw as "us" | "sas" | "ra")
      : "us";
    const fieldKey = typeof req.body?.fieldKey === "string" ? req.body.fieldKey.trim() : "";
    const vocabulary = Array.isArray(req.body?.vocabulary) ? req.body.vocabulary : [];

    if (!fieldKey) {
      return res.status(400).json({ error: "fieldKey obbligatorio" });
    }

    try {
      const schema = setProjectSchemaFieldVocabulary(project.id, entity, fieldKey, vocabulary);
      res.json({ project: getProjectById(project.id), schema });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Errore aggiornamento vocabolario thesaurus" });
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

  // Project content stats (for analysis before deletion)
  app.get("/api/projects/:id/stats", (req, res) => {
    try {
      const stats = getProjectContentStats(req.params.id);
      res.json(stats);
    } catch (error: any) {
      res.status(404).json({ error: error.message || "Errore analisi progetto" });
    }
  });

  // Delete project (with optional file deletion)
  app.delete("/api/projects/:id", (req, res) => {
    const deleteFiles = req.body?.deleteFiles === true;
    try {
      deleteProject(req.params.id, deleteFiles);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Errore eliminazione progetto" });
    }
  });

  // Export project backup
  app.get("/api/projects/:id/backup", async (req, res) => {
    const project = getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: "Progetto non trovato" });
    try {
      const backup = await createProjectBackup(project, "manual");
      res.download(backup.filePath, backup.fileName);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Errore creazione backup" });
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

  // ─── Immagini progetto (img/) ─────────────────────────────────────────────

  const imgUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(file.originalname);
      cb(null, ok);
    },
  });

  app.get("/api/project/img", withProject((ctx, _req, res) => {
    const dir = ctx.project.imgDir;
    if (!fs.existsSync(dir)) return res.json({ files: [] });
    const files = fs.readdirSync(dir)
      .filter((f) => /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f))
      .map((name) => ({ name, url: `/api/project/img/${encodeURIComponent(name)}` }));
    res.json({ files });
  }));

  app.get("/api/project/img/:name", withProject((ctx, req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const filePath = path.join(ctx.project.imgDir, path.basename(name));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Immagine non trovata" });
    res.sendFile(filePath);
  }));

  app.post("/api/project/img", imgUpload.single("file"), withProject((ctx, req, res) => {
    if (!req.file) return res.status(400).json({ error: "Nessun file ricevuto" });
    const ext = path.extname(req.file.originalname) || ".png";
    const baseName = path.basename(req.file.originalname, ext).replace(/[^a-zA-Z0-9_\-]/g, "_");
    const fileName = `${baseName}${ext}`;
    const dest = path.join(ctx.project.imgDir, fileName);
    fs.mkdirSync(ctx.project.imgDir, { recursive: true });
    fs.writeFileSync(dest, req.file.buffer);
    res.json({ name: fileName, url: `/api/project/img/${encodeURIComponent(fileName)}` });
  }));

  app.delete("/api/project/img/:name", withProject((ctx, req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const filePath = path.join(ctx.project.imgDir, path.basename(name));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Immagine non trovata" });
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  }));

  // ─── Template report progetto (templates/) ───────────────────────────────

  const templateUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok = /\.(docx|odt|md|txt)$/i.test(file.originalname);
      cb(null, ok);
    },
  });

  // ─── Helpers indice template ────────────────────────────────────────────────
  function templatesIndexPath(dir: string) { return path.join(dir, "_index.json"); }

  function readTemplatesIndex(dir: string): Record<string, { uso?: string }> {
    const p = templatesIndexPath(dir);
    if (!fs.existsSync(p)) return {};
    try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return {}; }
  }

  function writeTemplatesIndex(dir: string, idx: Record<string, { uso?: string }>) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(templatesIndexPath(dir), JSON.stringify(idx, null, 2));
  }

  app.get("/api/project/templates", withProject((ctx, _req, res) => {
    const dir = ctx.project.templatesDir;
    if (!fs.existsSync(dir)) return res.json({ templates: [] });
    const idx = readTemplatesIndex(dir);
    const templates = fs.readdirSync(dir)
      .filter((f) => /\.(docx|odt|md|txt)$/i.test(f))
      .map((name) => ({
        name,
        label: path.basename(name, path.extname(name)),
        ext: path.extname(name).slice(1),
        uso: idx[name]?.uso || "altro",
        url: `/api/project/templates/${encodeURIComponent(name)}`,
      }));
    res.json({ templates });
  }));

  app.get("/api/project/templates/:name", withProject((ctx, req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const filePath = path.join(ctx.project.templatesDir, path.basename(name));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Template non trovato" });
    res.download(filePath);
  }));

  app.post("/api/project/templates", templateUpload.single("file"), withProject((ctx, req, res) => {
    if (!req.file) return res.status(400).json({ error: "Nessun file ricevuto" });
    const customName = typeof req.body?.name === "string" && req.body.name.trim()
      ? req.body.name.trim()
      : null;
    const uso = typeof req.body?.uso === "string" ? req.body.uso.trim() : "altro";
    const ext = path.extname(req.file.originalname) || ".docx";
    const rawName = customName || path.basename(req.file.originalname, ext);
    const safeName = rawName.replace(/[^a-zA-Z0-9_\-]/g, "_");
    const fileName = `${safeName}${ext}`;
    const dest = path.join(ctx.project.templatesDir, fileName);
    fs.mkdirSync(ctx.project.templatesDir, { recursive: true });
    fs.writeFileSync(dest, req.file.buffer);
    const idx = readTemplatesIndex(ctx.project.templatesDir);
    idx[fileName] = { uso };
    writeTemplatesIndex(ctx.project.templatesDir, idx);
    res.json({ name: fileName, label: safeName, ext: ext.slice(1), uso, url: `/api/project/templates/${encodeURIComponent(fileName)}` });
  }));

  app.patch("/api/project/templates/:name", withProject((ctx, req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const filePath = path.join(ctx.project.templatesDir, path.basename(name));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Template non trovato" });
    const uso = typeof req.body?.uso === "string" ? req.body.uso.trim() : undefined;
    if (uso !== undefined) {
      const idx = readTemplatesIndex(ctx.project.templatesDir);
      idx[name] = { ...idx[name], uso };
      writeTemplatesIndex(ctx.project.templatesDir, idx);
    }
    res.json({ ok: true });
  }));

  app.delete("/api/project/templates/:name", withProject((ctx, req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const filePath = path.join(ctx.project.templatesDir, path.basename(name));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Template non trovato" });
    fs.unlinkSync(filePath);
    const idx = readTemplatesIndex(ctx.project.templatesDir);
    delete idx[name];
    writeTemplatesIndex(ctx.project.templatesDir, idx);
    res.json({ ok: true });
  }));
}
