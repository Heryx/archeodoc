import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { listProjects, type ProjectDefinition } from "./projects";
import { logger } from "./logger";

export type BackupKind = "manual" | "daily-auto";

export type ProjectBackupResult = {
  projectId: string;
  kind: BackupKind;
  fileName: string;
  filePath: string;
  createdAt: string;
};

const DAILY_BACKUP_INTERVAL_MS = 60 * 60 * 1000; // every hour
let dailyBackupTimer: NodeJS.Timeout | null = null;

function ensureDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function toTimestampKey(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${toDateKey(date)}-${hours}${minutes}${seconds}`;
}

function hasDailyBackupForDate(project: ProjectDefinition, dateKey: string): boolean {
  if (!fs.existsSync(project.backupsDir)) return false;
  const prefix = `${project.id}-daily-auto-${dateKey}`;
  return fs
    .readdirSync(project.backupsDir)
    .some((entry) => entry.startsWith(prefix) && entry.endsWith(".sqlite"));
}

export async function createProjectBackup(
  project: ProjectDefinition,
  kind: BackupKind = "manual",
): Promise<ProjectBackupResult> {
  ensureDirectory(project.backupsDir);

  const now = new Date();
  const timestamp = toTimestampKey(now);
  const fileName = `${project.id}-${kind}-${timestamp}.sqlite`;
  const filePath = path.join(project.backupsDir, fileName);

  if (!fs.existsSync(project.dbPath)) {
    throw new Error(`Database non trovato: ${project.dbPath}`);
  }

  const sourceDb = new Database(project.dbPath, { fileMustExist: true });
  try {
    await sourceDb.backup(filePath);
  } finally {
    sourceDb.close();
  }

  return {
    projectId: project.id,
    kind,
    fileName,
    filePath,
    createdAt: now.toISOString(),
  };
}

export async function ensureDailyBackupForProject(project: ProjectDefinition): Promise<ProjectBackupResult | null> {
  const dateKey = toDateKey(new Date());
  if (hasDailyBackupForDate(project, dateKey)) return null;
  return createProjectBackup(project, "daily-auto");
}

export async function runDailyBackupSweep(): Promise<void> {
  const projects = listProjects();
  for (const project of projects) {
    try {
      const created = await ensureDailyBackupForProject(project);
      if (created) {
        logger.info("Backup giornaliero creato", {
          projectId: created.projectId,
          filePath: created.filePath,
        });
      }
    } catch (error) {
      logger.error("Errore backup giornaliero", {
        projectId: project.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function startDailyBackupJob(): void {
  if (dailyBackupTimer) return;

  void runDailyBackupSweep();
  dailyBackupTimer = setInterval(() => {
    void runDailyBackupSweep();
  }, DAILY_BACKUP_INTERVAL_MS);
}
