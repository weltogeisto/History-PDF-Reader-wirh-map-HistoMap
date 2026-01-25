# HistoMap SOTA Analysis & Comparable Projects Review

## Executive Summary

After reviewing comparable projects on GitHub, HuggingFace, and academic papers, this document identifies potential bugs, inconsistencies, and gaps relative to state-of-the-art (SOTA) solutions for historical document geoparsing and map visualization.

---

## Comparable Projects Reviewed

### Geoparsing / NER

| Project | Approach | Accuracy |
|---------|----------|----------|
| **[Mordecai 3](https://github.com/ahalterman/mordecai3)** | spaCy transformer NER + Geonames + neural ranking | Mean error: 184km |
| **[geoparsepy](https://pypi.org/project/geoparsepy/)** | OSM database, high throughput | Production-grade |
| **[geo-bert-multilingual](https://huggingface.co/k4tel/geo-bert-multilingual)** | BERT for geolocation prediction | Research-grade |
| **[Stanford NER](https://nlp.stanford.edu/software/CRF-NER.html)** | CRF-based NER | Benchmark standard |

### Map Visualization

| Project | Features |
|---------|----------|
| **[Historical-Atlas](https://github.com/shevekk/Historical-Atlas)** | Time-series border visualization |
| **[yorkeccak/history](https://github.com/yorkeccak/history)** | 3D globe, AI-powered historical context |
| **[historical-basemaps](https://github.com/aourednik/historical-basemaps)** | GeoJSON historical boundaries |
| **[L.GridLayer.PDFLayer](https://github.com/kurtraschke/L.GridLayer.PDFLayer)** | PDF rendering on Leaflet maps |

---

## HistoMap Strengths

1. **100% Client-Side Architecture** - No backend required, works offline (PWA)
2. **Dual Document Format Support** - PDF.js + epub.js integration
3. **OCR Capability** - Tesseract.js for scanned documents
4. **Context-Aware River Disambiguation** - Uses recent locations for segment selection
5. **Good UX** - Split views, journey playback, multiple export formats
6. **Longest-Match Algorithm** - Correctly handles "New York" vs "York" overlap

---

## Identified Bugs & Issues

### 1. **Regex State Bug** (Potential)
**Location:** `app.js:975-977`, `app.js:993-996`

```javascript
const regex = buildFlexibleRegex(term);
let match;
regex.lastIndex = 0; // Reset regex state
```

**Issue:** While you reset `lastIndex`, the `buildFlexibleRegex` function creates a new regex each time with the `g` flag. This is correct, but the manual reset is unnecessary and could mask issues if the regex were cached.

**Severity:** Low (defensive but unnecessary)

---

### 2. **Event Pattern Too Restrictive**
**Location:** `app.js:993`

```javascript
[/Battle of ([A-Z][a-z]+)/gi, /Siege of ([A-Z][a-z]+)/gi, ...]
```

**Issue:** Only captures single-word place names after "Battle of". Misses:
- "Battle of New York" → captures only "New"
- "Siege of Saint Petersburg" → captures only "Saint"
- Multi-part names with hyphens

**Severity:** Medium - misses legitimate historical events

**Fix suggested:**
```javascript
/Battle of ((?:[A-Z][a-z]+\s?)+)/gi
```

---

### 3. **Missing Event Keywords**
**Location:** `app.js:993`

**Issue:** Missing common historical event patterns:
- "Capture of X"
- "Sack of X"
- "Congress of X"
- "Peace of X"
- "Massacre of X"

**Severity:** Low-Medium - affects recall

---

### 4. **Disambiguation Storage Key Collision**
**Location:** `app.js:1106-1107`

```javascript
const docHash = state.documentName || 'default';
const storageKey = `disambiguation_${docHash}`;
```

**Issue:** Uses `documentName` instead of `documentHash`. Different documents with the same filename will share disambiguation choices.

**Severity:** Medium - causes incorrect disambiguation for same-named files

**Fix:** Use `state.documentHash` instead.

---

### 5. **EPUB Highlighting Only First Match**
**Location:** `app.js:1880`

```javascript
break; // Only highlight first occurrence per entity per chapter
```

**Issue:** Intentional but inconsistent with PDF behavior which highlights all occurrences. Users may expect consistent behavior.

**Severity:** Low - UI inconsistency

---

### 6. **Memory Leak in Inline Map Layer Groups**
**Location:** `app.js:797-799`

```javascript
state.inlineLayerGroup.addLayer(L.marker(coords).bindPopup(popup));
```

**Issue:** When switching view modes, inline layer groups are recreated but markers from previous sessions may accumulate if not properly cleared.

**Severity:** Low - only affects long sessions with many mode switches

---

### 7. **Race Condition in Lazy Loading**
**Location:** `app.js:1310-1326`

```javascript
if (isPlaceholder && !virtualScrollConfig.renderedPages.has(pageNum)) {
    virtualScrollConfig.observer.unobserve(entry.target);
    renderPage(pageNum).then(...)
```

**Issue:** If user scrolls quickly, the same page could be triggered for rendering multiple times before the first render completes. The `renderedPages` Set is only updated after the promise resolves.

**Severity:** Medium - could cause duplicate processing

**Fix:** Add the page to `renderedPages` immediately before calling `renderPage`:
```javascript
virtualScrollConfig.renderedPages.add(pageNum);
renderPage(pageNum).then(...).catch(() => {
    virtualScrollConfig.renderedPages.delete(pageNum);
});
```

---

### 8. **Missing Error Handling in Disambiguation Modal**
**Location:** `app.js:1067`

```javascript
entity.disambiguationOptions.forEach((option, index) => {
```

**Issue:** No null check. If `disambiguationOptions` is undefined, this throws.

**Severity:** Low - defensive coding

---

### 9. **Hardcoded Page Limit in Lazy Loading**
**Location:** `app.js:1227`

```javascript
const initialPages = Math.min(5, state.pdfDoc.numPages);
```

**Issue:** Initial render of 5 pages is hardcoded. On slow devices this may be too many; on fast devices it causes unnecessary lazy-load triggers.

**Severity:** Low - performance tuning

---

## SOTA Gap Analysis

### 1. **Limited Gazetteer Size**
| Your Project | SOTA |
|--------------|------|
| ~386 entries in geoDatabase | Mordecai uses Geonames (12M+ entries) |

**Impact:** Will miss many historical places, especially non-European locations.

**Recommendation:** Consider integrating with:
- World Historical Gazetteer (WHG)
- Pleiades (ancient places)
- GeoNames subset for historical locations

---

### 2. **Rule-Based vs ML-Based NER**
| Your Project | SOTA |
|--------------|------|
| Pattern matching with fixed dictionary | Transformer-based NER (BERT, RoBERTa) |

**Impact:**
- Lower recall for unusual place names
- No handling of OCR errors or spelling variations
- Can't learn from context

**Benchmark Reference:** On GWN corpus, spaCy+CamCoder achieves 95% accuracy@161km; rule-based systems typically achieve 70-80%.

---

### 3. **Limited Disambiguation Rules**
| Your Project | SOTA |
|--------------|------|
| 4 hardcoded rules | Neural context-based disambiguation |

**Current rules:** Georgia, Alexandria, Memphis, Tripoli

**Missing common ambiguities:**
- Paris (France vs Texas vs numerous others)
- London (UK vs Ontario vs Kentucky)
- Rome (Italy vs Georgia)
- Boston (US vs UK)
- Cambridge (UK vs US)
- Athens (Greece vs Georgia vs Ohio)
- Birmingham (UK vs Alabama)
- Richmond (Virginia vs UK vs California)
- Springfield (23 US states have one)
- Washington (state vs DC vs numerous cities)

---

### 4. **No OCR Error Correction**
**Issue:** Historical documents often have OCR errors. SOTA systems (per ACM survey on Historical NER) show F-score drops from 87% to 63% on poor OCR.

**Missing features:**
- Fuzzy matching for common OCR errors
- Character-level normalization (ſ → s, æ → ae)
- Confidence scoring based on OCR quality

---

### 5. **No Date/Time Extraction**
SOTA historical document analysis includes temporal information extraction to:
- Disambiguate places that changed names over time
- Show historical boundaries at specific dates
- Create timeline visualizations

---

### 6. **No Multilingual Support**
**Impact:** Can't process documents in French, German, Latin, Greek, Arabic, etc. - all important for historical texts.

---

## Recommended Improvements for SOTA Readiness

### Priority 1: Bug Fixes (Do Before Launch)
1. Fix disambiguation storage key collision (`documentHash` not `documentName`)
2. Fix race condition in lazy loading
3. Expand event patterns to capture multi-word places

### Priority 2: Quick Wins (High Impact, Low Effort)
1. Add 10-15 more disambiguation rules for common ambiguous names
2. Add missing event patterns (Capture, Sack, Congress, Peace, etc.)
3. Add fuzzy matching for common OCR errors (Levenshtein distance ≤ 2)

### Priority 3: Feature Parity (Medium Effort)
1. Expand geoDatabase to ~2000 entries covering major historical locations
2. Add date extraction for temporal context
3. Consistent EPUB/PDF highlighting behavior

### Priority 4: True SOTA (High Effort)
1. Integrate optional spaCy.js or transformers.js for client-side ML NER
2. Use GeoNames API for on-demand location lookup (with caching)
3. Add multilingual location name support (at minimum: French, German, Latin)

---

## Conclusion

HistoMap is a well-architected client-side application with good UX. The main gaps relative to SOTA are:

1. **Gazetteer size** - 386 vs millions of entries
2. **NER approach** - Pattern matching vs transformer-based
3. **Disambiguation coverage** - 4 rules vs comprehensive systems

For a v1.0 launch, focusing on the **bug fixes** and **expanding disambiguation rules** would significantly improve accuracy without major architectural changes.

---

## Sources

- [Mordecai 3 - Neural Geoparser](https://github.com/ahalterman/mordecai3)
- [Historical-Atlas](https://github.com/shevekk/Historical-Atlas)
- [geoparsepy](https://pypi.org/project/geoparsepy/)
- [geo-bert-multilingual](https://huggingface.co/k4tel/geo-bert-multilingual)
- [ACM Survey: NER in Historical Documents](https://dl.acm.org/doi/10.1145/3604931)
- [Transformer NER for Place Names](https://www.tandfonline.com/doi/full/10.1080/13658816.2022.2133125)
- [Machines Reading Maps](https://machines-reading-maps.github.io/)
- [historical-basemaps](https://github.com/aourednik/historical-basemaps)
