"""
Conversione raster GeoTIFF -> PNG georeferenziato eseguita in background (QgsTask),
cosi' la UI di QGIS resta reattiva durante l'esportazione. Include una cache basata
su mtime/size del file sorgente per saltare le conversioni gia' fatte e non ancora cambiate.
"""
from __future__ import annotations

import json
import os

from qgis.core import QgsTask

from .raster_convert import convert_raster_to_png

CACHE_FILE_NAME = ".convert_cache.json"


def _load_cache(rasters_dir: str) -> dict:
    cache_path = os.path.join(rasters_dir, CACHE_FILE_NAME)
    if not os.path.isfile(cache_path):
        return {}
    try:
        with open(cache_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save_cache(rasters_dir: str, cache: dict) -> None:
    os.makedirs(rasters_dir, exist_ok=True)
    cache_path = os.path.join(rasters_dir, CACHE_FILE_NAME)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def _source_stat(path: str) -> dict | None:
    try:
        st = os.stat(path)
        return {"mtime": st.st_mtime, "size": st.st_size}
    except OSError:
        return None


class RasterConversionTask(QgsTask):
    """
    Converte in background una lista di raster (tif/tiff -> png+world file).
    `jobs` e' una lista di dict: {"entry": manifest_layer_dict, "source_path": str}.
    A fine esecuzione, self.results contiene per ogni job l'esito (successo/errore/cache-hit)
    e self.updated_entries le entry di manifest aggiornate (format/path/worldFilePath).
    """

    def __init__(self, jobs: list[dict], rasters_dir: str, layer_by_id: dict):
        super().__init__("ArcheoDoc: conversione raster GeoTIFF", QgsTask.CanCancel)
        self.jobs = jobs
        self.rasters_dir = rasters_dir
        self.layer_by_id = layer_by_id
        self.results: list[dict] = []
        self.updated_entries: dict[str, dict] = {}
        self._error: str | None = None

    def run(self) -> bool:
        cache = _load_cache(self.rasters_dir)
        total = len(self.jobs) or 1

        for i, job in enumerate(self.jobs):
            if self.isCanceled():
                return False

            entry = job["entry"]
            layer_id = entry["id"]
            source_path = job["source_path"]
            stat = _source_stat(source_path)
            cached = cache.get(layer_id)

            if (
                stat
                and cached
                and cached.get("source_mtime") == stat["mtime"]
                and cached.get("source_size") == stat["size"]
                and os.path.isfile(cached.get("output_path", ""))
                and os.path.isfile(cached.get("world_path", ""))
            ):
                self.results.append({"name": entry["name"], "status": "cached"})
                self.updated_entries[layer_id] = {
                    "format": "png",
                    "path": cached["relative_path"],
                    "worldFilePath": cached["relative_world_path"],
                }
                self.setProgress((i + 1) / total * 100)
                continue

            qgis_layer = self.layer_by_id.get(layer_id)
            if qgis_layer is None:
                self.results.append({"name": entry["name"], "status": "error", "message": "layer non trovato nel progetto"})
                self.setProgress((i + 1) / total * 100)
                continue

            safe_name = "".join(c if c.isalnum() else "_" for c in entry["name"]) or "raster"
            try:
                png_path, world_path = convert_raster_to_png(qgis_layer, self.rasters_dir, safe_name)
            except Exception as e:  # noqa: BLE001 - vogliamo riportare qualunque errore GDAL
                self.results.append({"name": entry["name"], "status": "error", "message": str(e)})
                self.setProgress((i + 1) / total * 100)
                continue

            if not world_path:
                self.results.append({"name": entry["name"], "status": "error", "message": "world file non generato"})
                self.setProgress((i + 1) / total * 100)
                continue

            self.results.append({"name": entry["name"], "status": "converted"})
            base_dir = job["project_base_dir"]
            relative_path = os.path.relpath(png_path, base_dir).replace(os.sep, "/")
            relative_world_path = os.path.relpath(world_path, base_dir).replace(os.sep, "/")
            self.updated_entries[layer_id] = {
                "format": "png",
                "path": relative_path,
                "worldFilePath": relative_world_path,
            }

            if stat:
                cache[layer_id] = {
                    "source_mtime": stat["mtime"],
                    "source_size": stat["size"],
                    "output_path": png_path,
                    "world_path": world_path,
                    "relative_path": relative_path,
                    "relative_world_path": relative_world_path,
                }

            self.setProgress((i + 1) / total * 100)

        _save_cache(self.rasters_dir, cache)
        return True

    def finished(self, result: bool) -> None:
        # I segnali taskCompleted/taskTerminated di QgsTaskManager sono il punto
        # in cui il chiamante legge self.results / self.updated_entries.
        pass
