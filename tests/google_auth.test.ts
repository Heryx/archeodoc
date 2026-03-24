import test from "node:test";
import assert from "node:assert/strict";

import { __test as authTest, normalizeGoogleError } from "../server/google_auth";

test("google_auth: parseScopes supporta stringa separata da spazi", () => {
  const scopes = authTest.parseScopes("https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive.file");
  assert.deepEqual(scopes, [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive.file",
  ]);
});

test("google_auth: missingScopesFromGranted rileva scope mancanti", () => {
  const missing = authTest.missingScopesFromGranted(["https://www.googleapis.com/auth/documents"]);
  assert.deepEqual(missing, ["https://www.googleapis.com/auth/drive.file"]);
});

test("google_auth: normalizeGoogleError classifica insufficient scopes come 403", () => {
  const err = new Error("Request had insufficient authentication scopes.");
  const normalized = normalizeGoogleError(err, "fallback");

  assert.equal(normalized.status, 403);
  assert.equal(normalized.code, "google_insufficient_scopes");
  assert.match(normalized.message, /Permessi Google insufficienti/i);
});