# ScrollThroughTime — History PDF Reader with Interactive Map

**A mobile-optimized tool for reading historical documents with real-time geographic visualization.**

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://weltogeisto.github.io/History-PDF-Reader-wirh-map-HistoMap/)

## 🌟 Features

### 📍 Smart Location Detection
- **Auto-detects 100+ historical locations** including cities, battles, regions, and rivers
- **Context-aware mapping**: "Danube near Serbia" → automatically shows Belgrade segment
- **One location per page** highlighting for clean, uncluttered reading
- **Historical events**: Recognizes battles, sieges, and campaigns

### 🗺️ Interactive Mapping
- **Synchronized map & text**: Click any location to jump to it on the map
- **Journey playback**: Animate through your document's geographic narrative
- **Drawing tools**: Trace military campaigns, borders, or routes
- **Multiple base maps**: OpenStreetMap, Satellite, Terrain

### 📄 PDF Processing
- **Renders up to 50 pages** (configurable)
- **Page-by-page navigation** with thumbnail view
- **Spread mode** for viewing two pages simultaneously

### 📷 OCR Support
- **Scan images** and convert to searchable, mappable text
- **Supports JPEG, PNG** and other common formats
- **Auto-processes** detected locations after OCR

### 📤 Export Options
- **GeoJSON**: For GIS applications
- **KML**: For Google Earth
- **CSV**: For spreadsheet analysis
- **Per-page or bulk export**

### 📱 Mobile-Ready
- **PWA installable** — works offline
- **Swipe gestures** for page navigation
- **Touch-optimized** map controls
- **Responsive layout** adapts to any screen

---

## 🚀 Quick Start

### Online
Visit: **[https://weltogeisto.github.io/History-PDF-Reader-wirh-map-HistoMap/](https://weltogeisto.github.io/History-PDF-Reader-wirh-map-HistoMap/)**

### Local
1. Download `index.html`
2. Open in any modern browser (Chrome, Firefox, Safari, Edge)
3. Upload a PDF or scan an image with OCR

---

## 📖 Usage Guide

### Basic Workflow
1. **Upload PDF**: Click "Choose PDF" and select a historical document
2. **Auto-detection**: Locations are automatically highlighted and mapped
3. **Navigate**: Click highlighted locations or use page selector
4. **Toggle Auto**: Turn off to read without map jumping
5. **Draw traces**: Use toolbar to mark routes, regions, or events
6. **Export**: Save your annotations as GeoJSON/KML/CSV

### Controls
| Button | Function |
|--------|----------|
| **Auto** | Auto-sync map to clicked locations (ON/OFF) |
| **OCR** | Scan an image and extract text |
| **Journey** | Animate through all detected locations |
| **Export** | Download map data in multiple formats |
| **Clear** | Remove all current-page drawings |
