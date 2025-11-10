History PDF Reader — Multi-page & Map Tracing

Kurzbeschreibung

Dieses kleine Demo-Tool ermöglicht das Laden eines PDFs (bis zu einem Render-Limit), gleichzeitiges Betrachten der Seiten und synchronisierte Karte (Leaflet). Zusätzlich können pro Seite Map-Traces gezeichnet, exportiert und importiert werden (GeoJSON).

Wichtigste Funktionen

- PDF-Rendering (PDF.js) — rendert bis zu 50 Seiten standardmäßig, um Browser-Blockaden zu vermeiden.
- Karte mit Leaflet und Zeichentools via Leaflet.Draw.
- Per-Page Traces: Jedes gezeichnete Objekt wird der aktuell aktiven Seite zugeordnet (oder beiden Seiten im Spread-Modus).
- UI: Seiten-Auswahl, Clear Page, Export Page (GeoJSON), Export All, Import GeoJSON.

Bekannte Limitierungen

- Maximal gerenderte Seiten: 50 (konfigurierbar im Code). Für größere PDFs sollte Lazy-Loading implementiert werden.
- Editieren bereits gezeichneter Traces ist nicht vollständig integriert; Zeichnen erstellt neue Layer, die beim Export enthalten sind.
- Importierte GeoJSON-Features werden der aktuell ausgewählten Seite hinzugefügt.

Kurzanleitung

1. Öffne `index.html` in einem Browser (lokaler Webserver empfehlenswert).
2. Klicke "Upload PDF" und wähle ein PDF (empfohlen: unter 50 Seiten für flüssige Nutzung).
3. Nutze die Seitenliste, um zu einer Seite zu springen.
4. Aktiviere "Trace: On" und zeichne mit den Leaflet.Draw Werkzeugen auf der Karte.
5. Wähle "Single Page" oder "Spread" um Traces einer Seite oder einer Seitenspanne zuzuordnen.
6. Exportiere die Traces einer Seite (GeoJSON) oder alle Seiten zusammen.
7. Zum Import: klicke "Import" und wähle eine GeoJSON-Datei; die Features werden der aktuell ausgewählten Seite hinzugefügt.

Weiteres / Vorschläge

- Lazy-rendering für sehr große PDFs (render-on-demand beim Scrollen) — empfohlen für Produktions-Workloads.
- Vollständiges Editieren/Versionierung von Traces, sowie ein UI zum Verwalten vieler Seiten-Traces (Suche, Bulk-Export).
- Persistenz (lokal oder Server) für langfristige Projekte.

Viel Erfolg beim Testen — gib Bescheid, wenn du möchtest, dass ich Lazy-Loading oder Import/Export-Verbesserungen implementiere.
