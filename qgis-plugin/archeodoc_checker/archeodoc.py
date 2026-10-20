import os

from qgis.PyQt.QtWidgets import QAction, QMessageBox
from qgis.core import QgsProject, QgsApplication

from .core.checker import run_check, write_results
from .core.manifest_diff import load_previous_manifest, classify_layers
from .core.raster_task import RasterConversionTask
from .ui.export_dialog import ExportDialog

PLUGIN_VERSION = "0.2.0"


class ArcheoDocCheckerPlugin:
    def __init__(self, iface):
        self.iface = iface
        self.action = None
        self._task = None
        self._export_state = None

    def initGui(self):
        self.action = QAction("Verifica ed esporta per ArcheoDoc", self.iface.mainWindow())
        self.action.triggered.connect(self.run)
        self.iface.addPluginToMenu("&ArcheoDoc", self.action)
        self.iface.addToolBarIcon(self.action)

    def unload(self):
        if self.action is None:
            return
        self.iface.removePluginMenu("&ArcheoDoc", self.action)
        self.iface.removeToolBarIcon(self.action)

    def run(self):
        project = QgsProject.instance()

        if not project.fileName():
            QMessageBox.warning(
                self.iface.mainWindow(),
                "ArcheoDoc Checker",
                "Salva il progetto QGIS su disco prima di eseguire il check: "
                "i risultati vengono scritti accanto al file di progetto.",
            )
            return

        manifest, us_links, report, interop_dir = run_check(project, PLUGIN_VERSION)
        if interop_dir is None:
            return

        previous_manifest = load_previous_manifest(interop_dir)
        annotated_layers = classify_layers(manifest["layers"], previous_manifest)

        dialog = ExportDialog(self.iface.mainWindow(), annotated_layers)
        dialog.export_btn.clicked.connect(
            lambda: self._start_export(dialog, project, manifest, us_links, report, interop_dir)
        )
        dialog.exec_()

    def _start_export(self, dialog, project, manifest, us_links, report, interop_dir):
        selected_ids = dialog.get_selected_ids()

        manifest = dict(manifest)
        manifest["layers"] = [entry for entry in manifest["layers"] if entry["id"] in selected_ids]
        us_links = dict(us_links)
        us_links["links"] = [link for link in us_links["links"] if link["layerId"] in selected_ids]

        raster_jobs = []
        base_dir = os.path.dirname(project.fileName())
        for entry in manifest["layers"]:
            if entry.get("kind") == "raster" and entry.get("format") in ("tif", "tiff"):
                raster_jobs.append({
                    "entry": entry,
                    "source_path": os.path.join(base_dir, entry["path"]),
                    "project_base_dir": base_dir,
                })

        dialog.enter_exporting_mode(len(raster_jobs))
        self._export_state = {
            "dialog": dialog,
            "manifest": manifest,
            "us_links": us_links,
            "report": report,
            "interop_dir": interop_dir,
        }

        if not raster_jobs:
            self._finish_export([])
            return

        rasters_dir = os.path.join(interop_dir, "rasters")
        layer_by_id = project.mapLayers()
        task = RasterConversionTask(raster_jobs, rasters_dir, layer_by_id)
        self._task = task
        total = len(raster_jobs)

        def on_progress(_task, progress):
            done = int(progress / 100 * total)
            dialog.update_progress(progress, f"Conversione raster in corso ({done}/{total})...")

        task.progressChanged.connect(lambda p: on_progress(task, p))
        task.taskCompleted.connect(lambda: self._on_raster_task_done(task))
        task.taskTerminated.connect(lambda: self._on_raster_task_done(task))
        QgsApplication.taskManager().addTask(task)

    def _on_raster_task_done(self, task: RasterConversionTask):
        for entry in self._export_state["manifest"]["layers"]:
            update = task.updated_entries.get(entry["id"])
            if update:
                entry.update(update)
        self._finish_export(task.results)
        self._task = None

    def _finish_export(self, raster_results: list):
        state = self._export_state
        write_results(state["interop_dir"], state["manifest"], state["us_links"], state["report"])
        state["dialog"].accept()
        self._show_summary(state["interop_dir"], state["manifest"], state["report"], raster_results)
        self._export_state = None

    def _show_summary(self, interop_dir: str, manifest: dict, report: dict, raster_results: list):
        files = {
            "manifest.json": os.path.join(interop_dir, "manifest.json"),
            "us_links.json": os.path.join(interop_dir, "us_links.json"),
            "report.json": os.path.join(interop_dir, "report.json"),
        }
        lines = [f"Esportazione completata in: {interop_dir}", ""]

        ok = all(os.path.isfile(p) for p in files.values())
        if ok:
            lines.append("File scritti correttamente:")
            for name, p in files.items():
                size = os.path.getsize(p)
                lines.append(f"  - {name} ({size} byte)")
        else:
            missing = [name for name, p in files.items() if not os.path.isfile(p)]
            lines.append(f"ATTENZIONE: file mancanti dopo la scrittura: {', '.join(missing)}")

        lines.append("")
        lines.append(f"Layer esportati: {len(manifest['layers'])}")
        lines.append(f"Errori dal check: {report['errorCount']}   Warning: {report['warningCount']}")

        if raster_results:
            lines.append("")
            lines.append("Conversione raster:")
            for item in raster_results:
                if item["status"] == "converted":
                    lines.append(f"  - {item['name']}: convertito")
                elif item["status"] == "cached":
                    lines.append(f"  - {item['name']}: riusata conversione precedente (non cambiato)")
                else:
                    lines.append(f"  - {item['name']}: ERRORE — {item.get('message', '')}")

        icon = QMessageBox.Information if ok and report["errorCount"] == 0 else QMessageBox.Warning
        box = QMessageBox(self.iface.mainWindow())
        box.setWindowTitle("ArcheoDoc — esportazione completata")
        box.setIcon(icon)
        box.setText("\n".join(lines))
        box.exec_()
