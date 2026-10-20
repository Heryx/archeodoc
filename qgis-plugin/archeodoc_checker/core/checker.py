"""
Logica di check del progetto QGIS per l'interoperabilita' con ArcheoDoc.
Non modifica mai il progetto QGIS: legge soltanto, e scrive risultati in una
sottocartella archeodoc/ accanto al file di progetto (vedi shared/qgis_interop/README.md
nel repo ArcheoDoc per il contratto completo).
"""
from __future__ import annotations

import datetime
import json
import os

from qgis.core import (
    QgsWkbTypes,
    QgsVectorLayer,
    QgsRasterLayer,
    QgsProject,
)

from .normalize_us_code import normalize_us_code, us_code_key

_RULES_PATH = os.path.join(os.path.dirname(__file__), "rules.json")

with open(_RULES_PATH, "r", encoding="utf-8") as f:
    RULES = json.load(f)

_VECTOR_FORMAT_BY_PROVIDER_HINT = {
    "gpkg": "gpkg",
    "shp": "shp",
    "geojson": "geojson",
    "json": "geojson",
    "kml": "kml",
    "csv": "csv",
}

_RASTER_EXTENSIONS = set(RULES["rasterFormats"]["supported"])
_WORLD_FILE_MAP = RULES["rasterFormats"]["externalWorldFileExtensions"]


class CheckSeverity:
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


def _issue(severity, message, layer_name=None, feature_id=None):
    return {
        "severity": severity,
        "message": message,
        "layer": layer_name,
        "featureId": feature_id,
    }


def _guess_format_from_path(path: str) -> str | None:
    ext = os.path.splitext(path)[1].lstrip(".").lower()
    if ext in _VECTOR_FORMAT_BY_PROVIDER_HINT:
        return _VECTOR_FORMAT_BY_PROVIDER_HINT[ext]
    if ext in _RASTER_EXTENSIONS:
        return ext
    return None


def _find_world_file(raster_path: str) -> str | None:
    ext = os.path.splitext(raster_path)[1].lstrip(".").lower()
    candidates = _WORLD_FILE_MAP.get(ext)
    if not candidates:
        return None
    base = os.path.splitext(raster_path)[0]
    for suffix in candidates:
        candidate = f"{base}.{suffix}"
        if os.path.isfile(candidate):
            return candidate
    return None


def _rel(path: str, base_dir: str) -> str:
    try:
        return os.path.relpath(path, base_dir).replace(os.sep, "/")
    except ValueError:
        return path


def _find_us_code_field(layer: "QgsVectorLayer") -> str | None:
    field_names_lower = {f.name().lower(): f.name() for f in layer.fields()}
    for candidate in RULES["usCodeField"]["candidates"]:
        actual = field_names_lower.get(candidate.lower())
        if actual:
            return actual
    return None


def _geometry_type_name(layer: "QgsVectorLayer") -> str | None:
    wkb = layer.wkbType()
    if wkb == QgsWkbTypes.Unknown or wkb == QgsWkbTypes.NoGeometry:
        return None
    return QgsWkbTypes.displayString(wkb)


def run_check(project: "QgsProject", plugin_version: str = "0.1.0"):
    """
    Esegue il check sul progetto QGIS corrente e restituisce
    (manifest: dict, us_links: dict, report: dict, interop_dir: str | None).
    interop_dir e' None se il progetto non e' ancora stato salvato su disco.
    """
    project_path = project.fileName()
    if not project_path:
        return None, None, None, None

    base_dir = os.path.dirname(project_path)
    project_crs = project.crs().authid()

    issues: list[dict] = []
    layers_out = []
    links_out = []
    seen_codes_per_layer: dict[str, dict[str, int]] = {}

    for layer_id, layer in project.mapLayers().items():
        source_path = layer.source().split("|")[0]
        fmt = _guess_format_from_path(source_path)

        if isinstance(layer, QgsVectorLayer):
            if fmt is None:
                issues.append(_issue(
                    CheckSeverity.WARNING,
                    f"Formato layer non riconosciuto ({source_path}), verra' ignorato da ArcheoDoc.",
                    layer.name(),
                ))
                continue
            if fmt not in RULES["vectorFormats"]["supported"]:
                issues.append(_issue(CheckSeverity.WARNING, f"Formato vettoriale '{fmt}' non supportato.", layer.name()))
                continue

            layer_crs = layer.crs().authid()
            if RULES["requiredCrs"]["requireCrsDefined"] and not layer_crs:
                issues.append(_issue(CheckSeverity.ERROR, "CRS non definito.", layer.name()))
            elif RULES["requiredCrs"]["vectorLayersMustShareProjectCrs"] and layer_crs != project_crs:
                issues.append(_issue(
                    CheckSeverity.WARNING,
                    f"CRS layer ({layer_crs}) diverso dal CRS di progetto ({project_crs}).",
                    layer.name(),
                ))

            us_field = _find_us_code_field(layer)
            geometry_type = _geometry_type_name(layer)
            feature_count = layer.featureCount()

            layers_out.append({
                "id": layer_id,
                "name": layer.name(),
                "kind": "vector",
                "format": fmt,
                "path": _rel(source_path, base_dir),
                "worldFilePath": None,
                "crs": layer_crs or None,
                "geometryType": geometry_type,
                "featureCount": feature_count,
                "hasUsCodeField": us_field is not None,
                "usCodeFieldName": us_field,
            })

            if us_field is None:
                issues.append(_issue(
                    CheckSeverity.INFO,
                    "Nessun campo codice US riconosciuto: layer non collegabile automaticamente.",
                    layer.name(),
                ))
                continue

            layer_seen = seen_codes_per_layer.setdefault(layer_id, {})
            for feature in layer.getFeatures():
                if RULES["geometryValidity"]["requireNonEmptyGeometry"]:
                    geom = feature.geometry()
                    if geom is None or geom.isEmpty():
                        issues.append(_issue(CheckSeverity.ERROR, "Feature senza geometria.", layer.name(), feature.id()))
                        continue
                    if RULES["geometryValidity"]["rejectSelfIntersections"] and not geom.isGeosValid():
                        issues.append(_issue(CheckSeverity.ERROR, "Geometria non valida (self-intersection o simile).", layer.name(), feature.id()))

                raw_value = feature[us_field]
                raw_str = "" if raw_value is None else str(raw_value).strip()
                if not raw_str:
                    continue

                key = us_code_key(raw_str)
                if key in layer_seen:
                    severity = (
                        CheckSeverity.ERROR
                        if RULES["duplicateUsCodePolicy"]["sameLayerDuplicateIsError"]
                        else CheckSeverity.INFO
                    )
                    issues.append(_issue(
                        severity,
                        f"Codice US '{raw_str}' presente su più feature dello stesso layer (normale se la US è spezzata in più poligoni).",
                        layer.name(),
                        feature.id(),
                    ))
                else:
                    layer_seen[key] = feature.id()

                links_out.append({
                    "usCodeRaw": raw_str,
                    "usCodeNormalized": normalize_us_code(raw_str),
                    "layerId": layer_id,
                    "featureId": feature.id(),
                    "geometryType": geometry_type,
                })

        elif isinstance(layer, QgsRasterLayer):
            if fmt is None or fmt not in RULES["rasterFormats"]["supported"]:
                continue
            world_file = _find_world_file(source_path)
            georeferenced = fmt in ("tif", "tiff") or world_file is not None
            if not georeferenced:
                issues.append(_issue(
                    CheckSeverity.ERROR,
                    "Raster non georeferenziato: manca il world file esterno (o i tag interni per tif/tiff).",
                    layer.name(),
                ))

            layers_out.append({
                "id": layer_id,
                "name": layer.name(),
                "kind": "raster",
                "format": fmt,
                "path": _rel(source_path, base_dir),
                "worldFilePath": _rel(world_file, base_dir) if world_file else None,
                "crs": layer.crs().authid() or None,
                "geometryType": None,
                "featureCount": None,
                "hasUsCodeField": False,
                "usCodeFieldName": None,
            })

    now = datetime.datetime.now(datetime.timezone.utc).isoformat()

    manifest = {
        "schemaVersion": 1,
        "generatedAt": now,
        "generatedByPluginVersion": plugin_version,
        "projectFile": os.path.basename(project_path),
        "projectCrs": project_crs,
        "layers": layers_out,
    }

    us_links = {
        "schemaVersion": 1,
        "generatedAt": now,
        "links": links_out,
    }

    error_count = sum(1 for i in issues if i["severity"] == CheckSeverity.ERROR)
    warning_count = sum(1 for i in issues if i["severity"] == CheckSeverity.WARNING)

    report = {
        "schemaVersion": 1,
        "generatedAt": now,
        "ok": error_count == 0,
        "errorCount": error_count,
        "warningCount": warning_count,
        "issues": issues,
    }

    interop_dir = os.path.join(base_dir, RULES["interopFolder"]["name"])
    return manifest, us_links, report, interop_dir


def write_results(interop_dir: str, manifest: dict, us_links: dict, report: dict):
    os.makedirs(interop_dir, exist_ok=True)
    files = RULES["interopFolder"]["files"]
    with open(os.path.join(interop_dir, files["manifest"]), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    with open(os.path.join(interop_dir, files["usLinks"]), "w", encoding="utf-8") as f:
        json.dump(us_links, f, ensure_ascii=False, indent=2)
    with open(os.path.join(interop_dir, files["report"]), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
