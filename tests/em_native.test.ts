import test from "node:test";
import assert from "node:assert/strict";
import { EmError, listEmNodes, saveEmNode, suggestUid } from "../server/em_native";

async function withStorage<T>(fn: (storage: any, cid: number) => T | Promise<T>) {
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const { createStorage } = await import("../server/storage");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "emnative-"));
  const storage = createStorage(path.join(dir, "t.db"));
  try {
    const c = storage.createCantiere({ codice: "T", nome: "T", localita: "x" } as any);
    for (const code of ["1", "2", "3"]) storage.createUS({ cantiereId: c.id, codiceUS: code } as any);
    return await fn(storage, c.id);
  } finally {
    (storage as any).db?.$client?.close?.();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("unita' virtuale: sequenza con US e altre unita' virtuali", async () => {
  await withStorage((storage, cid) => {
    const v1 = saveEmNode(storage, cid, { nodeType: "USVs", links: { sopraA: ["US 1"], sottoA: [] } });
    assert.equal(v1.uid, "USVs1");
    const v2 = saveEmNode(storage, cid, { nodeType: "USVn", uid: "USVn10", links: { sopraA: ["USVs1"], sottoA: ["3"] } });
    assert.deepEqual(v2.links.sopraA, ["USVs1"]);
    assert.deepEqual(v2.links.sottoA, ["3"]);
    // l'altro estremo vede lo stesso arco dal suo lato
    assert.deepEqual(listEmNodes(storage, cid).find((n) => n.uid === "USVs1")!.links.sottoA, ["USVn10"]);
    const archi = storage.getEmArchi(cid);
    assert.ok(archi.some((e: any) => e.edgeType === "is_after" && e.sourceRef === "USVn10" && e.targetRef === "USVs1"));
    assert.ok(archi.some((e: any) => e.edgeType === "is_after" && e.sourceKind === "us" && e.sourceRef === "US 3"));

    // un campo non indicato resta invariato, uno vuoto svuota
    saveEmNode(storage, cid, { id: v2.id, links: { sopraA: [] } });
    const again = listEmNodes(storage, cid).find((n) => n.uid === "USVn10")!;
    assert.deepEqual(again.links.sopraA, []);
    assert.deepEqual(again.links.sottoA, ["3"]);
  });
});

test("paradati: documento -> estrattore -> proprieta' con provenienza", async () => {
  await withStorage((storage, cid) => {
    const doc = saveEmNode(storage, cid, { nodeType: "document", descrizione: "Rilievo 1987" });
    const ex = saveEmNode(storage, cid, { nodeType: "extractor", links: { fonti: [doc.uid] } });
    const comb = saveEmNode(storage, cid, { nodeType: "combiner", links: { estrattori: [ex.uid] } });
    assert.deepEqual([doc.uid, ex.uid, comb.uid], ["D.1", "X.1", "C.1"]);
    const prop = saveEmNode(storage, cid, {
      nodeType: "property",
      nome: "material",
      descrizione: "tufo",
      dati: { property_type: "material" },
      links: { appartieneA: ["US 2"], provenienza: [comb.uid] },
    });
    assert.deepEqual(prop.links, { appartieneA: ["2"], provenienza: ["C.1"] });
    assert.equal(prop.dati.property_type, "material");
    assert.equal(suggestUid("document", storage.getEmNodi(cid)), "D.2");
  });
});

test("validazioni: tipi ammessi, duplicati, rinomina e cancellazione", async () => {
  await withStorage((storage, cid) => {
    const doc = saveEmNode(storage, cid, { nodeType: "document" });
    const ex = saveEmNode(storage, cid, { nodeType: "extractor", links: { fonti: ["D.1"] } });
    assert.throws(() => saveEmNode(storage, cid, { nodeType: "combiner", links: { estrattori: ["D.1"] } }), /non ammesso/);
    assert.throws(() => saveEmNode(storage, cid, { nodeType: "extractor", links: { fonti: ["US 99"] } }), /non trovato/);
    assert.throws(() => saveEmNode(storage, cid, { nodeType: "document", uid: "D.1" }), (e: any) => e instanceof EmError && e.status === 409);
    assert.throws(() => saveEmNode(storage, cid, { nodeType: "document", uid: "US 2" }), /coincide/);
    assert.throws(() => saveEmNode(storage, cid, { nodeType: "bogus" }), /non valido/);
    assert.throws(() => saveEmNode(storage, cid, { id: ex.id, nodeType: "document" }), /non si può cambiare/);

    // rinomina: gli archi seguono
    saveEmNode(storage, cid, { id: doc.id, uid: "D.Rilievo" });
    assert.deepEqual(listEmNodes(storage, cid).find((n) => n.id === ex.id)!.links.fonti, ["D.Rilievo"]);

    assert.equal(storage.deleteEmNodo(doc.id), true);
    assert.deepEqual(listEmNodes(storage, cid).find((n) => n.id === ex.id)!.links.fonti, []);
    storage.deleteCantiere(cid);
    assert.deepEqual(storage.getEmNodi(cid), []);
    assert.deepEqual(storage.getEmArchi(cid), []);
  });
});

test("esporta e reimporta unita' virtuali e paradati", async () => {
  const { buildEmJson } = await import("../server/em_json");
  const { loadEmGraph } = await import("../server/em_native");
  const { planEmImport, applyEmImport } = await import("../server/em_json_import");
  let doc: any;
  let cantiere: any;
  await withStorage((storage, cid) => {
    cantiere = storage.getCantiere(cid);
    saveEmNode(storage, cid, { nodeType: "USVs", links: { sopraA: ["US 1"], sottoA: ["US 3"] } });
    const d = saveEmNode(storage, cid, { nodeType: "document", descrizione: "Rilievo 1987" });
    const x = saveEmNode(storage, cid, { nodeType: "extractor", links: { fonti: [d.uid] } });
    saveEmNode(storage, cid, {
      nodeType: "property", nome: "material", descrizione: "tufo", dati: { property_type: "material" },
      links: { appartieneA: ["USVs1"], provenienza: [x.uid] },
    });
    doc = buildEmJson(cantiere, storage.getUSList(cid), { emGraph: loadEmGraph(storage, cid), includeEpochs: false });
  });

  const byType = (t: string) => doc.graph.nodes.filter((n: any) => n.node_type === t);
  assert.equal(byType("USVs").length, 1);
  assert.equal(byType("property")[0].name, "material");
  assert.equal(byType("property")[0].description, "tufo");
  assert.ok(doc.graph.edges.some((e: any) => e.edge_type === "is_after" && e.source === "USVs1" && e.target === "1"));
  assert.ok(doc.graph.edges.some((e: any) => e.edge_type === "is_after" && e.source === "3" && e.target === "USVs1"));
  assert.ok(doc.graph.edges.some((e: any) => e.edge_type === "extracted_from" && e.source === "X.1" && e.target === "D.1"));
  assert.ok(doc.graph.edges.some((e: any) => e.edge_type === "has_property" && e.source === "USVs1"));

  // in un cantiere con le stesse US ma senza nodi EM: tutto da importare, poi piu' nulla
  await withStorage((storage, cid) => {
    const text = JSON.stringify(doc);
    const plan = planEmImport(text, storage.getUSList(cid), [], loadEmGraph(storage, cid));
    assert.deepEqual(plan.emNodes.map((n) => n.uid).sort(), ["D.1", "USVs1", "X.1", expect_prop(plan)].sort());
    assert.equal(plan.emLinks.length, 5);
    const res = applyEmImport(storage, storage.getCantiere(cid), text, [...plan.emNodes.map((n) => n.key), ...plan.emLinks.map((l) => l.key)]);
    assert.equal(res.createdEmNodes, 4);
    assert.equal(res.addedEmLinks, 5);
    const again = planEmImport(text, storage.getUSList(cid), [], loadEmGraph(storage, cid));
    assert.deepEqual([again.emNodes.length, again.emLinks.length], [0, 0]);
    const v = listEmNodes(storage, cid).find((n) => n.uid === "USVs1")!;
    assert.deepEqual([v.links.sopraA, v.links.sottoA], [["1"], ["3"]]);
  });
});

function expect_prop(plan: { emNodes: { uid: string; nodeType: string }[] }) {
  return plan.emNodes.find((n) => n.nodeType === "property")!.uid;
}

test("matrix: le unita' virtuali sono nodi della sequenza (non in modalita' fisica)", async () => {
  const { buildMatrixGraph, exportHarrisMatrixPdf } = await import("../server/matrix_export");
  const { loadEmGraph } = await import("../server/em_native");
  await withStorage(async (storage, cid) => {
    storage.updateUS(storage.getUSList(cid)[0].id, { copre: "2" });
    saveEmNode(storage, cid, { nodeType: "USVs", links: { sopraA: ["US 2"], sottoA: ["US 1"] } });
    const emGraph = loadEmGraph(storage, cid);
    const g = buildMatrixGraph(storage.getUSList(cid), "all", {}, emGraph);
    const v = g.nodes.find((n) => n.label === "USVs1")!;
    assert.equal(v.forma, "virtuale");
    const n1 = g.nodes.find((n) => n.label === "1")!;
    const n2 = g.nodes.find((n) => n.label === "2")!;
    assert.ok(n1.y < v.y && v.y < n2.y, "1 sopra la virtuale, la virtuale sopra 2");
    assert.ok(g.edges.some((e) => e.from === n1.key && e.to === v.key && e.type === "posteriore"));
    assert.equal(buildMatrixGraph(storage.getUSList(cid), "fisica", {}, emGraph).nodes.some((n) => n.forma === "virtuale"), false);
    const pdf = await exportHarrisMatrixPdf(storage.getCantiere(cid), storage.getUSList(cid), "all", { emGraph });
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  });
});
