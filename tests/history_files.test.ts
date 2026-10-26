import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { removeAttachmentIfExists, restoreTrashedAttachment } from "../server/routes/file_helpers";
import type { ProjectDefinition } from "../server/projects";

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archeodoc-files-"));
  const mediaDir = path.join(root, "media");
  fs.mkdirSync(path.join(mediaDir, "1"), { recursive: true });
  return { root, mediaDir, project: { dbPath: path.join(root, "project.sqlite"), mediaDir } as ProjectDefinition };
}

test("eliminare un allegato lo sposta nel cestino e si puo' recuperare", () => {
  const { root, mediaDir, project: p } = project();
  const file = path.join(mediaDir, "1", "foto.jpg");
  fs.writeFileSync(file, "contenuto");

  removeAttachmentIfExists(p, "1/foto.jpg");
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.readFileSync(path.join(root, "storico", "_cestino", "1", "foto.jpg"), "utf8"), "contenuto");

  assert.equal(restoreTrashedAttachment(p, "1/foto.jpg"), true);
  assert.equal(fs.readFileSync(file, "utf8"), "contenuto");
  assert.equal(fs.existsSync(path.join(root, "storico", "_cestino", "1", "foto.jpg")), false);
});

test("il recupero non sovrascrive un file che nel frattempo e' tornato al suo posto", () => {
  const { mediaDir, project: p } = project();
  const file = path.join(mediaDir, "1", "foto.jpg");
  fs.writeFileSync(file, "vecchio");
  removeAttachmentIfExists(p, "1/foto.jpg");
  fs.writeFileSync(file, "nuovo");

  assert.equal(restoreTrashedAttachment(p, "1/foto.jpg"), false);
  assert.equal(fs.readFileSync(file, "utf8"), "nuovo");
});

test("percorsi fuori dalla cartella media vengono ignorati", () => {
  const { project: p } = project();
  assert.doesNotThrow(() => removeAttachmentIfExists(p, "../../project.sqlite"));
  assert.equal(restoreTrashedAttachment(p, "../../x"), false);
});
