"""
Conversione di raster GeoTIFF in PNG georeferenziato (world file), usando GDAL
tramite il framework Processing di QGIS. Serve perche' ArcheoDoc WebMap non decodifica
ancora il GeoTIFF direttamente (nessuna libreria di decodifica raster lato server);
PNG/JPG + world file invece vengono gia' letti senza problemi.
"""
from __future__ import annotations

import os


def convert_raster_to_png(layer, output_dir: str, base_name: str) -> tuple[str, str | None]:
    """
    Converte `layer` (QgsRasterLayer) in PNG con world file dentro `output_dir`.
    Ritorna (percorso_png, percorso_world_file_o_None).
    Solleva un'eccezione se la conversione GDAL fallisce.
    """
    import processing

    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, f"{base_name}.png")

    processing.run("gdal:translate", {
        "INPUT": layer,
        "TARGET_CRS": None,
        "NODATA": None,
        "COPY_SUBDATASETS": False,
        "OPTIONS": "WORLDFILE=YES",
        "EXTRA": "",
        "DATA_TYPE": 0,  # Use Input Layer Data Type
        "OUTPUT": output_path,
    })

    base_no_ext = os.path.splitext(output_path)[0]
    for candidate_ext in (".wld", ".pgw"):
        candidate = base_no_ext + candidate_ext
        if os.path.isfile(candidate):
            return output_path, candidate

    return output_path, None
