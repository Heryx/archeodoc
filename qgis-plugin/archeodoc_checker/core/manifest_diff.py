"""
Confronto tra il manifest appena calcolato e quello scritto dal check precedente,
per mostrare all'utente cosa e' nuovo, cambiato o invariato prima di riesportare.
"""
from __future__ import annotations

import json
import os


def load_previous_manifest(interop_dir: str) -> dict | None:
    manifest_path = os.path.join(interop_dir, "manifest.json")
    if not os.path.isfile(manifest_path):
        return None
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _layer_signature(entry: dict) -> tuple:
    """Firma leggera per capire se un layer e' cambiato rispetto all'ultimo export."""
    return (
        entry.get("format"),
        entry.get("path"),
        entry.get("worldFilePath"),
        entry.get("crs"),
        entry.get("geometryType"),
        entry.get("featureCount"),
    )


def classify_layers(current_layers: list[dict], previous_manifest: dict | None) -> list[dict]:
    """
    Ritorna una copia di current_layers con un campo "status" aggiunto ad ognuna:
    "new" (mai visto in un export precedente), "changed" (era gia' presente ma e' cambiato)
    o "unchanged" (identico all'ultimo export).
    """
    previous_by_id: dict[str, dict] = {}
    if previous_manifest:
        for entry in previous_manifest.get("layers", []):
            previous_by_id[entry.get("id")] = entry

    result = []
    for entry in current_layers:
        annotated = dict(entry)
        prev = previous_by_id.get(entry.get("id"))
        if prev is None:
            annotated["status"] = "new"
        elif _layer_signature(prev) == _layer_signature(entry):
            annotated["status"] = "unchanged"
        else:
            annotated["status"] = "changed"
        result.append(annotated)
    return result
