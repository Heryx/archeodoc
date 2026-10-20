"""
Dialog di esportazione: l'utente sceglie quali layer/raster includere nell'export
per ArcheoDoc WebMap, vede lo stato rispetto all'ultimo export (nuovo/modificato/invariato)
e segue in tempo reale la conversione in background dei raster GeoTIFF selezionati.
"""
from __future__ import annotations

from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtWidgets import (
    QDialog,
    QVBoxLayout,
    QHBoxLayout,
    QTreeWidget,
    QTreeWidgetItem,
    QPushButton,
    QLabel,
    QProgressBar,
    QDialogButtonBox,
)

STATUS_LABELS = {"new": "Nuovo", "changed": "Modificato", "unchanged": "Invariato"}


class ExportDialog(QDialog):
    def __init__(self, parent, layers: list[dict]):
        super().__init__(parent)
        self.setWindowTitle("ArcheoDoc — Esporta per la WebMap")
        self.resize(600, 440)
        self._item_by_id: dict[str, QTreeWidgetItem] = {}
        self._exporting = False

        layout = QVBoxLayout(self)
        layout.addWidget(QLabel(
            "Seleziona i layer e i raster da esportare per ArcheoDoc WebMap.\n"
            "I raster GeoTIFF selezionati verranno convertiti in PNG georeferenziato "
            "(le conversioni già fatte e non cambiate vengono riusate)."
        ))

        self.tree = QTreeWidget()
        self.tree.setHeaderLabels(["Layer", "Formato", "Stato"])
        self.tree.setColumnWidth(0, 280)
        layout.addWidget(self.tree, stretch=1)

        vector_group = QTreeWidgetItem(self.tree, ["Vettoriali"])
        raster_group = QTreeWidgetItem(self.tree, ["Raster"])
        for group in (vector_group, raster_group):
            group.setFlags(group.flags() & ~Qt.ItemIsUserCheckable)
            font = group.font(0)
            font.setBold(True)
            group.setFont(0, font)

        for entry in layers:
            parent_item = raster_group if entry.get("kind") == "raster" else vector_group
            item = QTreeWidgetItem(parent_item, [
                entry.get("name", ""),
                entry.get("format", ""),
                STATUS_LABELS.get(entry.get("status"), ""),
            ])
            item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
            item.setCheckState(0, Qt.Checked)
            self._item_by_id[entry["id"]] = item

        raster_group.setHidden(raster_group.childCount() == 0)
        vector_group.setHidden(vector_group.childCount() == 0)
        self.tree.expandAll()

        self.progress_label = QLabel("")
        self.progress_label.setVisible(False)
        layout.addWidget(self.progress_label)

        self.progress_bar = QProgressBar()
        self.progress_bar.setVisible(False)
        layout.addWidget(self.progress_bar)

        buttons_row = QHBoxLayout()
        self.select_all_btn = QPushButton("Seleziona tutti")
        self.select_all_btn.clicked.connect(lambda: self._set_all_checked(True))
        self.select_none_btn = QPushButton("Deseleziona tutti")
        self.select_none_btn.clicked.connect(lambda: self._set_all_checked(False))
        buttons_row.addWidget(self.select_all_btn)
        buttons_row.addWidget(self.select_none_btn)
        buttons_row.addStretch()
        layout.addLayout(buttons_row)

        self.button_box = QDialogButtonBox(QDialogButtonBox.Cancel)
        self.export_btn = self.button_box.addButton("Esporta", QDialogButtonBox.AcceptRole)
        self.button_box.rejected.connect(self.reject)
        layout.addWidget(self.button_box)

    def _set_all_checked(self, checked: bool):
        state = Qt.Checked if checked else Qt.Unchecked
        for item in self._item_by_id.values():
            item.setCheckState(0, state)

    def get_selected_ids(self) -> set:
        return {
            layer_id for layer_id, item in self._item_by_id.items()
            if item.checkState(0) == Qt.Checked
        }

    def closeEvent(self, event):
        # Mentre la conversione raster in background e' in corso, il task tiene un riferimento
        # a questo dialog: evitiamo che venga chiuso/distrutto (crash su callback successive).
        if self._exporting:
            event.ignore()
            return
        super().closeEvent(event)

    def reject(self):
        if self._exporting:
            return
        super().reject()

    def enter_exporting_mode(self, raster_job_count: int):
        """Disabilita la selezione e mostra la barra di progresso (chiamare prima di avviare il task)."""
        self._exporting = True
        self.tree.setEnabled(False)
        self.select_all_btn.setEnabled(False)
        self.select_none_btn.setEnabled(False)
        self.export_btn.setEnabled(False)
        self.button_box.button(QDialogButtonBox.Cancel).setEnabled(False)
        if raster_job_count > 0:
            self.progress_label.setVisible(True)
            self.progress_bar.setVisible(True)
            self.progress_bar.setRange(0, 100)
            self.update_progress(0, f"Conversione raster in corso (0/{raster_job_count})...")

    def update_progress(self, percent: float, message: str):
        self.progress_bar.setValue(int(percent))
        self.progress_label.setText(message)
