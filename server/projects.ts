import fs from "fs";
import os from "os";
import path from "path";
import { createStorage, type IStorage } from "./storage";
import {
  DEFAULT_PROJECT_SCHEMA_PRESET_KEY,
  getProjectSchemaDefinitionByKey,
  getProjectSchemaPreset,
  getProjectSchemaPresetForMode,
  normalizeDocumentationSchemaDefinition,
  listProjectSchemaPresets,
  type DocumentationExportMode,
  type DocumentationMode,
  type DocumentationSchemaDefinition,
  type ProjectSchemaPresetSummary,
} from "@shared/documentation_schema";

export type ProjectDefinition = {
  id: string;
  name: string;
  projectRoot: string;
  dbPath: string;
  mediaDir: string;
  exportsDir: string;
  backupsDir: string;
  schedeDir: string;
  diarioDir: string;
  planimetrieDir: string;
  fotoDir: string;
  documentiDir: string;
  qgisDir: string;
  aiConfigDir: string;
  documentationMode: DocumentationMode;
  schemaKey: string;
  exportMode: DocumentationExportMode;
  defaultUsModelKey: string;
  createdAt: string;
  updatedAt: string;
};

type ProjectRegistry = {
  version: number;
  currentProjectId: string | null;
  projects: ProjectDefinition[];
};

type CreateProjectInput = {
  name: string;
  projectId?: string;
  basePath?: string;
  documentationPresetKey?: string;
  documentationMode?: DocumentationMode;
};

const REGISTRY_VERSION = 1;
const STORAGE_CACHE = new Map<string, IStorage>();
const LEGACY_DB_PATH = path.join(process.cwd(), "archeodoc.db");
const LEGACY_DB_WAL = path.join(process.cwd(), "archeodoc.db-wal");
const LEGACY_DB_SHM = path.join(process.cwd(), "archeodoc.db-shm");
const LEGACY_UPLOADS_DIR = path.join(process.cwd(), "uploads");
const PROJECT_SCHEMA_FILENAME = "documentation.schema.json";
let BOOTSTRAPPED = false;

function nowIso(): string {
  return new Date().toISOString();
}

export function getWorkspaceRoot(): string {
  const fromEnv = process.env.ARCHEODOC_WORKSPACE_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), "ArcheoDocProjects");
}

function getRegistryPath(): string {
  return path.join(getWorkspaceRoot(), "projects_registry.json");
}

function ensureDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function safeReadJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function saveRegistry(registry: ProjectRegistry): void {
  const registryPath = getRegistryPath();
  ensureDirectory(path.dirname(registryPath));
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf8");
}

function isDocumentationMode(value: unknown): value is DocumentationMode {
  return value === "iccd" || value === "custom";
}

function isExportMode(value: unknown): value is DocumentationExportMode {
  return value === "iccd_strict" || value === "iccd_extended" || value === "custom";
}

function normalizeProjectId(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 64);

  if (normalized.length > 0) return normalized;
  return `project-${Date.now()}`;
}

function ensureUniqueProjectId(registry: ProjectRegistry, candidate: string): string {
  if (!registry.projects.some((p) => p.id === candidate)) return candidate;

  let i = 2;
  let next = `${candidate}-${i}`;
  while (registry.projects.some((p) => p.id === next)) {
    i += 1;
    next = `${candidate}-${i}`;
  }
  return next;
}

function resolveDocumentationPreset(input: Pick<CreateProjectInput, "documentationPresetKey" | "documentationMode">) {
  if (typeof input.documentationPresetKey === "string" && input.documentationPresetKey.trim()) {
    return getProjectSchemaPreset(input.documentationPresetKey.trim());
  }

  if (isDocumentationMode(input.documentationMode)) {
    return getProjectSchemaPresetForMode(input.documentationMode);
  }

  return getProjectSchemaPreset(DEFAULT_PROJECT_SCHEMA_PRESET_KEY);
}

function createProjectDefinition(
  projectId: string,
  name: string,
  basePath: string,
  documentationPresetKey?: string,
): ProjectDefinition {
  const preset = getProjectSchemaPreset(documentationPresetKey || DEFAULT_PROJECT_SCHEMA_PRESET_KEY);
  const projectRoot = path.join(basePath, projectId);
  return {
    id: projectId,
    name,
    projectRoot,
    dbPath: path.join(projectRoot, "project.sqlite"),
    mediaDir: path.join(projectRoot, "media"),
    exportsDir: path.join(projectRoot, "exports"),
    backupsDir: path.join(projectRoot, "backups"),
    schedeDir: path.join(projectRoot, "schede"),
    diarioDir: path.join(projectRoot, "diario"),
    planimetrieDir: path.join(projectRoot, "planimetrie"),
    fotoDir: path.join(projectRoot, "foto"),
    documentiDir: path.join(projectRoot, "documenti"),
    qgisDir: path.join(projectRoot, "qgis"),
    aiConfigDir: path.join(projectRoot, "ai_config"),
    documentationMode: preset.documentationMode,
    schemaKey: preset.schemaKey,
    exportMode: preset.exportMode,
    defaultUsModelKey: preset.defaultUsModelKey,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function getProjectSchemaPath(project: ProjectDefinition): string {
  return path.join(project.projectRoot, PROJECT_SCHEMA_FILENAME);
}

function writeProjectSchemaFile(project: ProjectDefinition, schema: DocumentationSchemaDefinition): void {
  const schemaPath = getProjectSchemaPath(project);
  fs.writeFileSync(schemaPath, JSON.stringify(normalizeDocumentationSchemaDefinition(schema), null, 2), "utf8");
}

function ensureProjectSchemaFile(project: ProjectDefinition): void {
  const schemaPath = getProjectSchemaPath(project);
  if (fs.existsSync(schemaPath)) return;
  writeProjectSchemaFile(project, getProjectSchemaDefinitionByKey(project.schemaKey));
}

function ensureDefaultAiConfigFiles(project: ProjectDefinition): void {
  const defaults: Record<string, string> = {
    "contesto.md": "Descrivi qui contesto del sito, cronologia e metodologia di scavo.\n",
    "relazione.md": "Descrivi qui come impostare la relazione finale (struttura, stile, standard).\n",
    "schede.md": "Descrivi qui regole e convenzioni per compilare le schede US.\n",
    "stile.md": "Descrivi qui tono, lessico e convenzioni redazionali.\n",
  };

  for (const [file, content] of Object.entries(defaults)) {
    const filePath = path.join(project.aiConfigDir, file);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, "utf8");
    }
  }
}

function ensureProjectStructure(project: ProjectDefinition): void {
  ensureDirectory(project.projectRoot);
  ensureDirectory(project.mediaDir);
  ensureDirectory(project.exportsDir);
  ensureDirectory(project.backupsDir);
  ensureDirectory(project.schedeDir);
  ensureDirectory(project.diarioDir);
  ensureDirectory(project.planimetrieDir);
  ensureDirectory(project.fotoDir);
  ensureDirectory(project.documentiDir);
  ensureDirectory(project.qgisDir);
  ensureDirectory(project.aiConfigDir);
  ensureProjectSchemaFile(project);
  ensureDefaultAiConfigFiles(project);

  const metadataPath = path.join(project.projectRoot, "project.json");
  const metadata = {
    id: project.id,
    name: project.name,
    documentationMode: project.documentationMode,
    schemaKey: project.schemaKey,
    exportMode: project.exportMode,
    defaultUsModelKey: project.defaultUsModelKey,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
}

function isDirEmpty(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) return true;
  return fs.readdirSync(dirPath).length === 0;
}

function copyFileIfExists(source: string, target: string): void {
  if (!fs.existsSync(source)) return;
  ensureDirectory(path.dirname(target));
  fs.copyFileSync(source, target);
}

function migrateLegacyIntoProject(project: ProjectDefinition): void {
  if (fs.existsSync(LEGACY_DB_PATH) && !fs.existsSync(project.dbPath)) {
    copyFileIfExists(LEGACY_DB_PATH, project.dbPath);
    copyFileIfExists(LEGACY_DB_WAL, `${project.dbPath}-wal`);
    copyFileIfExists(LEGACY_DB_SHM, `${project.dbPath}-shm`);
  }

  if (fs.existsSync(LEGACY_UPLOADS_DIR) && isDirEmpty(project.mediaDir)) {
    fs.cpSync(LEGACY_UPLOADS_DIR, project.mediaDir, { recursive: true, force: true });
  }
}

function normalizeProjectDefinition(raw: unknown): ProjectDefinition | null {
  if (!raw || typeof raw !== "object") return null;

  const project = raw as Partial<ProjectDefinition>;
  const id = typeof project.id === "string" ? project.id.trim() : "";
  const name = typeof project.name === "string" ? project.name.trim() : "";
  const projectRoot = typeof project.projectRoot === "string" ? project.projectRoot.trim() : "";
  const dbPath = typeof project.dbPath === "string" ? project.dbPath.trim() : "";
  const mediaDir = typeof project.mediaDir === "string" ? project.mediaDir.trim() : "";
  const exportsDir = typeof project.exportsDir === "string" ? project.exportsDir.trim() : "";
  const backupsDir = typeof project.backupsDir === "string" ? project.backupsDir.trim() : "";
  const schedeDir = typeof project.schedeDir === "string" ? project.schedeDir.trim() : "";
  const diarioDir = typeof project.diarioDir === "string" ? project.diarioDir.trim() : "";
  const planimetrieDir = typeof project.planimetrieDir === "string" ? project.planimetrieDir.trim() : "";
  const fotoDir = typeof project.fotoDir === "string" ? project.fotoDir.trim() : "";
  const documentiDir = typeof project.documentiDir === "string" ? project.documentiDir.trim() : "";
  const qgisDir = typeof project.qgisDir === "string" ? project.qgisDir.trim() : "";
  const aiConfigDir = typeof project.aiConfigDir === "string" ? project.aiConfigDir.trim() : "";

  if (!id || !name || !projectRoot || !dbPath || !mediaDir || !exportsDir || !backupsDir) {
    return null;
  }

  const documentationMode = isDocumentationMode(project.documentationMode) ? project.documentationMode : "custom";
  const fallbackPreset = getProjectSchemaPresetForMode(documentationMode);
  const schemaKey =
    typeof project.schemaKey === "string" && project.schemaKey.trim()
      ? project.schemaKey.trim()
      : fallbackPreset.schemaKey;
  const exportMode = isExportMode(project.exportMode) ? project.exportMode : fallbackPreset.exportMode;
  const defaultUsModelKey =
    typeof project.defaultUsModelKey === "string" && project.defaultUsModelKey.trim()
      ? project.defaultUsModelKey.trim()
      : fallbackPreset.defaultUsModelKey;

  return {
    id,
    name,
    projectRoot,
    dbPath,
    mediaDir,
    exportsDir,
    backupsDir,
    schedeDir: schedeDir || path.join(projectRoot, "schede"),
    diarioDir: diarioDir || path.join(projectRoot, "diario"),
    planimetrieDir: planimetrieDir || path.join(projectRoot, "planimetrie"),
    fotoDir: fotoDir || path.join(projectRoot, "foto"),
    documentiDir: documentiDir || path.join(projectRoot, "documenti"),
    qgisDir: qgisDir || path.join(projectRoot, "qgis"),
    aiConfigDir: aiConfigDir || path.join(projectRoot, "ai_config"),
    documentationMode,
    schemaKey,
    exportMode,
    defaultUsModelKey,
    createdAt: typeof project.createdAt === "string" && project.createdAt ? project.createdAt : nowIso(),
    updatedAt: typeof project.updatedAt === "string" && project.updatedAt ? project.updatedAt : nowIso(),
  };
}

function loadRegistry(): ProjectRegistry {
  const registryPath = getRegistryPath();
  const loaded = safeReadJson<ProjectRegistry>(registryPath);

  if (!loaded || loaded.version !== REGISTRY_VERSION || !Array.isArray(loaded.projects)) {
    return {
      version: REGISTRY_VERSION,
      currentProjectId: null,
      projects: [],
    };
  }

  let changed = false;
  const normalizedProjects: ProjectDefinition[] = [];
  for (const rawProject of loaded.projects) {
    const normalized = normalizeProjectDefinition(rawProject);
    if (!normalized) {
      changed = true;
      continue;
    }

    const rawSnapshot = JSON.stringify(rawProject);
    const normalizedSnapshot = JSON.stringify(normalized);
    if (rawSnapshot !== normalizedSnapshot) changed = true;
    normalizedProjects.push(normalized);
  }

  let currentProjectId = loaded.currentProjectId;
  if (currentProjectId && !normalizedProjects.some((p) => p.id === currentProjectId)) {
    currentProjectId = normalizedProjects[0]?.id ?? null;
    changed = true;
  }
  if (!currentProjectId && normalizedProjects.length > 0) {
    currentProjectId = normalizedProjects[0].id;
    changed = true;
  }

  const normalizedRegistry: ProjectRegistry = {
    version: REGISTRY_VERSION,
    currentProjectId,
    projects: normalizedProjects,
  };

  if (changed) {
    saveRegistry(normalizedRegistry);
  }

  return normalizedRegistry;
}

function ensureDefaultProjectExists(): void {
  if (BOOTSTRAPPED) return;

  let registry = loadRegistry();
  if (registry.projects.length > 0) {
    if (!registry.currentProjectId) {
      registry.currentProjectId = registry.projects[0].id;
      saveRegistry(registry);
    }
    BOOTSTRAPPED = true;
    return;
  }

  const workspaceRoot = getWorkspaceRoot();
  ensureDirectory(workspaceRoot);

  const defaultProjectId = "default";
  const defaultProject = createProjectDefinition(
    defaultProjectId,
    "Progetto predefinito",
    workspaceRoot,
    DEFAULT_PROJECT_SCHEMA_PRESET_KEY,
  );
  ensureProjectStructure(defaultProject);
  migrateLegacyIntoProject(defaultProject);

  registry = {
    version: REGISTRY_VERSION,
    currentProjectId: defaultProject.id,
    projects: [defaultProject],
  };
  saveRegistry(registry);
  BOOTSTRAPPED = true;
}

function getRegistry(): ProjectRegistry {
  ensureDefaultProjectExists();
  return loadRegistry();
}

function persistRegistry(registry: ProjectRegistry): void {
  saveRegistry(registry);
}

export function listProjects(): ProjectDefinition[] {
  return getRegistry().projects;
}

export function getCurrentProjectId(): string | null {
  return getRegistry().currentProjectId;
}

export function getProjectById(projectId: string): ProjectDefinition | undefined {
  return getRegistry().projects.find((p) => p.id === projectId);
}

export function resolveProject(projectId?: string | null): ProjectDefinition | undefined {
  const registry = getRegistry();
  const requested = projectId ? registry.projects.find((p) => p.id === projectId) : undefined;
  const fallbackId = registry.currentProjectId || registry.projects[0]?.id;
  const project = requested || (fallbackId ? registry.projects.find((p) => p.id === fallbackId) : undefined);
  if (!project) return undefined;

  if (registry.currentProjectId !== project.id) {
    registry.currentProjectId = project.id;
    persistRegistry(registry);
  }

  ensureProjectStructure(project);

  return project;
}

export function setCurrentProject(projectId: string): ProjectDefinition {
  const registry = getRegistry();
  const project = registry.projects.find((p) => p.id === projectId);
  if (!project) {
    throw new Error("Progetto non trovato");
  }

  registry.currentProjectId = project.id;
  persistRegistry(registry);
  return project;
}

export function createProject(input: CreateProjectInput): ProjectDefinition {
  const name = input.name?.trim();
  if (!name) throw new Error("Nome progetto obbligatorio");

  const registry = getRegistry();
  const basePath = input.basePath?.trim() ? path.resolve(input.basePath.trim()) : getWorkspaceRoot();
  ensureDirectory(basePath);

  const rawId = input.projectId?.trim() || name;
  const normalizedId = normalizeProjectId(rawId);
  const projectId = ensureUniqueProjectId(registry, normalizedId);
  const preset = resolveDocumentationPreset(input);

  const project = createProjectDefinition(projectId, name, basePath, preset.key);

  if (fs.existsSync(project.projectRoot) && !isDirEmpty(project.projectRoot)) {
    throw new Error(`La cartella progetto esiste gia e non e vuota: ${project.projectRoot}`);
  }

  ensureProjectStructure(project);
  STORAGE_CACHE.set(project.id, createStorage(project.dbPath));

  registry.projects.push(project);
  registry.currentProjectId = project.id;
  persistRegistry(registry);

  return project;
}

export function listDocumentationSchemaPresets(): ProjectSchemaPresetSummary[] {
  return listProjectSchemaPresets();
}

export function getProjectSchemaDefinition(projectId: string): DocumentationSchemaDefinition {
  const project = getProjectById(projectId);
  if (!project) {
    throw new Error("Progetto non trovato");
  }

  ensureProjectStructure(project);
  const schemaPath = getProjectSchemaPath(project);
  const fallback = getProjectSchemaDefinitionByKey(project.schemaKey);
  const loaded = safeReadJson<DocumentationSchemaDefinition>(schemaPath);
  if (!loaded || typeof loaded !== "object") {
    writeProjectSchemaFile(project, fallback);
    return fallback;
  }
  const normalized = normalizeDocumentationSchemaDefinition(loaded);
  if (JSON.stringify(loaded) !== JSON.stringify(normalized)) {
    writeProjectSchemaFile(project, normalized);
  }
  return normalized;
}

export function setProjectSchemaPreset(projectId: string, presetKey: string): ProjectDefinition {
  const registry = getRegistry();
  const projectIndex = registry.projects.findIndex((p) => p.id === projectId);
  if (projectIndex === -1) {
    throw new Error("Progetto non trovato");
  }

  const preset = getProjectSchemaPreset(presetKey);
  const current = registry.projects[projectIndex];
  const updated: ProjectDefinition = {
    ...current,
    documentationMode: preset.documentationMode,
    schemaKey: preset.schemaKey,
    exportMode: preset.exportMode,
    defaultUsModelKey: preset.defaultUsModelKey,
    updatedAt: nowIso(),
  };

  registry.projects[projectIndex] = updated;
  persistRegistry(registry);
  ensureProjectStructure(updated);
  writeProjectSchemaFile(updated, preset.schema);
  return updated;
}

export function setProjectSchemaDefinition(
  projectId: string,
  definition: DocumentationSchemaDefinition,
): DocumentationSchemaDefinition {
  const registry = getRegistry();
  const projectIndex = registry.projects.findIndex((p) => p.id === projectId);
  if (projectIndex === -1) {
    throw new Error("Progetto non trovato");
  }

  const current = registry.projects[projectIndex];
  if (current.documentationMode !== "custom") {
    throw new Error("Lo schema e modificabile solo per progetti custom");
  }

  const normalized = normalizeDocumentationSchemaDefinition({
    ...definition,
    key: current.schemaKey,
    mode: "custom",
    exportMode: definition.exportMode || current.exportMode,
    usModelKey: definition.usModelKey || current.defaultUsModelKey,
  });

  const updated: ProjectDefinition = {
    ...current,
    exportMode: normalized.exportMode,
    defaultUsModelKey: normalized.usModelKey || current.defaultUsModelKey,
    updatedAt: nowIso(),
  };
  registry.projects[projectIndex] = updated;
  persistRegistry(registry);

  ensureProjectStructure(updated);
  writeProjectSchemaFile(updated, normalized);
  return normalized;
}

export function getStorageForProject(projectId: string): IStorage {
  const cached = STORAGE_CACHE.get(projectId);
  if (cached) return cached;

  const project = getProjectById(projectId);
  if (!project) {
    throw new Error("Progetto non trovato");
  }

  ensureProjectStructure(project);
  const storage = createStorage(project.dbPath);
  STORAGE_CACHE.set(projectId, storage);
  return storage;
}
