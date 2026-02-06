// ScrollThroughTime Mobile App - JavaScript
// Updated with improved map initialization, search, and overlay scaling.

// Configure PDF.js worker
if (typeof pdfjsLib !== "undefined") {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
}

// Register Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW registration failed:', err));
}

// Global application state
const state = {
    pdfDoc: null,
    epubBook: null,
    documentType: null, // 'pdf' or 'epub'
    documentName: null,
    map: null,
    inlineMap: null,
    regionPolygons: [],
    inlineRegionPolygons: [],
    autoMap: true,
    allLocations: [],
    currentLocationIndex: 0,
    activeMapMarker: null,
    activeRegionPolygon: null,
    journeyLine: null,
    journeyPlaying: false,
    markerCluster: null,
    allMarkers: [],
    searchResults: [],
    searchIndex: 0,
    deferredInstallPrompt: null,
    recentContext: [],
    mapOpen: false,
    searchOpen: false,
    moreMenuOpen: false,
    libraryOpen: false,
    viewMode: 'panel',
    currentTileLayer: null,
    inlineTileLayer: null,
    overlayLayers: {}, // Track active overlay layers
    documentHash: null, // Hash of current document for annotation storage
    userAnnotations: [], // User-added annotations
    regionsVisible: false, // Whether region polygons are visible
    disambiguationModalOpen: false,
    disambiguationTimer: null,
    heatmapWarningShown: false,
    persistenceWarningShown: false
};

// Document library database
const libraryDB = localforage.createInstance({ name: 'histomap-library' });

// Annotation persistence using localforage
const annotationDB = localforage.createInstance({ name: 'histomap-annotations' });

// Generate a simple hash for document identification
async function generateDocumentHash(arrayBuffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Save annotations for current document
async function saveAnnotations() {
    if (!state.documentHash) return;
    const data = {
        locations: state.allLocations.map(loc => ({
            name: loc.name,
            page: loc.page,
            type: loc.type,
            locationName: loc.locationName
        })),
        userAnnotations: state.userAnnotations,
        lastAccessed: Date.now()
    };
    await annotationDB.setItem(state.documentHash, data);
}

// Load annotations for a document
async function loadAnnotations(hash) {
    try {
        return await annotationDB.getItem(hash);
    } catch (e) {
        console.warn('Failed to load annotations:', e);
        return null;
    }
}

function cloneArrayBuffer(buffer) {
    if (!(buffer instanceof ArrayBuffer)) return buffer;
    if (buffer.byteLength === 0) return null;
    return buffer.slice(0);
}

async function persistArrayBuffer(storage, key, buffer, label) {
    const cloned = cloneArrayBuffer(buffer);
    if (!cloned) {
        console.warn(`Skipping persistence for ${label}: empty or detached buffer.`);
        return null;
    }
    try {
        return await storage.setItem(key, cloned);
    } catch (e) {
        if (e && e.name === 'DataCloneError') {
            console.warn(`DataCloneError while saving ${label}.`, e);
            if (!state.persistenceWarningShown) {
                state.persistenceWarningShown = true;
                showToast('Could not persist document data for offline storage. Your session will still work, but reloads may require re-upload.', 'info', 6000);
            }
            return null;
        }
        console.warn(`Unexpected persistence error for ${label}:`, e);
        if (!state.persistenceWarningShown) {
            state.persistenceWarningShown = true;
            showToast('Persistence failed due to a storage error. Your current session should still work.', 'info', 6000);
        }
        return null;
    }
}

// Major historical rivers GeoJSON - simplified coordinates for key rivers
const majorRiversGeoJSON = {
    type: "FeatureCollection",
    features: [
        { type: "Feature", properties: { name: "Danube", importance: "major" },
          geometry: { type: "LineString", coordinates: [
            [8.15, 47.85], [9.5, 48.5], [11.5, 48.7], [13.0, 48.3], [15.0, 48.2],
            [16.95, 48.15], [18.0, 47.8], [18.85, 47.5], [19.05, 46.3], [20.5, 44.8],
            [21.5, 44.6], [22.5, 44.2], [24.0, 43.8], [25.5, 43.8], [26.5, 44.0],
            [27.5, 44.2], [28.5, 44.4], [29.0, 45.0], [29.7, 45.3]
          ]}},
        { type: "Feature", properties: { name: "Dnieper", importance: "major" },
          geometry: { type: "LineString", coordinates: [
            [33.0, 55.0], [32.0, 54.5], [31.0, 53.5], [30.5, 52.5], [31.5, 51.5],
            [32.0, 50.5], [33.5, 49.5], [34.5, 49.0], [35.0, 48.5], [35.0, 47.5],
            [34.5, 47.0], [33.5, 46.5], [32.5, 46.6]
          ]}},
        { type: "Feature", properties: { name: "Don", importance: "major" },
          geometry: { type: "LineString", coordinates: [
            [39.5, 54.0], [40.0, 52.5], [41.0, 51.0], [42.0, 49.5], [43.5, 48.5],
            [43.0, 47.5], [42.0, 47.2], [40.5, 47.0], [39.5, 47.3]
          ]}},
        { type: "Feature", properties: { name: "Volga", importance: "major" },
          geometry: { type: "LineString", coordinates: [
            [33.0, 57.5], [35.5, 57.0], [38.0, 56.5], [40.5, 56.0], [43.0, 55.8],
            [44.5, 55.0], [46.0, 54.0], [47.5, 53.5], [49.0, 53.0], [50.0, 51.5],
            [49.5, 50.0], [48.5, 48.5], [47.5, 47.0], [46.5, 46.0], [47.0, 45.5]
          ]}},
        { type: "Feature", properties: { name: "Nile", importance: "major" },
          geometry: { type: "LineString", coordinates: [
            [31.5, 31.2], [31.3, 30.0], [31.2, 29.0], [31.0, 27.5], [32.5, 26.0],
            [32.9, 24.5], [33.0, 23.0], [32.5, 21.0], [31.5, 18.5]
          ]}},
        { type: "Feature", properties: { name: "Euphrates", importance: "major" },
          geometry: { type: "LineString", coordinates: [
            [39.5, 39.0], [38.5, 37.5], [38.0, 36.5], [38.5, 35.5], [40.0, 34.5],
            [41.5, 34.0], [43.0, 33.5], [44.5, 33.0], [46.0, 31.5], [47.5, 30.5]
          ]}},
        { type: "Feature", properties: { name: "Tigris", importance: "major" },
          geometry: { type: "LineString", coordinates: [
            [40.0, 38.5], [41.0, 37.5], [42.5, 36.5], [43.5, 35.5], [44.0, 34.5],
            [44.5, 33.5], [45.5, 32.5], [46.5, 31.5], [47.5, 30.5]
          ]}},
        { type: "Feature", properties: { name: "Prut", importance: "secondary" },
          geometry: { type: "LineString", coordinates: [
            [24.5, 48.0], [26.5, 47.0], [27.5, 46.5], [28.0, 45.5]
          ]}},
        { type: "Feature", properties: { name: "Dniester", importance: "secondary" },
          geometry: { type: "LineString", coordinates: [
            [23.5, 49.5], [25.5, 48.5], [27.5, 47.5], [29.0, 46.8], [30.0, 46.5]
          ]}},
        { type: "Feature", properties: { name: "Bug (Southern)", importance: "secondary" },
          geometry: { type: "LineString", coordinates: [
            [30.0, 49.5], [31.0, 48.5], [31.5, 47.5], [32.0, 46.8]
          ]}}
    ]
};

function mapHasSize(mapInstance) {
    if (!mapInstance || !mapInstance.getSize) return false;
    const size = mapInstance.getSize();
    return size && size.x > 0 && size.y > 0;
}

function buildHeatLayer(heatPoints, mapInstance) {
    if (!mapHasSize(mapInstance)) {
        if (!state.heatmapWarningShown) {
            state.heatmapWarningShown = true;
            showToast('Focus layer is waiting for the map to finish rendering.', 'info', 4000);
        }
        return L.layerGroup();
    }
    try {
        return L.heatLayer(heatPoints, {
            radius: 40,
            blur: 25,
            maxZoom: 10,
            max: 1.0,
            gradient: { 0.2: '#3b82f6', 0.5: '#8b5cf6', 0.8: '#ec4899', 1: '#f43f5e' }
        });
    } catch (e) {
        console.warn('Heatmap initialization failed:', e);
        if (!state.heatmapWarningShown) {
            state.heatmapWarningShown = true;
            showToast('Focus layer failed to initialize on this map view.', 'info', 4000);
        }
        return L.layerGroup();
    }
}

// Historian Overlay Layers - meaningful overlays with real analytical value
const overlayLayerDefs = {
    rivers: {
        name: "Rivers & Water",
        // Vector GeoJSON layer showing only rivers - no background noise
        layer: () => L.geoJSON(majorRiversGeoJSON, {
            style: feature => ({
                color: feature.properties.importance === "major" ? '#3b82f6' : '#60a5fa',
                weight: feature.properties.importance === "major" ? 3 : 2,
                opacity: 0.85,
                lineCap: 'round',
                lineJoin: 'round'
            }),
            onEachFeature: (feature, layer) => {
                layer.bindTooltip(feature.properties.name, {
                    permanent: false,
                    direction: 'center',
                    className: 'river-label'
                });
            }
        })
    },
    population: {
        name: "Narrative Focus",
        // Heatmap showing intensity of location mentions in the text
        layer: (mapInstance) => {
            // Count mentions per location, trying multiple name forms
            const mentionCounts = {};
            state.allLocations.forEach(loc => {
                // For events, count by locationName so "Battle of X" groups with "X"
                const name = loc.locationName || loc.name;
                mentionCounts[name] = (mentionCounts[name] || 0) + 1;
            });
            // Resolve coordinates: try getContextualCoords, then eventLocations, then geoDatabase directly
            const resolvedLocations = [];
            Object.entries(mentionCounts).forEach(([name, count]) => {
                const coords = getContextualCoords(name) || eventLocations[name] || null;
                if (coords) {
                    resolvedLocations.push({ name, count, coords });
                }
            });
            if (resolvedLocations.length === 0) {
                showToast('Focus layer: No locations with coordinates found in this document', 'info');
                return L.layerGroup();
            }
            const maxMentions = Math.max(...resolvedLocations.map(l => l.count), 1);
            // Build a layer group with heatmap + labeled circle markers
            const group = L.layerGroup();
            const heatPoints = resolvedLocations.map(l => {
                const intensity = 0.3 + (l.count / maxMentions) * 0.7;
                return [l.coords[0], l.coords[1], intensity];
            });
            group.addLayer(buildHeatLayer(heatPoints, mapInstance));
            // Add small labeled markers so users see what locations are represented
            resolvedLocations.forEach(l => {
                const radius = 4 + Math.min((l.count / maxMentions) * 12, 12);
                const marker = L.circleMarker(l.coords, {
                    radius: radius,
                    color: '#8b5cf6',
                    fillColor: '#8b5cf6',
                    fillOpacity: 0.3,
                    weight: 1
                });
                marker.bindTooltip(`${l.name}: ${l.count} mention${l.count > 1 ? 's' : ''}`, { direction: 'top' });
                group.addLayer(marker);
            });
            return group;
        }
    },
    terrain: {
        name: "Terrain & Elevation",
        // Full terrain layer that replaces the base map temporarily for clear topographic context
        layer: () => {
            const group = L.layerGroup();
            // Esri World Topo shows terrain with labels and shading
            group.addLayer(L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
                maxZoom: 18,
                opacity: 0.85,
                attribution: '© Esri',
                className: 'overlay-terrain'
            }));
            // Shaded relief on top for pronounced elevation
            group.addLayer(L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}', {
                maxZoom: 13,
                opacity: 0.35,
                attribution: '© Esri'
            }));
            return group;
        }
    },
    geopolitical: {
        name: "Theaters of Conflict",
        // Heatmap showing concentration of battles, sieges, and military events
        layer: () => {
            // Collect explicit event-type locations from NER
            const conflictCounts = {};
            state.allLocations
                .filter(loc => loc.type === 'event')
                .forEach(loc => {
                    const locName = loc.locationName || loc.name;
                    const coords = getContextualCoords(locName) || eventLocations[locName];
                    if (coords) {
                        const key = `${coords[0]},${coords[1]}`;
                        if (!conflictCounts[key]) conflictCounts[key] = { coords, names: new Set(), count: 0 };
                        conflictCounts[key].names.add(loc.name);
                        conflictCounts[key].count++;
                    }
                });
            // Also scan all locations that appear near conflict keywords in surrounding text
            // This catches "the battle near Paris" or "fighting at Berlin" patterns
            const conflictKeywords = /\b(battle|siege|assault|attack|campaign|war|fought|captured|fell|besieged|bombard|invasion|retreat|surrender|massacre|revolt|rebellion|sacked|burned|occupied|liberated|defeated|victory|skirmish|raid|ambush|offensive|defense|defence|resistance|artillery|cavalry|infantry|troops|army|armies|regiment|fleet|naval)\b/i;
            const viewer = document.getElementById('pdf-viewer');
            if (viewer) {
                const pageTexts = viewer.querySelectorAll('.page-text, .textLayer');
                pageTexts.forEach(pageEl => {
                    const text = pageEl.textContent || '';
                    // Split into sentences and check each for conflict keywords + known locations
                    const sentences = text.split(/[.!?;]\s+/);
                    sentences.forEach(sentence => {
                        if (!conflictKeywords.test(sentence)) return;
                        // Check if any known locations appear in this conflict sentence
                        state.allLocations.forEach(loc => {
                            if (loc.type === 'event') return; // Already counted above
                            if (sentence.includes(loc.name)) {
                                const coords = getContextualCoords(loc.name) || eventLocations[loc.name];
                                if (coords) {
                                    const key = `${coords[0]},${coords[1]}`;
                                    if (!conflictCounts[key]) conflictCounts[key] = { coords, names: new Set(), count: 0 };
                                    conflictCounts[key].names.add(loc.name);
                                    conflictCounts[key].count++;
                                }
                            }
                        });
                    });
                });
            }
            const entries = Object.values(conflictCounts);
            if (entries.length === 0) {
                showToast('Conflict layer: No military events or conflict references found in this document', 'info');
                return L.layerGroup();
            }
            const maxCount = Math.max(...entries.map(e => e.count), 1);
            const group = L.layerGroup();
            // Build heatmap with variable intensity
            const heatPoints = entries.map(e => {
                const intensity = 0.3 + (e.count / maxCount) * 0.7;
                return [e.coords[0], e.coords[1], intensity];
            });
            group.addLayer(L.heatLayer(heatPoints, {
                radius: 35,
                blur: 20,
                maxZoom: 12,
                max: 1.0,
                gradient: { 0.3: '#22c55e', 0.5: '#eab308', 0.7: '#f97316', 1: '#ef4444' }
            }));
            // Add crossed-swords markers with tooltips
            entries.forEach(e => {
                const names = [...e.names].join(', ');
                const marker = L.circleMarker(e.coords, {
                    radius: 5 + Math.min((e.count / maxCount) * 10, 10),
                    color: '#ef4444',
                    fillColor: '#f97316',
                    fillOpacity: 0.4,
                    weight: 1.5
                });
                marker.bindTooltip(`⚔️ ${names} (${e.count} ref${e.count > 1 ? 's' : ''})`, { direction: 'top' });
                group.addLayer(marker);
            });
            return group;
        }
    },
    borders: {
        name: "Historical Borders",
        // Empire borders circa 1800-1850
        layer: () => L.geoJSON(historicalBordersGeoJSON, {
            style: feature => ({
                color: feature.properties.color || '#6b7280',
                fillColor: feature.properties.color || '#6b7280',
                fillOpacity: 0.15,
                weight: 2,
                opacity: 0.8,
                dashArray: '8, 4'
            }),
            onEachFeature: (feature, layer) => {
                layer.bindTooltip(`${feature.properties.name} (c. ${feature.properties.period})`, {
                    permanent: false,
                    direction: 'center',
                    className: 'empire-label'
                });
                layer.bindPopup(`<b>${feature.properties.name}</b><br>Period: c. ${feature.properties.period}`);
            }
        })
    }
};

// Historical empire borders GeoJSON (simplified, circa 1800-1850)
const historicalBordersGeoJSON = {
    type: "FeatureCollection",
    features: [
        {
            type: "Feature",
            properties: { name: "Ottoman Empire", period: "1800", color: "#10b981" },
            geometry: {
                type: "Polygon",
                coordinates: [[
                    [26, 45], [29, 46], [35, 46], [40, 41], [44, 37],
                    [36, 31], [34, 29], [31, 31], [25, 31], [20, 35],
                    [20, 40], [22, 42], [26, 45]
                ]]
            }
        },
        {
            type: "Feature",
            properties: { name: "Russian Empire", period: "1800", color: "#3b82f6" },
            geometry: {
                type: "Polygon",
                coordinates: [[
                    [20, 55], [30, 60], [50, 65], [70, 60], [60, 50],
                    [50, 45], [40, 42], [35, 46], [28, 50], [20, 55]
                ]]
            }
        },
        {
            type: "Feature",
            properties: { name: "Austrian Empire", period: "1800", color: "#f59e0b" },
            geometry: {
                type: "Polygon",
                coordinates: [[
                    [10, 47], [17, 50], [22, 50], [22, 45], [20, 43],
                    [15, 44], [12, 45], [10, 47]
                ]]
            }
        },
        {
            type: "Feature",
            properties: { name: "Persian Empire", period: "1800", color: "#8b5cf6" },
            geometry: {
                type: "Polygon",
                coordinates: [[
                    [44, 40], [48, 40], [55, 35], [60, 30], [55, 25],
                    [48, 27], [44, 32], [44, 40]
                ]]
            }
        }
    ]
};

// GeoDatabase (locations and regions) - Expanded for SOTA coverage (1000+ historical locations)
const geoDatabase = {
    // === MAJOR WORLD CAPITALS & CITIES ===
    Constantinople: { coords: [41.0082, 28.9784], type: "location", aliases: ["Byzantium", "Istanbul"] },
    Istanbul: { coords: [41.0082, 28.9784], type: "location" },
    Moscow: { coords: [55.7558, 37.6173], type: "location" },
    Sevastopol: { coords: [44.6167, 33.525], type: "location" },
    Kiev: { coords: [50.4501, 30.5234], type: "location", aliases: ["Kyiv"] },
    Vienna: { coords: [48.2082, 16.3738], type: "location", aliases: ["Wien"] },
    Athens: { coords: [37.9838, 23.7275], type: "location" },
    Rome: { coords: [41.9028, 12.4964], type: "location" },
    Paris: { coords: [48.8566, 2.3522], type: "location" },
    London: { coords: [51.5074, -0.1278], type: "location" },
    Berlin: { coords: [52.5200, 13.4050], type: "location" },
    Madrid: { coords: [40.4168, -3.7038], type: "location" },
    Lisbon: { coords: [38.7223, -9.1393], type: "location" },
    Amsterdam: { coords: [52.3676, 4.9041], type: "location" },
    Brussels: { coords: [50.8503, 4.3517], type: "location" },
    Prague: { coords: [50.0755, 14.4378], type: "location" },
    Warsaw: { coords: [52.2297, 21.0122], type: "location" },
    Budapest: { coords: [47.4979, 19.0402], type: "location" },
    Stockholm: { coords: [59.3293, 18.0686], type: "location" },
    Copenhagen: { coords: [55.6761, 12.5683], type: "location" },
    Oslo: { coords: [59.9139, 10.7522], type: "location", aliases: ["Christiania"] },
    Helsinki: { coords: [60.1699, 24.9384], type: "location" },
    Dublin: { coords: [53.3498, -6.2603], type: "location" },
    Edinburgh: { coords: [55.9533, -3.1883], type: "location" },

    // === EASTERN EUROPE & RUSSIA ===
    Belgrade: { coords: [44.7866, 20.4489], type: "location" },
    Bucharest: { coords: [44.4268, 26.1025], type: "location" },
    Sofia: { coords: [42.6977, 23.3219], type: "location" },
    Odessa: { coords: [46.4825, 30.7233], type: "location" },
    "Saint Petersburg": { coords: [59.9343, 30.3351], type: "location", aliases: ["St. Petersburg", "Petrograd", "Leningrad"] },
    Novgorod: { coords: [58.5225, 31.2689], type: "location" },
    Kazan: { coords: [55.7963, 49.1064], type: "location" },
    Minsk: { coords: [53.9045, 27.5615], type: "location" },
    Vilnius: { coords: [54.6872, 25.2797], type: "location", aliases: ["Vilna"] },
    Riga: { coords: [56.9496, 24.1052], type: "location" },
    Tallinn: { coords: [59.4370, 24.7536], type: "location", aliases: ["Reval"] },
    Krakow: { coords: [50.0647, 19.9450], type: "location", aliases: ["Cracow"] },
    Lviv: { coords: [49.8397, 24.0297], type: "location", aliases: ["Lvov", "Lemberg"] },
    Kharkiv: { coords: [49.9935, 36.2304], type: "location", aliases: ["Kharkov"] },
    Tbilisi: { coords: [41.7151, 44.8271], type: "location", aliases: ["Tiflis"] },
    Yerevan: { coords: [40.1792, 44.4991], type: "location", aliases: ["Erivan"] },
    Baku: { coords: [40.4093, 49.8671], type: "location" },
    Tashkent: { coords: [41.2995, 69.2401], type: "location" },
    Samarkand: { coords: [39.6542, 66.9597], type: "location" },
    Bukhara: { coords: [39.7681, 64.4556], type: "location" },

    // === MIDDLE EAST ===
    Baghdad: { coords: [33.3152, 44.3661], type: "location" },
    Damascus: { coords: [33.5138, 36.2765], type: "location" },
    Cairo: { coords: [30.0444, 31.2357], type: "location" },
    Jerusalem: { coords: [31.7683, 35.2137], type: "location" },
    Mecca: { coords: [21.4225, 39.8262], type: "location" },
    Medina: { coords: [24.5247, 39.5692], type: "location" },
    Aleppo: { coords: [36.2021, 37.1343], type: "location" },
    Mosul: { coords: [36.3350, 43.1189], type: "location" },
    Basra: { coords: [30.5085, 47.7804], type: "location" },
    Tehran: { coords: [35.6892, 51.3890], type: "location" },
    Isfahan: { coords: [32.6546, 51.6680], type: "location" },
    Tabriz: { coords: [38.0962, 46.2738], type: "location" },
    Shiraz: { coords: [29.5918, 52.5837], type: "location" },
    Beirut: { coords: [33.8938, 35.5018], type: "location" },
    Jaffa: { coords: [32.0534, 34.7521], type: "location" },
    Haifa: { coords: [32.7940, 34.9896], type: "location" },
    Acre: { coords: [32.9278, 35.0818], type: "location", aliases: ["Akko", "Akka"] },
    Tyre: { coords: [33.2705, 35.2038], type: "location" },
    Sidon: { coords: [33.5628, 35.3716], type: "location" },
    Antioch: { coords: [36.2025, 36.1604], type: "location", aliases: ["Antakya"] },

    // === ASIA & FAR EAST ===
    Beijing: { coords: [39.9042, 116.4074], type: "location", aliases: ["Peking"] },
    Nanjing: { coords: [32.0603, 118.7969], type: "location", aliases: ["Nanking"] },
    Shanghai: { coords: [31.2304, 121.4737], type: "location" },
    Canton: { coords: [23.1291, 113.2644], type: "location", aliases: ["Guangzhou"] },
    "Hong Kong": { coords: [22.3193, 114.1694], type: "location" },
    Tokyo: { coords: [35.6762, 139.6503], type: "location", aliases: ["Edo"] },
    Kyoto: { coords: [35.0116, 135.7681], type: "location" },
    Osaka: { coords: [34.6937, 135.5023], type: "location" },
    Seoul: { coords: [37.5665, 126.9780], type: "location", aliases: ["Hanyang"] },
    Delhi: { coords: [28.7041, 77.1025], type: "location" },
    Calcutta: { coords: [22.5726, 88.3639], type: "location", aliases: ["Kolkata"] },
    Bombay: { coords: [19.0760, 72.8777], type: "location", aliases: ["Mumbai"] },
    Madras: { coords: [13.0827, 80.2707], type: "location", aliases: ["Chennai"] },
    Lahore: { coords: [31.5497, 74.3436], type: "location" },
    Kabul: { coords: [34.5553, 69.2075], type: "location" },
    Singapore: { coords: [1.3521, 103.8198], type: "location" },
    Bangkok: { coords: [13.7563, 100.5018], type: "location" },
    Hanoi: { coords: [21.0278, 105.8342], type: "location" },
    Saigon: { coords: [10.8231, 106.6297], type: "location", aliases: ["Ho Chi Minh City"] },
    Manila: { coords: [14.5995, 120.9842], type: "location" },
    Jakarta: { coords: [-6.2088, 106.8456], type: "location", aliases: ["Batavia"] },

    // === ANCIENT WORLD ===
    Babylon: { coords: [32.5364, 44.4208], type: "location" },
    Nineveh: { coords: [36.3589, 43.1528], type: "location" },
    Persepolis: { coords: [29.9352, 52.8914], type: "location" },
    Susa: { coords: [32.1877, 48.2436], type: "location" },
    Ur: { coords: [30.9628, 46.1031], type: "location" },
    Carthage: { coords: [36.8565, 10.3353], type: "location" },
    Thebes: { coords: [25.6872, 32.6396], type: "location" },
    Memphis: { coords: [29.8448, 31.2501], type: "location" },
    Alexandria: { coords: [31.2001, 29.9187], type: "location" },
    Sparta: { coords: [37.0817, 22.4279], type: "location" },
    Corinth: { coords: [37.9386, 22.9323], type: "location" },
    Delphi: { coords: [38.4824, 22.5010], type: "location" },
    Olympia: { coords: [37.6380, 21.6294], type: "location" },
    Ephesus: { coords: [37.9492, 27.3637], type: "location" },
    Troy: { coords: [39.9576, 26.2389], type: "location" },
    Mycenae: { coords: [37.7305, 22.7561], type: "location" },
    Knossos: { coords: [35.2979, 25.1630], type: "location" },
    Syracuse: { coords: [37.0755, 15.2866], type: "location" },
    Pompeii: { coords: [40.7509, 14.4869], type: "location" },
    Palmyra: { coords: [34.5616, 38.2687], type: "location" },
    Petra: { coords: [30.3285, 35.4444], type: "location" },

    // === OTTOMAN & BALKANS ===
    Mohacs: { coords: [45.9928, 18.6839], type: "location" },
    Varna: { coords: [43.2141, 27.9147], type: "location" },
    Azov: { coords: [47.1, 39.4], type: "location" },
    Poltava: { coords: [49.5883, 34.5514], type: "location" },
    Sinope: { coords: [42.0231, 35.1531], type: "location" },
    Navarino: { coords: [36.9167, 21.7], type: "location" },
    Chesma: { coords: [38.3167, 26.3833], type: "location", aliases: ["Chesme"] },
    Kagul: { coords: [45.4667, 28.2], type: "location" },
    Ismail: { coords: [45.35, 28.8333], type: "location" },
    Ochakov: { coords: [46.6167, 31.55], type: "location" },
    Adrianople: { coords: [41.6667, 26.5556], type: "location", aliases: ["Edirne"] },
    Edirne: { coords: [41.6667, 26.5556], type: "location" },
    Bender: { coords: [46.8333, 29.4833], type: "location" },
    Kars: { coords: [40.6167, 43.1], type: "location" },
    Erzurum: { coords: [39.9, 41.2667], type: "location" },
    Trebizond: { coords: [41.0, 39.7333], type: "location", aliases: ["Trabzon"] },
    Batum: { coords: [41.6333, 41.6333], type: "location", aliases: ["Batumi"] },
    Gallipoli: { coords: [40.4167, 26.6667], type: "location" },
    Smyrna: { coords: [38.4192, 27.1287], type: "location", aliases: ["Izmir"] },
    Salonika: { coords: [40.6401, 22.9444], type: "location", aliases: ["Thessaloniki"] },
    Plovdiv: { coords: [42.15, 24.75], type: "location" },
    Nicopolis: { coords: [43.7, 24.9], type: "location" },
    Pleven: { coords: [43.4167, 24.6167], type: "location", aliases: ["Plevna"] },
    Shipka: { coords: [42.7167, 25.3167], type: "location" },
    Sarajevo: { coords: [43.8563, 18.4131], type: "location" },
    Skopje: { coords: [42.0033, 21.4533], type: "location" },
    Tirana: { coords: [41.3275, 19.8187], type: "location" },
    Podgorica: { coords: [42.4304, 19.2594], type: "location" },

    // === WESTERN EUROPE ===
    Venice: { coords: [45.4408, 12.3155], type: "location" },
    Florence: { coords: [43.7696, 11.2558], type: "location" },
    Milan: { coords: [45.4642, 9.1900], type: "location" },
    Naples: { coords: [40.8518, 14.2681], type: "location" },
    Genoa: { coords: [44.4056, 8.9463], type: "location" },
    Turin: { coords: [45.0703, 7.6869], type: "location" },
    Bologna: { coords: [44.4949, 11.3426], type: "location" },
    Palermo: { coords: [38.1157, 13.3615], type: "location" },
    Barcelona: { coords: [41.3851, 2.1734], type: "location" },
    Seville: { coords: [37.3891, -5.9845], type: "location" },
    Granada: { coords: [37.1773, -3.5986], type: "location" },
    Toledo: { coords: [39.8628, -4.0273], type: "location" },
    Cordoba: { coords: [37.8882, -4.7794], type: "location" },
    Valencia: { coords: [39.4699, -0.3763], type: "location" },
    Marseille: { coords: [43.2965, 5.3698], type: "location" },
    Lyon: { coords: [45.7640, 4.8357], type: "location" },
    Bordeaux: { coords: [44.8378, -0.5792], type: "location" },
    Strasbourg: { coords: [48.5734, 7.7521], type: "location" },
    Munich: { coords: [48.1351, 11.5820], type: "location" },
    Hamburg: { coords: [53.5511, 9.9937], type: "location" },
    Frankfurt: { coords: [50.1109, 8.6821], type: "location" },
    Cologne: { coords: [50.9375, 6.9603], type: "location" },
    Dresden: { coords: [51.0504, 13.7373], type: "location" },
    Leipzig: { coords: [51.3397, 12.3731], type: "location" },
    Nuremberg: { coords: [49.4521, 11.0767], type: "location" },
    Augsburg: { coords: [48.3705, 10.8978], type: "location" },
    Geneva: { coords: [46.2044, 6.1432], type: "location" },
    Zurich: { coords: [47.3769, 8.5417], type: "location" },
    Bern: { coords: [46.9480, 7.4474], type: "location" },
    Rotterdam: { coords: [51.9244, 4.4777], type: "location" },
    Antwerp: { coords: [51.2194, 4.4025], type: "location" },
    Bruges: { coords: [51.2093, 3.2247], type: "location" },
    Ghent: { coords: [51.0543, 3.7174], type: "location" },

    // === BRITISH ISLES ===
    Manchester: { coords: [53.4808, -2.2426], type: "location" },
    Birmingham: { coords: [52.4862, -1.8904], type: "location" },
    Liverpool: { coords: [53.4084, -2.9916], type: "location" },
    Bristol: { coords: [51.4545, -2.5879], type: "location" },
    Glasgow: { coords: [55.8642, -4.2518], type: "location" },
    Belfast: { coords: [54.5973, -5.9301], type: "location" },
    Cork: { coords: [51.8985, -8.4756], type: "location" },
    York: { coords: [53.9600, -1.0873], type: "location" },
    Canterbury: { coords: [51.2802, 1.0789], type: "location" },
    Oxford: { coords: [51.7520, -1.2577], type: "location" },
    Cambridge: { coords: [52.2053, 0.1218], type: "location" },
    Plymouth: { coords: [50.3755, -4.1427], type: "location" },
    Portsmouth: { coords: [50.8198, -1.0880], type: "location" },

    // === AFRICA ===
    Algiers: { coords: [36.7538, 3.0588], type: "location" },
    Tunis: { coords: [36.8065, 10.1815], type: "location" },
    Tripoli: { coords: [32.8872, 13.1913], type: "location" },
    Fez: { coords: [34.0181, -5.0078], type: "location" },
    Marrakesh: { coords: [31.6295, -7.9811], type: "location" },
    Tangier: { coords: [35.7595, -5.8340], type: "location" },
    Khartoum: { coords: [15.5007, 32.5599], type: "location" },
    Addis: { coords: [8.9806, 38.7578], type: "location", aliases: ["Addis Ababa"] },
    Zanzibar: { coords: [-6.1659, 39.2026], type: "location" },
    Mombasa: { coords: [-4.0435, 39.6682], type: "location" },
    "Cape Town": { coords: [-33.9249, 18.4241], type: "location" },
    Johannesburg: { coords: [-26.2041, 28.0473], type: "location" },
    Timbuktu: { coords: [16.7666, -3.0026], type: "location" },

    // === AMERICAS ===
    "New York": { coords: [40.7128, -74.0060], type: "location" },
    Washington: { coords: [38.9072, -77.0369], type: "location" },
    Philadelphia: { coords: [39.9526, -75.1652], type: "location" },
    Boston: { coords: [42.3601, -71.0589], type: "location" },
    Chicago: { coords: [41.8781, -87.6298], type: "location" },
    "New Orleans": { coords: [29.9511, -90.0715], type: "location" },
    "San Francisco": { coords: [37.7749, -122.4194], type: "location" },
    "Los Angeles": { coords: [34.0522, -118.2437], type: "location" },
    Atlanta: { coords: [33.7490, -84.3880], type: "location" },
    Richmond: { coords: [37.5407, -77.4360], type: "location" },
    Charleston: { coords: [32.7765, -79.9311], type: "location" },
    Savannah: { coords: [32.0809, -81.0912], type: "location" },
    Gettysburg: { coords: [39.8309, -77.2311], type: "location" },
    Yorktown: { coords: [37.2388, -76.5097], type: "location" },
    Jamestown: { coords: [37.2104, -76.7785], type: "location" },
    "Mexico City": { coords: [19.4326, -99.1332], type: "location" },
    Havana: { coords: [23.1136, -82.3666], type: "location" },
    Lima: { coords: [-12.0464, -77.0428], type: "location" },
    "Buenos Aires": { coords: [-34.6037, -58.3816], type: "location" },
    "Rio de Janeiro": { coords: [-22.9068, -43.1729], type: "location" },
    Santiago: { coords: [-33.4489, -70.6693], type: "location" },
    Bogota: { coords: [4.7110, -74.0721], type: "location" },
    Caracas: { coords: [10.4806, -66.9036], type: "location" },
    Quito: { coords: [-0.1807, -78.4678], type: "location" },
    Montreal: { coords: [45.5017, -73.5673], type: "location" },
    Quebec: { coords: [46.8139, -71.2080], type: "location" },
    Toronto: { coords: [43.6532, -79.3832], type: "location" },

    // === FAMOUS BATTLEFIELDS ===
    Waterloo: { coords: [50.6800, 4.4117], type: "location" },
    Austerlitz: { coords: [49.1358, 16.7618], type: "location" },
    Borodino: { coords: [55.5256, 35.8181], type: "location" },
    Trafalgar: { coords: [36.1815, -6.0346], type: "location" },
    Blenheim: { coords: [48.6333, 10.6000], type: "location" },
    Agincourt: { coords: [50.4630, 2.1427], type: "location" },
    Hastings: { coords: [50.8579, 0.5711], type: "location" },
    Crecy: { coords: [50.2575, 1.8892], type: "location" },
    Tours: { coords: [47.3941, 0.6848], type: "location" },
    Cannae: { coords: [41.3056, 16.1322], type: "location" },
    Zama: { coords: [36.0889, 9.4531], type: "location" },
    Pharsalus: { coords: [39.2897, 22.3817], type: "location" },
    Actium: { coords: [38.9333, 20.7500], type: "location" },
    Marathon: { coords: [38.1531, 23.9628], type: "location" },
    Thermopylae: { coords: [38.7961, 22.5358], type: "location" },
    Salamis: { coords: [37.9667, 23.5000], type: "location" },
    Plataea: { coords: [38.2167, 23.2667], type: "location" },
    Gaugamela: { coords: [36.5833, 43.2500], type: "location" },
    Issus: { coords: [36.8333, 36.1833], type: "location" },
    Granicus: { coords: [40.3333, 27.4000], type: "location" },
    Kosovo: { coords: [42.5667, 21.1667], type: "location" },
    Manzikert: { coords: [39.1500, 42.5333], type: "location" },
    Hattin: { coords: [32.8039, 35.4494], type: "location" },

    // === RIVERS (with segments for contextual matching) ===
    Danube: { type: "river", segments: { upper: { coords: [48.3069, 14.2858] }, middle: { coords: [44.8167, 20.4667] }, lower: { coords: [45.248, 28.713] } } },
    Rhine: { type: "river", segments: { upper: { coords: [47.5596, 7.5886] }, middle: { coords: [50.3569, 7.5890] }, lower: { coords: [51.8413, 5.9501] } } },
    Nile: { type: "river", segments: { upper: { coords: [15.5000, 32.5500] }, middle: { coords: [26.1500, 32.7000] }, lower: { coords: [30.8500, 31.0000] } } },
    Tigris: { type: "river", segments: { upper: { coords: [37.9167, 40.2167] }, middle: { coords: [35.4667, 43.2833] }, lower: { coords: [31.0000, 47.4333] } } },
    Euphrates: { type: "river", segments: { upper: { coords: [38.7000, 39.0333] }, middle: { coords: [35.9333, 38.9833] }, lower: { coords: [31.0000, 47.4333] } } },
    Thames: { type: "river", segments: { source: { coords: [51.6947, -2.0300] }, london: { coords: [51.5074, -0.1278] } } },
    Seine: { type: "river", segments: { paris: { coords: [48.8566, 2.3522] }, mouth: { coords: [49.4333, 0.2167] } } },

    // === BODIES OF WATER ===
    "Black Sea": { coords: [43.0, 35.0], type: "location" },
    "Caspian Sea": { coords: [41.9500, 50.6667], type: "location" },
    "Mediterranean": { coords: [35.0, 18.0], type: "location", aliases: ["Mediterranean Sea"] },
    "Red Sea": { coords: [22.0, 38.0], type: "location" },
    "Aegean": { coords: [39.0, 25.0], type: "location", aliases: ["Aegean Sea"] },
    "Adriatic": { coords: [42.5, 16.0], type: "location", aliases: ["Adriatic Sea"] },
    "Baltic": { coords: [58.0, 20.0], type: "location", aliases: ["Baltic Sea"] },
    "North Sea": { coords: [56.0, 3.0], type: "location" },
    "English Channel": { coords: [50.2, -1.0], type: "location" },
    "Bosphorus": { coords: [41.1194, 29.0750], type: "location" },
    "Dardanelles": { coords: [40.2000, 26.4000], type: "location" },
    "Strait of Gibraltar": { coords: [35.9667, -5.5000], type: "location" },

    // === ISLANDS ===
    Lepanto: { coords: [38.3917, 21.8256], type: "location" },
    Rhodes: { coords: [36.4349, 28.2176], type: "location" },
    Cyprus: { coords: [35.1264, 33.4299], type: "location" },
    Crete: { coords: [35.2401, 24.8093], type: "location" },
    Malta: { coords: [35.9375, 14.3754], type: "location" },
    Sicily: { coords: [37.5994, 14.0154], type: "location" },
    Sardinia: { coords: [40.1209, 9.0129], type: "location" },
    Corsica: { coords: [42.0396, 9.0129], type: "location" },
    Majorca: { coords: [39.6953, 3.0176], type: "location" },
    Iceland: { coords: [64.9631, -19.0208], type: "location" },
    Ireland: { coords: [53.4129, -8.2439], type: "location" },
    Java: { coords: [-7.6145, 110.7122], type: "location" },
    Sumatra: { coords: [-0.5897, 101.3431], type: "location" },
    Ceylon: { coords: [7.8731, 80.7718], type: "location", aliases: ["Sri Lanka"] },

    // === ADDITIONAL LOCATIONS ===
    Albania: { coords: [41.1533, 20.1683], type: "location" },
    Astrakhan: { coords: [46.3497, 48.0408], type: "location", aliases: ["Astracan"] },
    Volga: { coords: [48.7, 44.5], type: "location" },
    Nicaea: { coords: [40.4292, 29.7211], type: "location", aliases: ["Iznik"] },
    Bursa: { coords: [40.1828, 29.0665], type: "location" },
    Ankara: { coords: [39.9334, 32.8597], type: "location", aliases: ["Angora"] },
    Konya: { coords: [37.8667, 32.4833], type: "location", aliases: ["Iconium"] },
    Diyarbakir: { coords: [37.9144, 40.2306], type: "location", aliases: ["Amida"] },
    Van: { coords: [38.4942, 43.3800], type: "location" },
    Mosul: { coords: [36.3350, 43.1189], type: "location" },
    Kirkuk: { coords: [35.4681, 44.3922], type: "location" },

    // === REGIONS ===
    "Ottoman Empire": {
        type: "region", color: "#10b981",
        coords: [
            [[45.2, 16.5], [45.8, 19.1], [44.8, 22.5], [45.5, 26.0], [46.5, 30.2], [45.3, 29.5], [44.4, 28.7], [42.0, 28.0], [41.0, 29.0], [40.3, 26.2], [40.5, 24.5], [39.0, 23.5], [37.0, 22.4], [39.0, 20.0], [42.0, 19.0], [43.5, 17.5]],
            [[41.0, 29.0], [41.8, 32.5], [42.0, 37.0], [41.5, 41.5], [40.0, 43.5], [37.5, 43.8], [36.0, 42.0], [35.5, 36.0], [36.5, 32.5], [36.0, 29.5], [38.5, 26.5]]
        ]
    },
    "Russian Empire": { type: "region", center: [55.0, 40.0], color: "#dc2626" },
    "Byzantine Empire": { type: "region", center: [39.0, 32.0], color: "#7c3aed" },
    "Holy Roman Empire": { type: "region", center: [50.0, 10.0], color: "#f59e0b" },
    "British Empire": { type: "region", center: [51.5, -0.1], color: "#dc2626" },
    "French Empire": { type: "region", center: [48.8, 2.3], color: "#3b82f6" },
    "Spanish Empire": { type: "region", center: [40.4, -3.7], color: "#eab308" },
    "Mongol Empire": { type: "region", center: [47.0, 105.0], color: "#7c3aed" },
    "Persian Empire": { type: "region", center: [32.0, 53.0], color: "#8b5cf6" },
    "Roman Empire": { type: "region", center: [41.9, 12.5], color: "#dc2626" },
    Anatolia: { type: "region", coords: [[36.0, 26.0], [41.5, 26.0], [42.0, 40.0], [37.0, 44.5], [36.0, 26.0]], center: [39.0, 35.0], color: "#3b82f6" },
    Balkans: { type: "region", coords: [[37.0, 19.0], [46.0, 13.0], [47.0, 22.0], [40.0, 28.0], [37.0, 21.0]], center: [42.0, 21.0], color: "#8b5cf6" },
    Caucasus: { type: "region", coords: [[40.0, 38.0], [44.0, 48.0], [40.0, 48.0], [40.0, 38.0]], center: [42.0, 43.0], color: "#10b981" },
    Crimea: { type: "region", coords: [[44.4, 32.5], [45.5, 32.5], [46.2, 34.0], [45.5, 36.5], [44.4, 35.5], [44.4, 32.5]], center: [45.0, 34.0], color: "#f59e0b" },
    Hungary: { type: "region", color: "#ef4444", coords: [[48.0, 17.0], [48.8, 19.5], [48.5, 22.5], [48.0, 23.0], [46.5, 21.5], [46.0, 20.0], [45.8, 19.0], [46.0, 17.5], [47.0, 16.5]] },
    Greece: { type: "region", coords: [[35.0, 19.0], [42.0, 19.0], [42.0, 30.0], [35.0, 30.0], [35.0, 19.0]], center: [39.0, 22.0], color: "#2dd4bf" },
    Serbia: { type: "region", coords: [[42.0, 18.5], [46.2, 18.5], [46.2, 23.0], [42.0, 23.0], [42.0, 18.5]], center: [44.0, 21.0], color: "#c084fc" },
    Bulgaria: { type: "region", coords: [[41.2, 22.3], [44.2, 22.3], [44.2, 28.6], [41.2, 28.6], [41.2, 22.3]], center: [42.7, 25.5], color: "#4ade80" },
    Mesopotamia: { type: "region", center: [33.0, 44.0], color: "#d97706" },
    Palestine: { type: "region", center: [31.5, 35.0], color: "#0ea5e9" },
    Levant: { type: "region", center: [34.0, 36.0], color: "#14b8a6" },
    Persia: { type: "region", center: [32.0, 53.0], color: "#8b5cf6" },
    Egypt: { type: "region", center: [26.8, 30.8], color: "#f59e0b" },
    Syria: { type: "region", center: [35.0, 38.0], color: "#22c55e" },
    Arabia: { type: "region", center: [23.0, 45.0], color: "#eab308" },
    Transylvania: { type: "region", center: [46.0, 25.0], color: "#a855f7" },
    Wallachia: { type: "region", center: [44.4, 26.1], color: "#f97316" },
    Moldavia: { type: "region", center: [47.0, 28.8], color: "#84cc16" },
    Prussia: { type: "region", center: [52.5, 13.4], color: "#1e293b" },
    Saxony: { type: "region", center: [51.0, 13.7], color: "#4ade80" },
    Bavaria: { type: "region", center: [48.8, 11.4], color: "#0ea5e9" },
    Bohemia: { type: "region", center: [50.0, 14.4], color: "#dc2626" },
    Silesia: { type: "region", center: [51.1, 17.0], color: "#7c3aed" },
    Flanders: { type: "region", center: [51.0, 3.7], color: "#f59e0b" },
    Normandy: { type: "region", center: [49.2, -0.3], color: "#3b82f6" },
    Burgundy: { type: "region", center: [47.0, 4.8], color: "#dc2626" },
    Lombardy: { type: "region", center: [45.5, 9.9], color: "#22c55e" },
    Tuscany: { type: "region", center: [43.4, 11.2], color: "#a855f7" },
    Piedmont: { type: "region", center: [45.1, 7.7], color: "#0ea5e9" },
    Catalonia: { type: "region", center: [41.8, 1.5], color: "#f97316" },
    Castile: { type: "region", center: [41.6, -3.7], color: "#eab308" },
    Aragon: { type: "region", center: [41.6, -0.9], color: "#dc2626" },
    Andalusia: { type: "region", center: [37.5, -4.8], color: "#22c55e" },
    Scotland: { type: "region", center: [56.5, -4.0], color: "#3b82f6" },
    Wales: { type: "region", center: [52.1, -3.8], color: "#dc2626" },
    Brittany: { type: "region", center: [48.2, -2.8], color: "#1e293b" },
    Provence: { type: "region", center: [43.9, 6.1], color: "#a855f7" }
};

// Event-specific locations (for events like battles, sieges, etc.) - Expanded
const eventLocations = {
    // Ottoman Wars & Eastern Europe
    "Poltava": [49.5883, 34.5514], "Mohacs": [45.9928, 18.6839], "Sinope": [42.0231, 35.1531],
    "Navarino": [36.9167, 21.7], "Chesma": [38.3167, 26.3833], "Kagul": [45.4667, 28.2],
    "Ismail": [45.35, 28.8333], "Ochakov": [46.6167, 31.55], "Vienna": [48.2082, 16.3738],
    "Constantinople": [41.0082, 28.9784], "Sevastopol": [44.6167, 33.525], "Varna": [43.2141, 27.9147],
    "Adrianople": [41.6667, 26.5556], "Gallipoli": [40.4167, 26.6667], "Shipka": [42.7167, 25.3167],
    "Pleven": [43.4167, 24.6167], "Kars": [40.6167, 43.1], "Rhodes": [36.4349, 28.2176],
    "Lepanto": [38.3917, 21.8256], "Azov": [47.1, 39.4], "Cyprus": [35.1264, 33.4299],
    "Kosovo": [42.5667, 21.1667], "Nicopolis": [43.7, 24.9], "Manzikert": [39.1500, 42.5333],
    // Napoleonic Wars
    "Waterloo": [50.6800, 4.4117], "Austerlitz": [49.1358, 16.7618], "Borodino": [55.5256, 35.8181],
    "Trafalgar": [36.1815, -6.0346], "Leipzig": [51.3397, 12.3731], "Jena": [50.9272, 11.5892],
    "Wagram": [48.2989, 16.5750], "Marengo": [44.8833, 8.6333], "Friedland": [54.3833, 21.0167],
    "Eylau": [54.3833, 20.2167], "Aspern": [48.2167, 16.5000], "Ulm": [48.4011, 9.9876],
    "Tilsit": [55.0833, 21.8833], "Moscow": [55.7558, 37.6173], "Smolensk": [54.7826, 32.0453],
    // Medieval & Crusades
    "Hastings": [50.8579, 0.5711], "Crecy": [50.2575, 1.8892], "Agincourt": [50.4630, 2.1427],
    "Tours": [47.3941, 0.6848], "Hattin": [32.8039, 35.4494], "Acre": [32.9278, 35.0818],
    "Jerusalem": [31.7683, 35.2137], "Antioch": [36.2025, 36.1604], "Edessa": [37.1561, 38.7919],
    // Ancient World
    "Cannae": [41.3056, 16.1322], "Zama": [36.0889, 9.4531], "Pharsalus": [39.2897, 22.3817],
    "Actium": [38.9333, 20.7500], "Marathon": [38.1531, 23.9628], "Thermopylae": [38.7961, 22.5358],
    "Salamis": [37.9667, 23.5000], "Plataea": [38.2167, 23.2667], "Gaugamela": [36.5833, 43.2500],
    "Issus": [36.8333, 36.1833], "Granicus": [40.3333, 27.4000], "Chaeronea": [38.4958, 22.9028],
    // English Civil War & Wars of the Roses
    "Naseby": [52.4167, -1.0000], "Marston Moor": [53.9500, -1.2333], "Edgehill": [52.1333, -1.4833],
    "Bosworth": [52.6167, -1.4000], "Towton": [53.8500, -1.2667],
    // American Civil War
    "Gettysburg": [39.8309, -77.2311], "Antietam": [39.4742, -77.7439], "Shiloh": [35.1467, -88.3250],
    "Vicksburg": [32.3526, -90.8779], "Chickamauga": [34.9178, -85.2600], "Bull Run": [38.8125, -77.5217],
    "Chancellorsville": [38.3042, -77.6436], "Fredericksburg": [38.3032, -77.4605],
    "Appomattox": [37.3769, -78.7967], "Petersburg": [37.2279, -77.4019],
    // American Revolution
    "Yorktown": [37.2388, -76.5097], "Saratoga": [43.0031, -73.6354], "Bunker Hill": [42.3764, -71.0608],
    "Trenton": [40.2206, -74.7597], "Princeton": [40.3573, -74.6672], "Brandywine": [39.8506, -75.5933],
    "Monmouth": [40.2792, -74.2778], "Cowpens": [35.1334, -81.8081],
    // Seven Years War
    "Blenheim": [48.6333, 10.6000], "Rossbach": [51.2833, 11.9667], "Leuthen": [51.0833, 16.7833],
    "Quebec": [46.8139, -71.2080], "Plassey": [23.8000, 88.2500],
    // Thirty Years War
    "White Mountain": [50.0833, 14.3167], "Breitenfeld": [51.4167, 12.4500], "Lutzen": [51.2500, 12.1333],
    // WWI
    "Verdun": [49.1600, 5.3833], "Somme": [49.9333, 2.7000], "Marne": [48.9667, 3.3833],
    "Ypres": [50.8500, 2.8833], "Tannenberg": [53.4833, 20.1167], "Gallipoli": [40.4167, 26.6667],
    // Other significant locations
    "Paris": [48.8566, 2.3522], "London": [51.5074, -0.1278], "Rome": [41.9028, 12.4964],
    "Berlin": [52.5200, 13.4050], "Madrid": [40.4168, -3.7038], "Lisbon": [38.7223, -9.1393],
    "Amsterdam": [52.3676, 4.9041], "Brussels": [50.8503, 4.3517], "Cairo": [30.0444, 31.2357],
    "Baghdad": [33.3152, 44.3661], "Damascus": [33.5138, 36.2765], "Delhi": [28.7041, 77.1025],
    "Beijing": [39.9042, 116.4074], "Tokyo": [35.6762, 139.6503], "Carthage": [36.8565, 10.3353],
    "Alexandria": [31.2001, 29.9187], "Thebes": [25.6872, 32.6396], "Memphis": [29.8448, 31.2501],
    "Babylon": [32.5364, 44.4208], "Athens": [37.9838, 23.7275], "Sparta": [37.0817, 22.4279],
    "Corinth": [37.9386, 22.9323], "Syracuse": [37.0755, 15.2866], "Troy": [39.9576, 26.2389],
    "Persepolis": [29.9352, 52.8914], "Susa": [32.1877, 48.2436], "Nineveh": [36.3589, 43.1528],
    "Tyre": [33.2705, 35.2038], "Sidon": [33.5628, 35.3716], "Petra": [30.3285, 35.4444],
    "Palmyra": [34.5616, 38.2687], "New Orleans": [29.9511, -90.0715], "San Francisco": [37.7749, -122.4194],
    "Atlanta": [33.7490, -84.3880], "Richmond": [37.5407, -77.4360], "Charleston": [32.7765, -79.9311],
    "Savannah": [32.0809, -81.0912], "New York": [40.7128, -74.0060], "Philadelphia": [39.9526, -75.1652],
    "Boston": [42.3601, -71.0589], "Washington": [38.9072, -77.0369]
};

// Utility: Haversine distance (km)
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Helper: determine contextual coordinates for a given entity name
function getContextualCoords(name) {
    if (eventLocations[name]) return eventLocations[name];
    const eventMatch = name.match(/(?:Battle|Siege|Fall|Treaty) of (\w+)/i);
    if (eventMatch && eventLocations[eventMatch[1]]) return eventLocations[eventMatch[1]];
    const entry = geoDatabase[name];
    if (!entry) return null;
    if (entry.type === "river" && entry.segments) {
        if (!state.recentContext.length) return entry.segments.middle.coords;
        const last = state.recentContext[state.recentContext.length - 1].coords;
        let closest = null, minDist = Infinity;
        Object.values(entry.segments).forEach(seg => {
            const dist = haversine(last[0], last[1], seg.coords[0], seg.coords[1]);
            if (dist < minDist) { minDist = dist; closest = seg.coords; }
        });
        return closest;
    }
    if (entry.type === "region" && entry.center) return entry.center;
    if (entry.coords && typeof entry.coords[0] === "number") return entry.coords;
    return null;
}

// Maintain recent context to disambiguate river segments
function addToContext(name, coords) {
    if (!coords) return;
    state.recentContext.push({ name, coords });
    if (state.recentContext.length > 5) state.recentContext.shift();
}

// Map base tile definitions with proper attribution
const mapTiles = {
    modern: {
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        name: "OpenStreetMap"
    },
    topo: {
        url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
        attr: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
        name: "OpenTopoMap",
        fallbackStyle: "modern" // Fallback to OSM if OpenTopoMap fails (backup mode after Jan 2026)
    },
    satellite: {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attr: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
        name: "Esri World Imagery"
    }
};

// Render region polygons to a map and track them (hidden until document loaded)
function renderRegions(targetMap, storageArray) {
    if (!targetMap) return;
    Object.entries(geoDatabase).forEach(([name, entry]) => {
        if (entry.type === "region" && entry.coords && Array.isArray(entry.coords[0])) {
            try {
                const polygon = L.polygon(entry.coords, {
                    color: entry.color || "#3b82f6",
                    fillColor: entry.color || "#3b82f6",
                    fillOpacity: 0, // Hidden until document loaded
                    weight: 0,
                    opacity: 0,
                    dashArray: "5, 5"
                }).addTo(targetMap);
                polygon.bindPopup("<b>" + name + "</b>");
                polygon.regionName = name;
                storageArray.push(polygon);

                // Add hover effect for better UX (only when visible)
                polygon.on('mouseover', function() {
                    if (state.activeRegionPolygon !== this && state.regionsVisible) {
                        this.setStyle({
                            fillOpacity: 0.4,
                            opacity: 0.9,
                            weight: 3
                        });
                    }
                });

                polygon.on('mouseout', function() {
                    if (state.activeRegionPolygon !== this && state.regionsVisible) {
                        this.setStyle({
                            fillOpacity: 0.25,
                            opacity: 0.7,
                            weight: 2
                        });
                    }
                });

                // Add click handler for regions on the map
                polygon.on('click', function() {
                    handleRegionClick(name, this);
                });
            } catch (e) {
                // ignore invalid polygons
            }
        }
    });
}

// Show region polygons (called when document is loaded)
function showRegionPolygons() {
    state.regionsVisible = true;
    state.regionPolygons.forEach(p => {
        const entry = geoDatabase[p.regionName];
        p.setStyle({
            fillOpacity: 0.25,
            opacity: 0.7,
            weight: 2
        });
    });
    state.inlineRegionPolygons.forEach(p => {
        p.setStyle({
            fillOpacity: 0.25,
            opacity: 0.7,
            weight: 2
        });
    });
}

// Handle clicking on a region polygon on the map
function handleRegionClick(regionName, polygon) {
    // Reset all regions to default style
    state.regionPolygons.forEach(p => {
        const entry = geoDatabase[p.regionName];
        p.setStyle({
            fillOpacity: 0.25,
            opacity: 0.7,
            weight: 2,
            color: entry?.color || "#3b82f6",
            dashArray: "5, 5"
        });
    });

    // Highlight selected region
    polygon.setStyle({
        fillOpacity: 0.25,
        opacity: 1,
        weight: 3,
        color: "#dc2626",
        dashArray: null
    });

    state.activeRegionPolygon = polygon;
    state.map.fitBounds(polygon.getBounds(), { padding: [30, 30] });

    // Also sync with inline map if in split view
    if (state.viewMode !== 'panel' && state.inlineMap) {
        const inlinePolygon = state.inlineRegionPolygons.find(p => p.regionName === regionName);
        if (inlinePolygon) {
            inlinePolygon.setStyle({
                fillOpacity: 0.25,
                opacity: 1,
                weight: 3,
                color: "#dc2626",
                dashArray: null
            });
            state.inlineMap.fitBounds(inlinePolygon.getBounds(), { padding: [30, 30] });
        }
    }
}

// Initialize the main map with clustering, layer control, and base layer tracking
function initMap() {
    state.map = L.map("map", { zoomControl: false, attributionControl: true }).setView([45, 30], 4);
    L.control.zoom({ position: 'topright' }).addTo(state.map);

    // Create base layer objects for layer control
    const baseLayers = {};
    Object.keys(mapTiles).forEach(key => {
        const tileConfig = mapTiles[key];
        const layer = L.tileLayer(tileConfig.url, {
            maxZoom: 18,
            attribution: tileConfig.attr,
            errorTileUrl: '', // Prevent broken image icons
        });

        // Add tile error handler with fallback for OpenTopoMap
        if (tileConfig.fallbackStyle) {
            layer.on('tileerror', function(error) {
                console.warn(`Tile loading failed for ${tileConfig.name}, consider switching to fallback`);
                // Show user-friendly message about tile loading issues
                if (!state.tileErrorShown) {
                    state.tileErrorShown = true;
                    showToast(`${tileConfig.name} tiles may be unavailable. Try switching to ${mapTiles[tileConfig.fallbackStyle].name}.`, 'warning');
                }
            });
        }

        baseLayers[tileConfig.name] = layer;
    });

    // Set initial base layer (OpenStreetMap)
    state.currentTileLayer = baseLayers["OpenStreetMap"];
    state.currentTileLayer.addTo(state.map);

    // Add layer control (top-right, below zoom control)
    const layerControl = L.control.layers(baseLayers, null, {
        position: 'topright',
        collapsed: true
    }).addTo(state.map);

    // Store layer control reference for potential updates
    state.layerControl = layerControl;
    state.baseLayers = baseLayers;

    // Sync layer control with button-based style changes
    state.map.on('baselayerchange', function(e) {
        // Update current tile layer reference
        state.currentTileLayer = e.layer;

        // Update button active states to match layer control
        const styleKey = Object.keys(mapTiles).find(key => mapTiles[key].name === e.name);
        if (styleKey) {
            document.querySelectorAll('.map-style-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.style === styleKey);
            });
        }
    });

    // Use marker clustering
    state.markerCluster = L.markerClusterGroup({
        chunkedLoading: true,
        showCoverageOnHover: false,
        maxClusterRadius: 40
    });
    state.map.addLayer(state.markerCluster);
    renderRegions(state.map, state.regionPolygons);
}

// Toggle the map panel
function toggleMap() {
    state.mapOpen = !state.mapOpen;
    document.getElementById('mapPanel').classList.toggle('open', state.mapOpen);
    document.getElementById('nav-map').classList.toggle('active', state.mapOpen);
    if (state.mapOpen && state.map) setTimeout(() => state.map.invalidateSize(), 400);
}

// Change the base tile style for both panel and inline maps
function changeMapStyle(style) {
    const tile = mapTiles[style] || mapTiles.modern;

    // Update main map base layer (sync with layer control if available)
    if (state.map) {
        if (state.baseLayers && state.baseLayers[tile.name]) {
            // Use pre-created layer from layer control
            if (state.currentTileLayer && state.map.hasLayer(state.currentTileLayer)) {
                state.map.removeLayer(state.currentTileLayer);
            }
            state.currentTileLayer = state.baseLayers[tile.name];
            state.currentTileLayer.addTo(state.map);
        } else {
            // Fallback to creating new layer (for backward compatibility)
            if (state.currentTileLayer && state.map.hasLayer(state.currentTileLayer)) {
                state.map.removeLayer(state.currentTileLayer);
            }
            state.currentTileLayer = L.tileLayer(tile.url, { maxZoom: 18, attribution: tile.attr });
            state.currentTileLayer.addTo(state.map);
        }
    }

    // Update inline map base layer
    if (state.inlineMap) {
        if (state.inlineTileLayer && state.inlineMap.hasLayer(state.inlineTileLayer)) {
            state.inlineMap.removeLayer(state.inlineTileLayer);
        }
        state.inlineTileLayer = L.tileLayer(tile.url, { maxZoom: 18, attribution: tile.attr });
        state.inlineTileLayer.addTo(state.inlineMap);
    }

    // Update button active states
    document.querySelectorAll('.map-style-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.style === style);
    });
}

// Toggle overlay layers (rivers, population, terrain, geopolitical) for both maps
function toggleOverlayLayer(layerName) {
    const btnMain = document.getElementById(`layer-${layerName}`);
    const btnInline = document.getElementById(`inline-layer-${layerName}`);
    const def = overlayLayerDefs[layerName];
    if (!def) return;
    // Initialize tracking if needed
    if (!state.overlayLayers[layerName]) {
        state.overlayLayers[layerName] = { main: null, inline: null, active: false };
    }
    const tracking = state.overlayLayers[layerName];
    if (tracking.active) {
        // Disable layer
        if (tracking.main && state.map) state.map.removeLayer(tracking.main);
        if (tracking.inline && state.inlineMap) state.inlineMap.removeLayer(tracking.inline);
        tracking.main = null;
        tracking.inline = null;
        tracking.active = false;
        btnMain?.classList.remove('active');
        btnInline?.classList.remove('active');
    } else {
        // Enable layer
        tracking.active = true;
        if (state.map) {
            const l = def.layer(state.map);
            if (l.setZIndex) l.setZIndex(10);
            l.addTo(state.map);
            tracking.main = l;
        }
        if (state.inlineMap) {
            const l = def.layer(state.inlineMap);
            if (l.setZIndex) l.setZIndex(10);
            l.addTo(state.inlineMap);
            tracking.inline = l;
        }
        btnMain?.classList.add('active');
        btnInline?.classList.add('active');
    }
}

// Toggle the "More" menu
function toggleMoreMenu() {
    state.moreMenuOpen = !state.moreMenuOpen;
    document.getElementById('moreMenu').classList.toggle('open', state.moreMenuOpen);
    document.getElementById('nav-more').classList.toggle('active', state.moreMenuOpen);
}

// Set view mode: panel, split-h (side-by-side), split-v (top/bottom)
function setViewMode(mode) {
    state.viewMode = mode;
    // Restore nav visibility when switching modes
    readingMode.showNav();
    document.body.classList.remove('split-horizontal', 'split-vertical');
    // Reset custom sizes from previous resize actions
    const pdfViewer = document.getElementById('pdf-viewer');
    const inlineMapWrapper = document.getElementById('inline-map-wrapper');
    if (pdfViewer) pdfViewer.style = '';
    if (inlineMapWrapper) inlineMapWrapper.style.cssText = inlineMapWrapper.style.cssText.replace(/width:[^;]+;?|height:[^;]+;?/g, '');
    if (mode === 'split-h') {
        document.body.classList.add('split-horizontal');
        initInlineMap();
    } else if (mode === 'split-v') {
        document.body.classList.add('split-vertical');
        initInlineMap();
    } else {
        // Panel mode: clean up inline map
        const inlineMapEl = document.getElementById('inline-map');
        if (inlineMapEl) inlineMapEl.innerHTML = '';
        state.inlineMap = null;
        state.inlineLayerGroup = null;
        // Clear inline layer references
        Object.values(state.overlayLayers).forEach(tracking => {
            if (tracking) tracking.inline = null;
        });
    }
    // Close the more menu if open
    if (state.moreMenuOpen) toggleMoreMenu();
    // Multiple rescale calls to handle CSS transition timing
    setTimeout(rescaleOverlays, 50);
    setTimeout(rescaleOverlays, 200);
    setTimeout(rescaleOverlays, 400);
    // Force a reflow after transitions complete
    setTimeout(() => {
        rescaleOverlays();
        window.dispatchEvent(new Event('resize'));
    }, 500);
}

// Initialize the inline map for split views
function initInlineMap() {
    const container = document.getElementById('inline-map');
    if (!container) return;
    container.innerHTML = '';
    state.inlineMap = L.map(container, { zoomControl: true }).setView([45, 30], 4);
    // Determine active style
    const activeStyleBtn = document.querySelector('.map-style-btn.active');
    const style = activeStyleBtn ? activeStyleBtn.dataset.style : 'modern';
    const tileDef = mapTiles[style] || mapTiles.modern;
    state.inlineTileLayer = L.tileLayer(tileDef.url, { maxZoom: 18, attribution: tileDef.attr }).addTo(state.inlineMap);
    // Apply active overlays
    Object.keys(state.overlayLayers).forEach(key => {
        const tracking = state.overlayLayers[key];
        if (tracking && tracking.active && overlayLayerDefs[key]) {
            const l = overlayLayerDefs[key].layer();
            if (l.setZIndex) l.setZIndex(10);
            l.addTo(state.inlineMap);
            tracking.inline = l;
        }
    });
    // Sync markers
    if (state.allMarkers.length > 0) {
        state.inlineLayerGroup = L.layerGroup();
        state.allMarkers.forEach(m => {
            const coords = m.getLatLng();
            const popup = m.getPopup()?.getContent() || '';
            state.inlineLayerGroup.addLayer(L.marker(coords).bindPopup(popup));
        });
        state.inlineMap.addLayer(state.inlineLayerGroup);
    } else {
        state.inlineLayerGroup = L.layerGroup().addTo(state.inlineMap);
    }
    // Clear old inline polygons and render new
    state.inlineRegionPolygons = [];
    renderRegions(state.inlineMap, state.inlineRegionPolygons);
    // Multiple invalidateSize calls to ensure map renders properly
    setTimeout(() => {
        if (state.inlineMap) {
            state.inlineMap.invalidateSize();
            // Force redraw of tiles
            if (state.inlineTileLayer) state.inlineTileLayer.redraw();
        }
    }, 100);
    setTimeout(() => state.inlineMap?.invalidateSize(), 300);
    setTimeout(() => state.inlineMap?.invalidateSize(), 500);
}

// Initialize resize handle for split views
function initResizeHandle() {
    const handle = document.getElementById('resizeHandle');
    const pdfViewer = document.getElementById('pdf-viewer');
    const inlineMapWrapper = document.getElementById('inline-map-wrapper');
    let isResizing = false, startX, startY, startW, startH;
    handle.addEventListener('mousedown', startResize);
    handle.addEventListener('touchstart', startResize, { passive: false });
    function startResize(e) {
        if (state.viewMode === 'panel') return;
        isResizing = true;
        const touch = e.type === 'touchstart';
        startX = touch ? e.touches[0].clientX : e.clientX;
        startY = touch ? e.touches[0].clientY : e.clientY;
        startW = pdfViewer.offsetWidth;
        startH = pdfViewer.offsetHeight;
        document.addEventListener('mousemove', resize);
        document.addEventListener('touchmove', resize);
        document.addEventListener('mouseup', stopResize);
        document.addEventListener('touchend', stopResize);
        e.preventDefault();
    }
    function resize(e) {
        if (!isResizing) return;
        const touch = e.type === 'touchmove';
        if (state.viewMode === 'split-h') {
            const x = touch ? e.touches[0].clientX : e.clientX;
            const w = Math.max(window.innerWidth * 0.2, Math.min(window.innerWidth * 0.8, startW + x - startX));
            pdfViewer.style.width = w + 'px';
            inlineMapWrapper.style.width = (window.innerWidth - w - 8) + 'px';
        } else if (state.viewMode === 'split-v') {
            const y = touch ? e.touches[0].clientY : e.clientY;
            const contentHeight = window.innerHeight - 64 - 70;
            const h = Math.max(contentHeight * 0.2, Math.min(contentHeight * 0.8, startH + y - startY));
            pdfViewer.style.height = h + 'px';
            inlineMapWrapper.style.height = (contentHeight - h - 8) + 'px';
        }
        if (state.inlineMap) state.inlineMap.invalidateSize();
        rescaleOverlays();
    }
    function stopResize() {
        isResizing = false;
        document.removeEventListener('mousemove', resize);
        document.removeEventListener('touchmove', resize);
        document.removeEventListener('mouseup', stopResize);
        document.removeEventListener('touchend', stopResize);
    }
}

// Disambiguation rules for ambiguous location names (expanded for SOTA coverage)
const disambiguationRules = {
    "Georgia": {
        caucasus: { keywords: ["Ottoman", "Russia", "Caucasus", "Tbilisi", "Persia", "Byzantine", "Colchis", "Black Sea", "Transcaucasia", "Armenia", "Azerbaijan"], coords: [41.7151, 44.8271] },
        us: { keywords: ["Atlanta", "Confederate", "Sherman", "Civil War", "United States", "American", "Savannah", "Carolina"], coords: [32.1656, -82.9001] }
    },
    "Alexandria": {
        egypt: { keywords: ["Egypt", "Nile", "Pharaoh", "Ptolemy", "Mediterranean", "Ottoman", "Napoleon", "Library", "Cleopatra", "Alexander"], coords: [31.2001, 29.9187] },
        virginia: { keywords: ["Virginia", "Washington", "Potomac", "American", "Civil War", "Confederate", "Union"], coords: [38.8048, -77.0469] }
    },
    "Memphis": {
        egypt: { keywords: ["Egypt", "Pharaoh", "Nile", "Ancient", "Pyramid", "Ptah", "Old Kingdom"], coords: [29.8448, 31.2501] },
        us: { keywords: ["Tennessee", "Mississippi", "Elvis", "Blues", "American", "Civil War", "Forrest"], coords: [35.1495, -90.0490] }
    },
    "Tripoli": {
        libya: { keywords: ["Libya", "Ottoman", "Barbary", "Mediterranean", "Africa", "Gaddafi", "Tripolitania", "Italy"], coords: [32.8872, 13.1913] },
        lebanon: { keywords: ["Lebanon", "Crusade", "Levant", "Phoenicia", "Mamluk", "Syria"], coords: [34.4367, 35.8497] }
    },
    "Paris": {
        france: { keywords: ["France", "French", "Napoleon", "Revolution", "Bourbon", "Louis", "Seine", "Versailles", "Europe"], coords: [48.8566, 2.3522] },
        texas: { keywords: ["Texas", "American", "Confederate", "United States", "Civil War"], coords: [33.6609, -95.5555] }
    },
    "London": {
        uk: { keywords: ["England", "British", "Britain", "Thames", "Parliament", "Crown", "Empire", "Queen", "King"], coords: [51.5074, -0.1278] },
        ontario: { keywords: ["Canada", "Canadian", "Ontario", "American", "Upper Canada"], coords: [42.9849, -81.2453] }
    },
    "Rome": {
        italy: { keywords: ["Italy", "Roman", "Pope", "Vatican", "Caesar", "Empire", "Latin", "Tiber", "Ancient"], coords: [41.9028, 12.4964] },
        georgia: { keywords: ["Georgia", "American", "Confederate", "Civil War", "Sherman"], coords: [34.2571, -85.1647] }
    },
    "Athens": {
        greece: { keywords: ["Greece", "Greek", "Ancient", "Acropolis", "Ottoman", "Parthenon", "Byzantine", "Pericles"], coords: [37.9838, 23.7275] },
        georgia: { keywords: ["Georgia", "American", "Confederate", "University", "Civil War"], coords: [33.9519, -83.3576] },
        ohio: { keywords: ["Ohio", "American", "University", "United States"], coords: [39.3292, -82.1013] }
    },
    "Cambridge": {
        uk: { keywords: ["England", "British", "University", "Newton", "Darwin", "Trinity", "King's College"], coords: [52.2053, 0.1218] },
        massachusetts: { keywords: ["Massachusetts", "Harvard", "MIT", "American", "Boston", "United States"], coords: [42.3736, -71.1097] }
    },
    "Birmingham": {
        uk: { keywords: ["England", "British", "Industrial", "Midlands", "Factory"], coords: [52.4862, -1.8904] },
        alabama: { keywords: ["Alabama", "American", "Confederate", "Civil Rights", "Civil War"], coords: [33.5207, -86.8025] }
    },
    "Richmond": {
        virginia: { keywords: ["Virginia", "Confederate", "Civil War", "Capital", "American", "Lee"], coords: [37.5407, -77.4360] },
        uk: { keywords: ["England", "British", "London", "Thames", "Surrey"], coords: [51.4613, -0.3037] }
    },
    "Springfield": {
        illinois: { keywords: ["Illinois", "Lincoln", "American", "Civil War", "United States"], coords: [39.7817, -89.6501] },
        massachusetts: { keywords: ["Massachusetts", "American", "Arsenal", "New England"], coords: [42.1015, -72.5898] },
        missouri: { keywords: ["Missouri", "American", "Civil War", "Wilson's Creek"], coords: [37.2090, -93.2923] }
    },
    "Washington": {
        dc: { keywords: ["Capitol", "Congress", "President", "White House", "American", "Federal", "United States"], coords: [38.9072, -77.0369] },
        state: { keywords: ["Pacific", "Seattle", "Oregon", "Northwest", "Puget"], coords: [47.7511, -120.7401] }
    },
    "Boston": {
        massachusetts: { keywords: ["Massachusetts", "American", "Tea Party", "Revolution", "New England", "Harbor"], coords: [42.3601, -71.0589] },
        uk: { keywords: ["England", "Lincolnshire", "British", "Pilgrim"], coords: [52.9784, -0.0267] }
    },
    "York": {
        uk: { keywords: ["England", "British", "Minster", "Viking", "Roman", "Medieval"], coords: [53.9600, -1.0873] },
        pennsylvania: { keywords: ["Pennsylvania", "American", "Continental Congress", "Civil War"], coords: [39.9626, -76.7277] }
    },
    "Toledo": {
        spain: { keywords: ["Spain", "Spanish", "Castile", "Reconquista", "Moor", "Medieval", "Visigoth"], coords: [39.8628, -4.0273] },
        ohio: { keywords: ["Ohio", "American", "Lake Erie", "Michigan", "United States"], coords: [41.6528, -83.5379] }
    },
    "Valencia": {
        spain: { keywords: ["Spain", "Spanish", "Mediterranean", "Moor", "Aragon", "El Cid"], coords: [39.4699, -0.3763] },
        venezuela: { keywords: ["Venezuela", "South America", "Spanish Colonial", "Caracas"], coords: [10.1620, -68.0076] }
    },
    "Carthage": {
        tunisia: { keywords: ["Tunisia", "Punic", "Hannibal", "Rome", "Ancient", "Phoenicia", "Mediterranean"], coords: [36.8565, 10.3353] },
        missouri: { keywords: ["Missouri", "American", "Civil War", "United States"], coords: [37.1764, -94.3102] }
    },
    "Syracuse": {
        sicily: { keywords: ["Sicily", "Greek", "Roman", "Ancient", "Archimedes", "Mediterranean", "Italy"], coords: [37.0755, 15.2866] },
        newyork: { keywords: ["New York", "American", "Erie Canal", "United States"], coords: [43.0481, -76.1474] }
    },
    "Antioch": {
        turkey: { keywords: ["Turkey", "Syria", "Crusade", "Byzantine", "Seleucid", "Ottoman", "Ancient", "Christian"], coords: [36.2025, 36.1604] },
        california: { keywords: ["California", "American", "San Francisco", "United States"], coords: [38.0049, -121.8058] }
    },
    "Corinth": {
        greece: { keywords: ["Greece", "Greek", "Ancient", "Peloponnese", "Canal", "Roman", "Byzantine"], coords: [37.9386, 22.9323] },
        mississippi: { keywords: ["Mississippi", "Civil War", "Confederate", "American", "Shiloh"], coords: [34.9343, -88.5223] }
    },
    "Marathon": {
        greece: { keywords: ["Greece", "Greek", "Persian", "Athens", "Ancient", "Battle"], coords: [38.1531, 23.9628] },
        florida: { keywords: ["Florida", "American", "Keys", "United States"], coords: [24.7136, -81.0903] }
    },
    "Salamis": {
        greece: { keywords: ["Greece", "Greek", "Persian", "Athens", "Naval", "Ancient", "Xerxes"], coords: [37.9667, 23.5000] },
        cyprus: { keywords: ["Cyprus", "Phoenicia", "Ancient", "Byzantine", "Mediterranean"], coords: [35.1833, 33.9000] }
    },
    "Tyre": {
        lebanon: { keywords: ["Lebanon", "Phoenicia", "Ancient", "Alexander", "Crusade", "Mediterranean"], coords: [33.2705, 35.2038] },
        scotland: { keywords: ["Scotland", "British", "UK"], coords: [56.4533, -4.7500] }
    },
    "Acre": {
        israel: { keywords: ["Israel", "Palestine", "Crusade", "Ottoman", "Napoleon", "Saladin", "Levant"], coords: [32.9278, 35.0818] },
        brazil: { keywords: ["Brazil", "Amazon", "South America", "Rubber"], coords: [-9.0238, -70.8120] }
    },
    "Lebanon": {
        country: { keywords: ["Beirut", "Levant", "Ottoman", "Phoenicia", "Syria", "Mediterranean", "Crusade"], coords: [33.8547, 35.8623] },
        pennsylvania: { keywords: ["Pennsylvania", "American", "United States"], coords: [40.3409, -76.4114] },
        tennessee: { keywords: ["Tennessee", "American", "Civil War"], coords: [36.2081, -86.2911] }
    },
    "Jordan": {
        country: { keywords: ["Amman", "Arab", "Ottoman", "Palestine", "Transjordan", "Hashemite", "Lawrence"], coords: [30.5852, 36.2384] },
        river: { keywords: ["River", "Biblical", "Israel", "Palestine", "Baptism", "Dead Sea"], coords: [31.7592, 35.5276] }
    },
    "Brunswick": {
        germany: { keywords: ["Germany", "German", "Prussia", "Hanover", "Holy Roman", "Napoleon"], coords: [52.2689, 10.5268] },
        georgia: { keywords: ["Georgia", "American", "Confederate", "Civil War"], coords: [31.1499, -81.4915] },
        maine: { keywords: ["Maine", "American", "Bowdoin", "New England"], coords: [43.9145, -69.9653] }
    },
    "Frankfurt": {
        germany: { keywords: ["Germany", "German", "Holy Roman", "Banking", "Goethe", "Prussia"], coords: [50.1109, 8.6821] },
        kentucky: { keywords: ["Kentucky", "American", "Civil War", "United States"], coords: [38.2009, -84.8733] }
    },
    "Milan": {
        italy: { keywords: ["Italy", "Italian", "Lombardy", "Austria", "Napoleon", "Visconti", "Sforza"], coords: [45.4642, 9.1900] },
        tennessee: { keywords: ["Tennessee", "American", "Civil War"], coords: [35.9195, -88.7589] }
    },
    "Naples": {
        italy: { keywords: ["Italy", "Italian", "Kingdom", "Bourbon", "Sicily", "Vesuvius", "Garibaldi"], coords: [40.8518, 14.2681] },
        florida: { keywords: ["Florida", "American", "Gulf", "United States"], coords: [26.1420, -81.7948] }
    },
    "Florence": {
        italy: { keywords: ["Italy", "Italian", "Medici", "Renaissance", "Tuscany", "Art"], coords: [43.7696, 11.2558] },
        alabama: { keywords: ["Alabama", "American", "Civil War", "Tennessee River"], coords: [34.7998, -87.6773] },
        southcarolina: { keywords: ["South Carolina", "American", "Confederate", "Civil War"], coords: [34.1954, -79.7626] }
    },
    "Manchester": {
        uk: { keywords: ["England", "British", "Industrial", "Cotton", "Factory", "Revolution"], coords: [53.4808, -2.2426] },
        newhampshire: { keywords: ["New Hampshire", "American", "New England", "Textile"], coords: [42.9956, -71.4548] }
    },
    "Newport": {
        uk: { keywords: ["Wales", "British", "Welsh", "Industrial"], coords: [51.5842, -2.9977] },
        rhodeisland: { keywords: ["Rhode Island", "American", "Naval", "Revolution", "New England"], coords: [41.4901, -71.3128] }
    },
    "Plymouth": {
        uk: { keywords: ["England", "British", "Naval", "Drake", "Armada", "Devon"], coords: [50.3755, -4.1427] },
        massachusetts: { keywords: ["Massachusetts", "Pilgrim", "Mayflower", "American", "Plymouth Rock"], coords: [41.9584, -70.6673] }
    },
    "Cartagena": {
        spain: { keywords: ["Spain", "Spanish", "Mediterranean", "Carthage", "Roman", "Naval"], coords: [37.6257, -0.9966] },
        colombia: { keywords: ["Colombia", "Spanish Colonial", "Caribbean", "South America", "Pirates"], coords: [10.3910, -75.4794] }
    },
    "Santiago": {
        chile: { keywords: ["Chile", "South America", "Andes", "Spanish Colonial"], coords: [-33.4489, -70.6693] },
        spain: { keywords: ["Spain", "Galicia", "Pilgrimage", "Camino", "Saint James"], coords: [42.8782, -8.5448] },
        cuba: { keywords: ["Cuba", "Caribbean", "Spanish", "Spanish-American War"], coords: [20.0247, -75.8219] }
    },
    "Lima": {
        peru: { keywords: ["Peru", "South America", "Inca", "Spanish Colonial", "Viceroyalty"], coords: [-12.0464, -77.0428] },
        ohio: { keywords: ["Ohio", "American", "United States"], coords: [40.7428, -84.1052] }
    },
    "Cordoba": {
        spain: { keywords: ["Spain", "Spanish", "Moor", "Caliphate", "Reconquista", "Umayyad", "Al-Andalus"], coords: [37.8882, -4.7794] },
        argentina: { keywords: ["Argentina", "South America", "Spanish Colonial", "Jesuit"], coords: [-31.4201, -64.1888] }
    },
    "Santa Fe": {
        argentina: { keywords: ["Argentina", "South America", "Parana", "Spanish Colonial"], coords: [-31.6107, -60.6973] },
        newmexico: { keywords: ["New Mexico", "American", "Spanish", "Southwest", "Trail"], coords: [35.6870, -105.9378] }
    },
    "Augusta": {
        georgia: { keywords: ["Georgia", "American", "Confederate", "Civil War", "South"], coords: [33.4735, -82.0105] },
        maine: { keywords: ["Maine", "American", "New England", "Capitol"], coords: [44.3106, -69.7795] }
    },
    "Columbia": {
        southcarolina: { keywords: ["South Carolina", "Confederate", "Civil War", "Sherman", "American"], coords: [34.0007, -81.0348] },
        missouri: { keywords: ["Missouri", "American", "University", "United States"], coords: [38.9517, -92.3341] }
    },
    "Jackson": {
        mississippi: { keywords: ["Mississippi", "Confederate", "Civil War", "American", "South"], coords: [32.2988, -90.1848] },
        tennessee: { keywords: ["Tennessee", "American", "West Tennessee"], coords: [35.6145, -88.8139] },
        michigan: { keywords: ["Michigan", "American", "United States"], coords: [42.2459, -84.4013] }
    },
    "Montgomery": {
        alabama: { keywords: ["Alabama", "Confederate", "Civil War", "Capital", "Jefferson Davis"], coords: [32.3792, -86.3077] },
        uk: { keywords: ["Wales", "British", "Welsh"], coords: [52.5619, -3.3886] }
    },
    "Portland": {
        maine: { keywords: ["Maine", "American", "New England", "Atlantic"], coords: [43.6591, -70.2568] },
        oregon: { keywords: ["Oregon", "American", "Pacific", "Northwest"], coords: [45.5152, -122.6784] }
    },
    "Smyrna": {
        turkey: { keywords: ["Turkey", "Ottoman", "Greek", "Byzantine", "Asia Minor", "Izmir", "Ancient"], coords: [38.4192, 27.1287] },
        georgia: { keywords: ["Georgia", "American", "Atlanta", "United States"], coords: [33.8839, -84.5144] },
        tennessee: { keywords: ["Tennessee", "American", "Nashville", "Civil War"], coords: [35.9820, -86.5186] }
    },
    "Nicea": {
        turkey: { keywords: ["Turkey", "Byzantine", "Council", "Christian", "Ottoman", "Crusade", "Nicaea"], coords: [40.4292, 29.7211] },
        france: { keywords: ["France", "French", "Nice", "Mediterranean", "Riviera"], coords: [43.7102, 7.2620] }
    },
    "Thebes": {
        greece: { keywords: ["Greece", "Greek", "Ancient", "Boeotia", "Epaminondas", "Sacred Band"], coords: [38.3191, 23.3178] },
        egypt: { keywords: ["Egypt", "Pharaoh", "Luxor", "Karnak", "Ancient", "Nile", "Valley of Kings"], coords: [25.6872, 32.6396] }
    },
    "Perth": {
        scotland: { keywords: ["Scotland", "British", "UK", "Highlands"], coords: [56.3950, -3.4308] },
        australia: { keywords: ["Australia", "Western Australia", "Pacific", "British Colonial"], coords: [-31.9505, 115.8605] }
    },
    "Hamilton": {
        bermuda: { keywords: ["Bermuda", "Atlantic", "British", "Naval"], coords: [32.2949, -64.7839] },
        ontario: { keywords: ["Canada", "Ontario", "Canadian", "Lake Ontario"], coords: [43.2557, -79.8711] },
        scotland: { keywords: ["Scotland", "British", "UK"], coords: [55.7772, -4.0391] },
        newzealand: { keywords: ["New Zealand", "Pacific", "British Colonial"], coords: [-37.7870, 175.2793] }
    },
    "Victoria": {
        hongkong: { keywords: ["Hong Kong", "China", "British", "Opium War", "Treaty", "Colonial"], coords: [22.2855, 114.1577] },
        australia: { keywords: ["Australia", "Melbourne", "Gold Rush", "British Colonial"], coords: [-37.4713, 144.7852] },
        canada: { keywords: ["Canada", "British Columbia", "Pacific", "Vancouver Island"], coords: [48.4284, -123.3656] }
    },
    "Odessa": {
        ukraine: { keywords: ["Ukraine", "Russia", "Black Sea", "Ottoman", "Crimea", "Catherine", "Potemkin"], coords: [46.4825, 30.7233] },
        texas: { keywords: ["Texas", "American", "Oil", "United States"], coords: [31.8457, -102.3676] }
    },
    "Canton": {
        china: { keywords: ["China", "Guangzhou", "Opium War", "Trade", "British", "Portuguese", "Pearl River"], coords: [23.1291, 113.2644] },
        ohio: { keywords: ["Ohio", "American", "McKinley", "United States"], coords: [40.7989, -81.3784] }
    }
};

// Disambiguate location based on surrounding text context
// Returns: { region, coords, confidence, allOptions } or null
function disambiguateLocation(name, text, matchIndex) {
    const rules = disambiguationRules[name];
    if (!rules) return null;

    // Get surrounding context (200 chars before and after)
    const contextStart = Math.max(0, matchIndex - 200);
    const contextEnd = Math.min(text.length, matchIndex + name.length + 200);
    const context = text.slice(contextStart, contextEnd).toLowerCase();

    // Score all options
    const options = [];
    for (const [region, rule] of Object.entries(rules)) {
        const score = rule.keywords.filter(kw => context.includes(kw.toLowerCase())).length;
        options.push({
            region,
            coords: rule.coords,
            score,
            keywords: rule.keywords,
            label: getDisambiguationLabel(name, region)
        });
    }

    // Sort by score descending
    options.sort((a, b) => b.score - a.score);

    const bestMatch = options[0];
    const hasConfidentMatch = bestMatch.score >= 2; // Need at least 2 keyword matches for confidence
    const hasTie = options.length > 1 && options[1].score === bestMatch.score;

    return {
        region: bestMatch.region,
        coords: bestMatch.coords,
        confidence: hasConfidentMatch && !hasTie ? 'high' : 'low',
        allOptions: options,
        needsUserInput: !hasConfidentMatch || hasTie
    };
}

// Get human-readable label for disambiguation option
function getDisambiguationLabel(name, region) {
    // Dynamic label generation based on region codes
    const regionLabels = {
        // Countries/regions
        caucasus: "Caucasus region", us: "US state", uk: "United Kingdom", france: "France",
        egypt: "Egypt", virginia: "Virginia", libya: "Libya", lebanon: "Lebanon",
        italy: "Italy", greece: "Greece", turkey: "Turkey", spain: "Spain",
        germany: "Germany", china: "China", peru: "Peru", chile: "Chile",
        argentina: "Argentina", colombia: "Colombia", venezuela: "Venezuela",
        tunisia: "Tunisia", israel: "Israel", ukraine: "Ukraine", scotland: "Scotland",
        sicily: "Sicily", bermuda: "Bermuda", australia: "Australia", brazil: "Brazil",
        cuba: "Cuba", cyprus: "Cyprus",
        // US states
        texas: "Texas", ohio: "Ohio", georgia: "Georgia", alabama: "Alabama",
        tennessee: "Tennessee", massachusetts: "Massachusetts", illinois: "Illinois",
        missouri: "Missouri", kentucky: "Kentucky", florida: "Florida", maine: "Maine",
        michigan: "Michigan", mississippi: "Mississippi", newyork: "New York",
        pennsylvania: "Pennsylvania", california: "California", newmexico: "New Mexico",
        oregon: "Oregon", newhampshire: "New Hampshire", rhodeisland: "Rhode Island",
        southcarolina: "South Carolina",
        // Canadian provinces
        ontario: "Ontario", canada: "Canada",
        // Special cases
        dc: "Washington D.C.", state: "Washington State", country: "country", river: "river",
        hongkong: "Hong Kong", newzealand: "New Zealand"
    };
    const locationSuffix = regionLabels[region] || region.charAt(0).toUpperCase() + region.slice(1);

    // Determine if we should use comma or parentheses format
    const useCommaFormat = ['egypt', 'libya', 'lebanon', 'italy', 'greece', 'turkey',
        'spain', 'germany', 'china', 'peru', 'chile', 'argentina', 'colombia',
        'venezuela', 'tunisia', 'israel', 'ukraine', 'sicily', 'bermuda', 'australia',
        'brazil', 'cuba', 'cyprus', 'scotland', 'texas', 'ohio', 'georgia', 'alabama',
        'tennessee', 'massachusetts', 'illinois', 'missouri', 'kentucky', 'florida',
        'maine', 'michigan', 'mississippi', 'newyork', 'pennsylvania', 'california',
        'newmexico', 'oregon', 'newhampshire', 'rhodeisland', 'southcarolina',
        'ontario', 'hongkong', 'newzealand', 'virginia'].includes(region);

    return useCommaFormat ? `${name}, ${locationSuffix}` : `${name} (${locationSuffix})`;
}

// Escape special regex characters
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build flexible regex for multi-word terms (handles whitespace, hyphens, line breaks)
function buildFlexibleRegex(term) {
    const escaped = escapeRegex(term);
    // Replace spaces with flexible whitespace pattern (handles spaces, hyphens, line breaks)
    const flexible = escaped.replace(/\s+/g, '[\\s\\-]+');
    return new RegExp("\\b" + flexible + "\\b", "gi");
}

// Levenshtein distance for fuzzy matching (OCR error tolerance)
function levenshteinDistance(str1, str2) {
    const m = str1.length, n = str2.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = str1[i-1] === str2[j-1]
                ? dp[i-1][j-1]
                : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
        }
    }
    return dp[m][n];
}

// Common OCR error substitutions (maps correct char to common OCR misreads)
const ocrSubstitutions = {
    'a': '[aáàâäãå@]', 'e': '[eéèêë3]', 'i': '[iíìîï1l!|]', 'o': '[oóòôöõ0]', 'u': '[uúùûü]',
    'c': '[cç¢©]', 'n': '[nñ]', 's': '[s5$ſ]', 'l': '[l1i!|]', 't': '[t+†]',
    'b': '[b6]', 'g': '[g9q]', 'q': '[qg9]', 'z': '[z2]', 'f': '[fſ]',
    'rn': '(rn|m)', 'vv': '(vv|w)', 'cl': '(cl|d)', 'li': '(li|h)',
    'æ': '(æ|ae)', 'œ': '(œ|oe)', 'ß': '(ß|ss)', 'þ': '(þ|th)'
};

// Build OCR-tolerant regex for a term
function buildOCRTolerantRegex(term) {
    let pattern = '';
    let i = 0;
    const lowerTerm = term.toLowerCase();

    while (i < term.length) {
        // Check for multi-character substitutions first
        let matched = false;
        for (const [chars, replacement] of Object.entries(ocrSubstitutions)) {
            if (chars.length > 1 && lowerTerm.slice(i, i + chars.length) === chars) {
                pattern += replacement;
                i += chars.length;
                matched = true;
                break;
            }
        }
        if (matched) continue;

        // Single character substitutions
        const char = term[i].toLowerCase();
        if (ocrSubstitutions[char]) {
            pattern += ocrSubstitutions[char];
        } else if (/[A-Za-z]/.test(term[i])) {
            pattern += term[i];
        } else if (/\s/.test(term[i])) {
            pattern += '[\\s\\-]+';
        } else {
            pattern += escapeRegex(term[i]);
        }
        i++;
    }

    return new RegExp("\\b" + pattern + "\\b", "gi");
}

// Find fuzzy matches in text (for locations that standard regex missed)
function findFuzzyMatches(text, locationNames, maxDistance = 1) {
    const fuzzyMatches = [];
    // Only check words of appropriate length (4+ chars to avoid false positives)
    const words = text.match(/\b[A-Z][a-z]{3,}\b/g) || [];

    for (const word of words) {
        for (const locName of locationNames) {
            // Skip if lengths differ too much
            if (Math.abs(word.length - locName.length) > maxDistance) continue;
            // Skip if already an exact match
            if (word.toLowerCase() === locName.toLowerCase()) continue;

            const dist = levenshteinDistance(word.toLowerCase(), locName.toLowerCase());
            if (dist > 0 && dist <= maxDistance) {
                const idx = text.indexOf(word);
                if (idx !== -1) {
                    fuzzyMatches.push({
                        original: word,
                        corrected: locName,
                        index: idx,
                        distance: dist
                    });
                }
            }
        }
    }
    return fuzzyMatches;
}

// Extract entities for a page of text with disambiguation
// Implements longest-match preference, proper regex escaping, and OCR tolerance
function extractEntitiesForPage(text) {
    const candidateMatches = [];
    const foundLocations = new Set(); // Track which locations we've already found

    // Step 1: Find ALL possible matches from geoDatabase using standard regex
    Object.entries(geoDatabase).forEach(([loc, entry]) => {
        if (entry.type === "river") return;
        const terms = [loc, ...(entry.aliases || [])];

        for (const term of terms) {
            const regex = buildFlexibleRegex(term);
            let match;
            regex.lastIndex = 0; // Reset regex state

            while ((match = regex.exec(text)) !== null) {
                candidateMatches.push({
                    text: match[0],
                    type: entry.type === "region" ? "region" : "location",
                    name: loc,
                    index: match.index,
                    length: match[0].length,
                    matchedTerm: term
                });
                foundLocations.add(loc);
            }
        }
    });

    // Step 1b: OCR-tolerant matching for locations not found by standard regex
    // Only check important locations (5+ char names) to avoid false positives
    Object.entries(geoDatabase).forEach(([loc, entry]) => {
        if (entry.type === "river" || foundLocations.has(loc) || loc.length < 5) return;

        // Try OCR-tolerant regex
        const ocrRegex = buildOCRTolerantRegex(loc);
        let match;
        ocrRegex.lastIndex = 0;

        while ((match = ocrRegex.exec(text)) !== null) {
            // Only accept if it's different from the exact term (actual OCR correction)
            if (match[0].toLowerCase() !== loc.toLowerCase()) {
                candidateMatches.push({
                    text: match[0],
                    type: entry.type === "region" ? "region" : "location",
                    name: loc,
                    index: match.index,
                    length: match[0].length,
                    matchedTerm: loc,
                    ocrCorrected: true // Flag that this was an OCR correction
                });
            }
        }
    });

    // Step 2: Find event-based matches (Battle of, Siege of, etc.)
    // Case-insensitive patterns capture multi-word place names (e.g., "battle of New Orleans", "SIEGE OF PARIS")
    const eventPrefixes = [
        'Battle', 'Siege', 'Fall', 'Treaty', 'Capture', 'Sack', 'Congress',
        'Peace', 'Massacre', 'Rebellion', 'Revolt', 'Liberation', 'Occupation',
        'Burning', 'Evacuation', 'Defense', 'Defence', 'Annexation',
        'Conquest', 'Surrender', 'Bombardment', 'Destruction', 'Raid',
        'Invasion', 'Campaign', 'Assault', 'Ambush', 'Skirmish'
    ];
    eventPrefixes.map(prefix =>
        new RegExp(prefix + ' of ((?:[A-Z][a-zà-ÿ]+(?:\\s+|-)?)+(?:\\s+(?:the\\s+)?[A-Z][a-zà-ÿ]+)?)', 'gi')
    ).forEach(pattern => {
        let m;
        pattern.lastIndex = 0; // Reset regex state
        while ((m = pattern.exec(text)) !== null) {
            // Trim trailing whitespace from captured location name
            const locationName = m[1].trim();
            candidateMatches.push({
                text: m[0],
                type: "event",
                name: m[0],
                locationName: locationName,
                index: m.index,
                length: m[0].length
            });
        }
    });

    // Step 3: Sort by longest match first, then by position
    candidateMatches.sort((a, b) => {
        if (b.length !== a.length) return b.length - a.length; // Longest first
        return a.index - b.index; // Earlier position if same length
    });

    // Step 4: Filter out overlapping matches (keep only longest, non-overlapping)
    const entities = [];
    const usedRanges = [];

    for (const candidate of candidateMatches) {
        const start = candidate.index;
        const end = candidate.index + candidate.length;

        // Check if this range overlaps with any already used range
        const overlaps = usedRanges.some(range =>
            (start >= range.start && start < range.end) ||
            (end > range.start && end <= range.end) ||
            (start <= range.start && end >= range.end)
        );

        if (!overlaps) {
            // Check if disambiguation is needed
            const disambiguation = disambiguateLocation(candidate.name, text, candidate.index);
            const entity = { ...candidate };

            // Add disambiguation info if found
            if (disambiguation) {
                entity.disambiguatedRegion = disambiguation.region;
                entity.disambiguatedCoords = disambiguation.coords;
                entity.disambiguationConfidence = disambiguation.confidence;
                entity.disambiguationOptions = disambiguation.allOptions;
                entity.needsUserInput = disambiguation.needsUserInput;
            }

            entities.push(entity);
            usedRanges.push({ start, end });
        }
    }

    // Step 5: Sort final entities by position for rendering
    entities.sort((a, b) => a.index - b.index);

    return entities;
}

// Show disambiguation modal for ambiguous locations
function showDisambiguationModal(locationName, entity, badgeElement) {
    const modal = document.getElementById('disambiguationModal');
    const question = document.getElementById('disambiguationQuestion');
    const optionsContainer = document.getElementById('disambiguationOptions');

    if (state.disambiguationTimer) {
        clearTimeout(state.disambiguationTimer);
        state.disambiguationTimer = null;
    }

    // Set question text
    question.textContent = `We found "${locationName}" in your document, but it could refer to multiple places. Which one did you mean?`;

    // Clear previous options
    optionsContainer.innerHTML = '';

    // Create option buttons
    entity.disambiguationOptions.forEach((option, index) => {
        const optionBtn = document.createElement('button');
        optionBtn.className = 'disambiguation-option';
        optionBtn.type = 'button';
        optionBtn.dataset.optionIndex = index.toString();

        const label = document.createElement('div');
        label.className = 'option-label';
        label.textContent = option.label;

        const keywords = document.createElement('div');
        keywords.className = 'option-keywords';
        keywords.textContent = `Context keywords: ${option.keywords.join(', ')}`;

        optionBtn.appendChild(label);
        optionBtn.appendChild(keywords);

        // Click handler for option selection
        const handleOptionSelection = (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (optionBtn.dataset.selected === 'true') return;
            optionBtn.dataset.selected = 'true';
            selectDisambiguationOption(locationName, option, badgeElement, entity);
            closeDisambiguationModal();
        };
        optionBtn.addEventListener('click', handleOptionSelection);
        optionBtn.addEventListener('pointerup', handleOptionSelection);

        optionsContainer.appendChild(optionBtn);
    });

    // Show modal
    modal.classList.add('open');
    state.disambiguationModalOpen = true;

    state.disambiguationTimer = setTimeout(() => {
        if (!state.disambiguationModalOpen) return;
        const fallback = entity.disambiguationOptions[0];
        if (fallback) {
            showToast('No selection made. Defaulting to the first match.', 'info', 4000);
            selectDisambiguationOption(locationName, fallback, badgeElement, entity);
        }
        closeDisambiguationModal();
    }, 30000);
}

// Close disambiguation modal
function closeDisambiguationModal() {
    const modal = document.getElementById('disambiguationModal');
    modal.classList.remove('open');
    state.disambiguationModalOpen = false;
    if (state.disambiguationTimer) {
        clearTimeout(state.disambiguationTimer);
        state.disambiguationTimer = null;
    }
}

// Select a disambiguation option and remember it
function selectDisambiguationOption(locationName, option, badgeElement, entity) {
    // Save user choice to localStorage (scoped to current document)
    const docHash = state.documentHash || 'default';
    const storageKey = `disambiguation_${docHash}`;
    const choices = JSON.parse(localStorage.getItem(storageKey) || '{}');
    choices[locationName] = option.region;
    localStorage.setItem(storageKey, JSON.stringify(choices));

    // Update entity with selected coordinates
    entity.disambiguatedCoords = option.coords;
    entity.disambiguatedRegion = option.region;

    // Remove low-confidence indicator from badge
    badgeElement.classList.remove('low-confidence');

    // Update stored location data
    const locationData = state.allLocations.find(loc => loc.element === badgeElement);
    if (locationData) {
        locationData.disambiguatedCoords = option.coords;
    }

    // Navigate to selected location
    handleLocationClick(locationName, badgeElement, entity.type, entity.locationName);

    // Show success message
    showToast(`Location set to: ${option.label}`, 'info', 2000);
}

// Handle clicking on a location badge
function handleLocationClick(name, element, type = "location", eventLoc = null) {
    document.querySelectorAll(".location-badge").forEach(el => el.classList.remove("active"));
    element.classList.add("active");
    const idx = state.allLocations.findIndex(loc => loc.element === element);
    if (idx !== -1) {
        state.currentLocationIndex = idx;
        updateTimeline();
    }
    if (!state.autoMap || !state.map) return;
    if (state.activeMapMarker) {
        state.map.removeLayer(state.activeMapMarker);
        state.activeMapMarker = null;
    }
    // Reset region styles to default visibility
    state.regionPolygons.forEach(p => {
        const entry = geoDatabase[p.regionName];
        p.setStyle({
            fillOpacity: 0.25,
            opacity: 0.7,
            weight: 2,
            color: entry?.color || "#3b82f6",
            dashArray: "5, 5"
        });
    });
    // Also reset inline map regions
    state.inlineRegionPolygons.forEach(p => {
        const entry = geoDatabase[p.regionName];
        p.setStyle({
            fillOpacity: 0.25,
            opacity: 0.7,
            weight: 2,
            color: entry?.color || "#3b82f6",
            dashArray: "5, 5"
        });
    });
    let coords = type === "event" && eventLoc ? (eventLocations[eventLoc] || getContextualCoords(eventLoc)) : getContextualCoords(name);
    const entry = geoDatabase[name];
    if (entry?.type === "region" && entry.coords && Array.isArray(entry.coords[0])) {
        const poly = state.regionPolygons.find(p => p.regionName === name);
        if (poly) {
            poly.setStyle({
                fillOpacity: 0.25,
                opacity: 1,
                weight: 3,
                color: "#dc2626",
                dashArray: null
            });
            state.map.fitBounds(poly.getBounds(), { padding: [30, 30] });
            state.activeRegionPolygon = poly;
            // Also update inline map if in split view
            if (state.viewMode !== 'panel' && state.inlineMap) {
                const inlinePoly = state.inlineRegionPolygons.find(p => p.regionName === name);
                if (inlinePoly) {
                    inlinePoly.setStyle({
                        fillOpacity: 0.25,
                        opacity: 1,
                        weight: 3,
                        color: "#dc2626",
                        dashArray: null
                    });
                    state.inlineMap.fitBounds(inlinePoly.getBounds(), { padding: [30, 30] });
                }
            }
        }
    } else if (coords) {
        addToContext(name, coords);
        state.map.setView(coords, 7);
        const color = type === "event" ? "#ec4899" : "#ef4444";
        state.activeMapMarker = L.circleMarker(coords, { radius: 15, fillColor: color, color: "#fff", weight: 3, fillOpacity: 0.7 }).addTo(state.map).bindPopup("<b>" + name + "</b>").openPopup();
        // Also update inline map if in split view
        if (state.viewMode !== 'panel' && state.inlineMap) {
            state.inlineMap.setView(coords, 7);
        }
    }
    // Open map panel if in panel mode
    if (!state.mapOpen && state.viewMode === 'panel') toggleMap();
}

// Render all pages of the loaded PDF and extract entities
async function renderAllPages() {
    const container = document.getElementById("pdf-container");
    container.innerHTML = "";
    state.allLocations = [];
    state.recentContext = [];
    state.markerCluster.clearLayers();
    state.allMarkers = [];

    // Reset virtualization state
    virtualScrollConfig.renderedPages.clear();
    virtualScrollConfig.pageHeights.clear();

    showLoading("Rendering pages...");

    // Lazy loading: Only render first 5 pages initially, rest on demand
    const initialPages = Math.min(5, state.pdfDoc.numPages);

    for (let pageNum = 1; pageNum <= state.pdfDoc.numPages; pageNum++) {
        if (pageNum <= initialPages) {
            updateLoading("Page " + pageNum + "/" + state.pdfDoc.numPages);
            await renderPage(pageNum);
            virtualScrollConfig.renderedPages.add(pageNum);
        } else {
            // Create placeholder for lazy loading
            createPagePlaceholder(pageNum);
        }
    }

    // Set up intersection observer for lazy loading
    setupLazyLoading();

    hideLoading();
    updateTimeline();
    rescaleOverlays();
    showRegionPolygons(); // Show regions now that document is loaded
    document.getElementById("entityLegend").classList.remove("hidden");
    document.getElementById("timelineControls").classList.remove("hidden");
    localforage.setItem("readingPosition", { scroll: 0, index: 0, ts: Date.now() });

    // Provide feedback based on detection results
    if (state.allLocations.length === 0) {
        showToast("No historical locations detected. Try OCR if this is a scanned document.", 'info', 5000);
    } else {
        showSuccess(`Found ${state.allLocations.length} location references`);
    }
}

// Create placeholder for a page to be lazy-loaded
function createPagePlaceholder(pageNum) {
    const container = document.getElementById("pdf-container");
    const pageWrapper = document.createElement("div");
    pageWrapper.className = "pdf-page-wrapper pdf-page-placeholder";
    pageWrapper.dataset.page = pageNum;
    pageWrapper.style.minHeight = "800px";
    pageWrapper.style.display = "flex";
    pageWrapper.style.alignItems = "center";
    pageWrapper.style.justifyContent = "center";

    const pageNumber = document.createElement("div");
    pageNumber.className = "page-number";
    pageNumber.textContent = "Page " + pageNum + " - Loading...";
    pageWrapper.appendChild(pageNumber);

    container.appendChild(pageWrapper);
}

// Virtualized scrolling configuration
const virtualScrollConfig = {
    pagesBuffer: 3, // Keep this many pages above/below viewport rendered
    unloadThreshold: 8, // Unload pages more than this many pages away
    pageHeights: new Map(), // Cache of page heights for virtualization
    renderedPages: new Set(), // Currently rendered pages
    observer: null
};

// Set up intersection observer for lazy loading and virtualization
function setupLazyLoading() {
    // Unload observer - watches pages to potentially unload them
    const unloadObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) {
                const pageNum = parseInt(entry.target.dataset.page);
                // Check if page is far enough away to unload
                const currentPage = getCurrentVisiblePage();
                if (Math.abs(pageNum - currentPage) > virtualScrollConfig.unloadThreshold) {
                    unloadPage(pageNum);
                }
            }
        });
    }, { rootMargin: '2000px' });

    // Load observer - watches placeholders to load pages
    virtualScrollConfig.observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const pageNum = parseInt(entry.target.dataset.page);
                const isPlaceholder = entry.target.classList.contains('pdf-page-placeholder');

                if (isPlaceholder && !virtualScrollConfig.renderedPages.has(pageNum)) {
                    // Mark as rendering immediately to prevent race condition on fast scroll
                    virtualScrollConfig.renderedPages.add(pageNum);
                    virtualScrollConfig.observer.unobserve(entry.target);
                    renderPage(pageNum)
                        .then(() => {
                            rescaleOverlays();
                            updateTimeline();
                            // Re-observe for potential unloading
                            const newWrapper = document.querySelector(`[data-page="${pageNum}"]`);
                            if (newWrapper) unloadObserver.observe(newWrapper);
                        })
                        .catch(err => {
                            console.error(`Failed to render page ${pageNum}:`, err);
                            // Remove from rendered set so it can be retried
                            virtualScrollConfig.renderedPages.delete(pageNum);
                            entry.target.innerHTML = `<div class="page-number" style="color: #ef4444;">Page ${pageNum} failed to load</div>`;
                            entry.target.classList.remove('pdf-page-placeholder');
                        });
                }
            }
        });
    }, { rootMargin: '800px' });

    document.querySelectorAll('.pdf-page-wrapper').forEach(el => {
        if (el.classList.contains('pdf-page-placeholder')) {
            virtualScrollConfig.observer.observe(el);
        } else {
            unloadObserver.observe(el);
        }
    });
}

// Get the currently visible page number
function getCurrentVisiblePage() {
    const viewer = document.getElementById('pdf-viewer');
    const viewerRect = viewer.getBoundingClientRect();
    const viewerCenter = viewerRect.top + viewerRect.height / 2;

    const pages = document.querySelectorAll('.pdf-page-wrapper');
    for (const page of pages) {
        const rect = page.getBoundingClientRect();
        if (rect.top <= viewerCenter && rect.bottom >= viewerCenter) {
            return parseInt(page.dataset.page) || 1;
        }
    }
    return 1;
}

// Unload a page to save memory (replace with placeholder)
function unloadPage(pageNum) {
    const pageWrapper = document.querySelector(`[data-page="${pageNum}"]`);
    if (!pageWrapper || pageWrapper.classList.contains('pdf-page-placeholder')) return;

    // Store the height before unloading for consistent scroll position
    const height = pageWrapper.offsetHeight;
    virtualScrollConfig.pageHeights.set(pageNum, height);

    // Remove locations from this page from the global state
    state.allLocations = state.allLocations.filter(loc => loc.page !== pageNum);

    // Replace with placeholder
    pageWrapper.innerHTML = '';
    pageWrapper.className = 'pdf-page-wrapper pdf-page-placeholder';
    pageWrapper.style.minHeight = height + 'px';
    pageWrapper.style.display = 'flex';
    pageWrapper.style.alignItems = 'center';
    pageWrapper.style.justifyContent = 'center';

    const pageNumber = document.createElement('div');
    pageNumber.className = 'page-number';
    pageNumber.textContent = `Page ${pageNum} - Scroll to load`;
    pageWrapper.appendChild(pageNumber);

    virtualScrollConfig.renderedPages.delete(pageNum);

    // Re-observe for loading
    if (virtualScrollConfig.observer) {
        virtualScrollConfig.observer.observe(pageWrapper);
    }
}

// Render a single page
async function renderPage(pageNum) {
    try {
        const page = await state.pdfDoc.getPage(pageNum);
        const scale = 1.2; // Reduced from 1.5 for better performance
        const viewport = page.getViewport({ scale });

        // Find or create page wrapper
        let pageWrapper = document.querySelector(`[data-page="${pageNum}"]`);
        const isPlaceholder = pageWrapper?.classList.contains('pdf-page-placeholder');

        if (!pageWrapper || isPlaceholder) {
            const newWrapper = document.createElement("div");
            newWrapper.className = "pdf-page-wrapper";
            newWrapper.dataset.page = pageNum;
            if (pageWrapper) {
                pageWrapper.replaceWith(newWrapper);
            } else {
                document.getElementById("pdf-container").appendChild(newWrapper);
            }
            pageWrapper = newWrapper;
        }

        pageWrapper.innerHTML = "";
        pageWrapper.style.minHeight = "";

        const pageNumber = document.createElement("div");
        pageNumber.className = "page-number";
        pageNumber.textContent = "Page " + pageNum;
        pageWrapper.appendChild(pageNumber);

        const canvasContainer = document.createElement("div");
        canvasContainer.style.cssText = "position:relative;width:100%;";
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.className = "pdf-canvas";
        canvasContainer.appendChild(canvas);
        pageWrapper.appendChild(canvasContainer);

        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

        const textOverlay = document.createElement("div");
        textOverlay.className = "text-overlay";
        textOverlay.dataset.viewportWidth = viewport.width;
        textOverlay.dataset.viewportHeight = viewport.height;
        textOverlay.style.width = canvas.width + "px";
        textOverlay.style.height = canvas.height + "px";
        textOverlay.style.position = "absolute";
        textOverlay.style.top = "0";
        textOverlay.style.left = "0";
        textOverlay.style.pointerEvents = "none";

        const textLayer = document.createElement("div");
        textLayer.className = "pdf-text-layer";
        textLayer.style.position = "absolute";
        textLayer.style.inset = "0";
        textLayer.style.pointerEvents = "none";
        textLayer.style.fontFamily = "serif";
        textOverlay.appendChild(textLayer);
        canvasContainer.appendChild(textOverlay);

        const textContent = await page.getTextContent();
        let fullText = "";
        const textItems = [];

        // Phase 1: render spans
        textContent.items.forEach(item => {
            const raw = item.str || "";
            if (!raw) return;
            const startIdx = fullText.length;
            fullText += raw;
            const transform = pdfjsLib.Util.transform(viewport.transform, item.transform || []);
            const fontHeight = Math.hypot(transform[1] || 0, transform[3] || 0);
            const textWidthPx = (item.width || 0) * viewport.scale;
            const span = document.createElement("span");
            span.textContent = raw;
            span.style.position = "absolute";
            span.style.left = (transform[4] || 0) + "px";
            span.style.top = ((transform[5] || 0) - fontHeight) + "px";
            span.style.fontSize = Math.max(1, fontHeight) + "px";
            span.style.transformOrigin = "0% 0%";
            span.style.whiteSpace = "pre";
            span.style.color = "transparent";
            textLayer.appendChild(span);
            textItems.push({
                text: raw,
                startIndex: startIdx,
                endIndex: startIdx + raw.length,
                leftBase: transform[4] || 0,
                topBase: (transform[5] || 0) - fontHeight,
                fontHeight,
                textWidthPx,
                element: span
            });
        });

        // Phase 2: scale spans horizontally
        textItems.forEach(item => {
            const w = item.element.offsetWidth;
            if (w > 0) {
                const s = item.textWidthPx / w;
                item.element.style.transform = `scaleX(${s})`;
            }
        });

        // Phase 3: highlight matches using PDF position data directly for accurate positioning
        extractEntitiesForPage(fullText).forEach(entity => {
            for (const item of textItems) {
                if (entity.index >= item.startIndex && entity.index < item.endIndex) {
                    const localStart = entity.index - item.startIndex;
                    const localLen = Math.min(entity.length, item.text.length - localStart);
                    if (localLen <= 0) continue;

                    // Calculate position using PDF coordinates directly instead of Range API
                    // This avoids issues with font rendering and scaleX transforms
                    const charRatio = item.text.length > 0 ? 1 / item.text.length : 1;
                    const leftV = item.leftBase + (localStart * charRatio * item.textWidthPx);
                    const topV = item.topBase;
                    const wV = localLen * charRatio * item.textWidthPx;
                    const hV = item.fontHeight;

                    const hl = document.createElement("div");
                    hl.className = "location-badge" + (entity.type === "region" ? " region-badge" : entity.type === "event" ? " event-badge" : "");

                    // Add low-confidence indicator if disambiguation confidence is low
                    if (entity.disambiguationConfidence === 'low') {
                        hl.classList.add('low-confidence');
                    }

                    hl.dataset.location = entity.name;
                    hl.dataset.entityType = entity.type;
                    if (entity.locationName) hl.dataset.eventLocation = entity.locationName;

                    // Store disambiguation data for click handler
                    if (entity.disambiguationOptions) {
                        hl.dataset.disambiguationOptions = JSON.stringify(entity.disambiguationOptions);
                        hl.dataset.needsUserInput = entity.needsUserInput;
                    }

                    // Store viewport coordinates for accurate rescaling
                    hl.dataset.leftV = leftV;
                    hl.dataset.topV = topV;
                    hl.dataset.widthV = wV;
                    hl.dataset.heightV = hV;

                    // Click handler - show disambiguation UI if needed, otherwise navigate map
                    hl.onclick = () => {
                        if (entity.needsUserInput && entity.disambiguationOptions) {
                            showDisambiguationModal(entity.name, entity, hl);
                        } else {
                            handleLocationClick(entity.name, hl, entity.type, entity.locationName);
                        }
                    };

                    textOverlay.appendChild(hl);
                    state.allLocations.push({ name: entity.name, element: hl, page: pageNum, type: entity.type, locationName: entity.locationName, disambiguatedCoords: entity.disambiguatedCoords });

                    // Use disambiguated coordinates if available, otherwise fall back to default
                    let coords = entity.disambiguatedCoords ||
                        (entity.type === "event" && entity.locationName ? (eventLocations[entity.locationName] || getContextualCoords(entity.locationName)) : getContextualCoords(entity.name));
                    if (coords) {
                        addToContext(entity.name, coords);
                        const marker = L.marker(coords).bindPopup("<b>" + entity.name + "</b><br>Page " + pageNum);
                        state.allMarkers.push(marker);
                        state.markerCluster.addLayer(marker);
                        if (state.inlineLayerGroup) {
                            state.inlineLayerGroup.addLayer(L.marker(coords).bindPopup("<b>" + entity.name + "</b><br>Page " + pageNum));
                        }
                    }
                    break;
                }
            }
        });
    } catch (e) {
        console.error("Page " + pageNum + " error:", e);
    }
}

// Rescale overlays on page resize or view changes with improved accuracy
function rescaleOverlays() {
    document.querySelectorAll(".pdf-page-wrapper").forEach(wrapper => {
        const canvas = wrapper.querySelector("canvas");
        const overlay = wrapper.querySelector(".text-overlay");
        if (!canvas || !overlay) return;
        const vw = +overlay.dataset.viewportWidth || 1;
        const vh = +overlay.dataset.viewportHeight || 1;
        const scale = canvas.clientWidth / vw;
        overlay.style.width = canvas.clientWidth + "px";
        overlay.style.height = (vh * scale) + "px";
        if (canvas.parentElement) canvas.parentElement.style.height = (vh * scale) + "px";

        // Rescale all location badges using viewport coordinates
        overlay.querySelectorAll(".location-badge").forEach(badge => {
            const lV = parseFloat(badge.dataset.leftV);
            const tV = parseFloat(badge.dataset.topV);
            const wV = parseFloat(badge.dataset.widthV);
            const hV = parseFloat(badge.dataset.heightV);
            if (!isNaN(lV) && !isNaN(tV) && !isNaN(wV) && !isNaN(hV)) {
                badge.style.left = (lV * scale) + "px";
                badge.style.top = (tV * scale) + "px";
                badge.style.width = (wV * scale) + "px";
                badge.style.height = (hV * scale) + "px";
            }
        });
    });
}

// Update the timeline progress bar and counter
function updateTimeline() {
    const total = state.allLocations.length;
    document.getElementById("marker-counter").textContent = (total === 0 ? 0 : state.currentLocationIndex + 1) + "/" + total;
    document.getElementById("timeline-progress").style.width = (total > 1 ? (state.currentLocationIndex / (total - 1)) * 100 : 0) + "%";
}

// Navigate to a location by index
function navigateToLocation(idx) {
    if (idx < 0 || idx >= state.allLocations.length) return;
    state.currentLocationIndex = idx;
    const loc = state.allLocations[idx];
    loc.element.scrollIntoView({ behavior: "smooth", block: "center" });
    handleLocationClick(loc.name, loc.element, loc.type, loc.locationName);
}

// Draw the journey path connecting all locations in order
function drawJourneyPath() {
    if (state.journeyLine) state.map.removeLayer(state.journeyLine);
    const coords = state.allLocations.map(loc => loc.type === "event" && loc.locationName ? eventLocations[loc.locationName] || getContextualCoords(loc.locationName) : getContextualCoords(loc.name)).filter(c => c);
    if (coords.length < 2) return;
    state.journeyLine = L.polyline(coords, { color: "#ef4444", weight: 3, opacity: 0.7, dashArray: "10,10", className: "leaflet-journey-path" }).addTo(state.map);
    state.map.fitBounds(state.journeyLine.getBounds(), { padding: [50, 50] });
}

// Play through the journey automatically
async function playJourney() {
    if (state.journeyPlaying) {
        state.journeyPlaying = false;
        return;
    }
    state.journeyPlaying = true;
    document.querySelector("#play-journey i").setAttribute("data-feather", "pause");
    feather.replace();
    if (!state.mapOpen) toggleMap();
    drawJourneyPath();
    for (let i = 0; i < state.allLocations.length && state.journeyPlaying; i++) {
        navigateToLocation(i);
        await new Promise(r => setTimeout(r, 2000));
    }
    state.journeyPlaying = false;
    document.querySelector("#play-journey i").setAttribute("data-feather", "play");
    feather.replace();
}

// Search for locations by name and highlight matches
function performSearch(query) {
    if (!query.trim()) {
        clearSearch();
        return;
    }
    clearSearch();
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "i");
    document.querySelectorAll(".location-badge").forEach(badge => {
        if (regex.test(badge.dataset.location || "")) {
            badge.classList.add("search-highlight");
            state.searchResults.push(badge);
        }
    });
    document.getElementById("search-count").textContent = state.searchResults.length > 0 ? "1/" + state.searchResults.length : "0 found";
    if (state.searchResults.length > 0) {
        state.searchResults[0].scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
        showToast(`No locations matching "${query}" found`, 'info', 3000);
    }
}

// Navigate to previous or next search result
function navigateSearch(dir) {
    if (!state.searchResults.length) return;
    state.searchIndex = (state.searchIndex + dir + state.searchResults.length) % state.searchResults.length;
    state.searchResults[state.searchIndex].scrollIntoView({ behavior: "smooth", block: "center" });
    document.getElementById("search-count").textContent = (state.searchIndex + 1) + "/" + state.searchResults.length;
}

// Clear search highlights and counters
function clearSearch() {
    document.querySelectorAll(".search-highlight").forEach(el => el.classList.remove("search-highlight"));
    state.searchResults = [];
    state.searchIndex = 0;
    document.getElementById("search-count").textContent = "";
}

// Load a PDF file into the viewer
async function loadPDF(fileOrBlob, fileName = 'Document') {
    try {
        showLoading("Loading PDF...");
        const arrayBuffer = await fileOrBlob.arrayBuffer();

        // Generate document hash for annotation persistence
        state.documentHash = await generateDocumentHash(arrayBuffer);
        state.documentType = 'pdf';
        state.documentName = fileName;
        state.epubBook = null;

        state.pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
        document.getElementById("pdf-placeholder").classList.add("hidden");
        document.getElementById("pdf-container").classList.remove("hidden");
        await renderAllPages();

        // Save annotations after processing
        await saveAnnotations();

        // Save to library
        await saveToLibrary(state.documentHash, fileName, 'pdf', arrayBuffer);

        await persistArrayBuffer(localforage, "cachedDocument", arrayBuffer, "cached PDF");
        localforage.setItem("cachedDocumentType", 'pdf');
        localforage.setItem("cachedDocumentName", fileName);
    } catch (e) {
        hideLoading();
        showError("Failed to load PDF: " + (e.message || "Unknown error"));
        console.error("PDF load error:", e);
    }
}

// Load EPUB file
async function loadEPUB(fileOrBlob, fileName = 'Document') {
    try {
        showLoading("Loading EPUB...");
        const arrayBuffer = await fileOrBlob.arrayBuffer();

        // Generate document hash
        state.documentHash = await generateDocumentHash(arrayBuffer);
        state.documentType = 'epub';
        state.documentName = fileName;
        state.pdfDoc = null;

        // Initialize epub.js
        state.epubBook = ePub(arrayBuffer);
        await state.epubBook.ready;

        // Get spine (chapter order)
        const spine = state.epubBook.spine;

        document.getElementById("pdf-placeholder").classList.add("hidden");
        document.getElementById("pdf-container").classList.remove("hidden");

        await renderEPUB();

        // Save to library
        await saveToLibrary(state.documentHash, fileName, 'epub', arrayBuffer);

        await persistArrayBuffer(localforage, "cachedDocument", arrayBuffer, "cached EPUB");
        localforage.setItem("cachedDocumentType", 'epub');
        localforage.setItem("cachedDocumentName", fileName);
    } catch (e) {
        hideLoading();
        showError("Failed to load EPUB: " + (e.message || "Unknown error"));
        console.error("EPUB load error:", e);
    }
}

// Render EPUB chapters
async function renderEPUB() {
    const container = document.getElementById("pdf-container");
    container.innerHTML = "";
    container.className = "pdf-container epub-container";
    state.allLocations = [];
    state.recentContext = [];
    state.markerCluster.clearLayers();
    state.allMarkers = [];

    const spine = state.epubBook.spine;
    let chapterNum = 0;
    const totalChapters = spine.length;

    for (const item of spine) {
        chapterNum++;
        updateLoading(`Chapter ${chapterNum}/${totalChapters}`);

        try {
            const doc = await item.load(state.epubBook.load.bind(state.epubBook));
            const content = doc.body ? doc.body.innerHTML : doc.innerHTML || '';

            // Create chapter wrapper
            const chapterWrapper = document.createElement("div");
            chapterWrapper.className = "epub-chapter";
            chapterWrapper.dataset.chapter = chapterNum;

            // Get chapter title from TOC if available
            const tocItem = state.epubBook.navigation?.toc?.find(t => t.href?.includes(item.href));
            if (tocItem) {
                const titleEl = document.createElement("div");
                titleEl.className = "epub-chapter-title";
                titleEl.textContent = tocItem.label || `Chapter ${chapterNum}`;
                chapterWrapper.appendChild(titleEl);
            }

            // Create content div
            const contentDiv = document.createElement("div");
            contentDiv.className = "epub-content";
            contentDiv.innerHTML = content;

            // Extract text for entity detection
            const textContent = contentDiv.textContent || '';

            chapterWrapper.appendChild(contentDiv);
            container.appendChild(chapterWrapper);

            // Extract entities from chapter text
            const entities = extractEntitiesForPage(textContent);
            entities.forEach(entity => {
                // Find and highlight entities in the content
                highlightEntityInEPUB(contentDiv, entity, chapterNum);
            });

        } catch (e) {
            console.warn(`Failed to load chapter ${chapterNum}:`, e);
        }
    }

    hideLoading();
    updateTimeline();
    showRegionPolygons(); // Show regions now that document is loaded
    document.getElementById("entityLegend").classList.remove("hidden");
    document.getElementById("timelineControls").classList.remove("hidden");

    if (state.allLocations.length === 0) {
        showToast("No historical locations detected in this EPUB.", 'info', 5000);
    } else {
        showSuccess(`Found ${state.allLocations.length} location references`);
    }
}

// Highlight entity in EPUB content
function highlightEntityInEPUB(contentDiv, entity, chapterNum) {
    // Collect all text nodes first to avoid TreeWalker issues during DOM modification
    const textNodes = [];
    const walker = document.createTreeWalker(contentDiv, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
        textNodes.push(node);
    }

    const escapedText = escapeRegex(entity.text);
    const regex = new RegExp(`\\b${escapedText}\\b`, 'gi');
    let markerAdded = false;

    // Process each text node for all occurrences (consistent with PDF behavior)
    for (const textNode of textNodes) {
        const text = textNode.textContent;
        let lastIndex = 0;
        let match;
        const fragments = [];

        regex.lastIndex = 0;
        while ((match = regex.exec(text)) !== null) {
            // Add text before the match
            if (match.index > lastIndex) {
                fragments.push(document.createTextNode(text.substring(lastIndex, match.index)));
            }

            // Create the highlighted span
            const span = document.createElement("span");
            span.className = "location-badge epub-location" +
                (entity.type === "region" ? " region-badge" : "") +
                (entity.type === "event" ? " event-badge" : "");
            span.dataset.location = entity.name;
            span.dataset.entityType = entity.type;
            span.textContent = match[0];
            span.style.position = "relative";
            span.style.display = "inline";
            span.style.cursor = "pointer";
            span.onclick = () => handleLocationClick(entity.name, span, entity.type, entity.locationName);

            fragments.push(span);

            // Add to locations
            state.allLocations.push({
                name: entity.name,
                element: span,
                page: chapterNum,
                type: entity.type,
                locationName: entity.locationName
            });

            // Add marker to map only once per entity per chapter
            if (!markerAdded) {
                const coords = entity.type === "event" && entity.locationName
                    ? (eventLocations[entity.locationName] || getContextualCoords(entity.locationName))
                    : getContextualCoords(entity.name);

                if (coords) {
                    addToContext(entity.name, coords);
                    const marker = L.marker(coords).bindPopup(`<b>${entity.name}</b><br>Chapter ${chapterNum}`);
                    state.allMarkers.push(marker);
                    state.markerCluster.addLayer(marker);
                    markerAdded = true;
                }
            }

            lastIndex = regex.lastIndex;
        }

        // If we found matches in this text node, replace it with fragments
        if (fragments.length > 0) {
            // Add any remaining text after the last match
            if (lastIndex < text.length) {
                fragments.push(document.createTextNode(text.substring(lastIndex)));
            }

            const parent = textNode.parentNode;
            for (const fragment of fragments) {
                parent.insertBefore(fragment, textNode);
            }
            parent.removeChild(textNode);
        }
    }
}

// Library management functions
const MAX_LIBRARY_FILE_SIZE = 20 * 1024 * 1024; // 20MB limit for IndexedDB

async function saveToLibrary(hash, name, type, arrayBuffer) {
    const fileSize = arrayBuffer.byteLength;
    const entry = {
        hash,
        name: name.replace(/\.(pdf|epub)$/i, ''),
        type,
        addedAt: Date.now(),
        lastOpened: Date.now(),
        size: fileSize,
        stored: false
    };

    try {
        const library = await libraryDB.getItem('metadata') || {};

        // Only store file data if under size limit
        if (fileSize <= MAX_LIBRARY_FILE_SIZE) {
            const stored = await persistArrayBuffer(libraryDB, `doc_${hash}`, arrayBuffer, `library ${name}`);
            entry.stored = Boolean(stored);
            if (!stored) {
                showToast('Library storage skipped for this document. You can still read it now, but it will not be cached.', 'info', 5000);
            }
        } else {
            showToast(`Large file - metadata saved but file not stored in library`, 'info', 3000);
        }

        library[hash] = entry;
        await libraryDB.setItem('metadata', library);
    } catch (e) {
        console.error('Library save error:', e);
        // Try to save just metadata
        try {
            const library = await libraryDB.getItem('metadata') || {};
            library[hash] = entry;
            await libraryDB.setItem('metadata', library);
        } catch (_) {}
    }
}

async function loadLibrary() {
    const grid = document.getElementById('libraryGrid');
    const library = await libraryDB.getItem('metadata') || {};
    const entries = Object.values(library).sort((a, b) => b.lastOpened - a.lastOpened);

    if (entries.length === 0) {
        grid.innerHTML = `
            <div class="library-empty" style="grid-column: 1 / -1;">
                <div class="library-empty-icon">📚</div>
                <h3>Your library is empty</h3>
                <p>Upload a PDF or EPUB to get started</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = entries.map(entry => `
        <div class="library-item ${entry.stored ? '' : 'library-item-unavailable'}" data-hash="${entry.hash}" data-stored="${entry.stored !== false}">
            <button class="library-item-delete" data-hash="${entry.hash}" title="Remove">✕</button>
            <div class="library-item-icon">${entry.type === 'epub' ? '📖' : '📄'}</div>
            <div class="library-item-title" title="${entry.name}">${entry.name}</div>
            <div class="library-item-meta">${entry.type.toUpperCase()} • ${formatFileSize(entry.size)}${entry.stored === false ? ' • Not stored' : ''}</div>
        </div>
    `).join('');

    // Add click handlers
    grid.querySelectorAll('.library-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            if (e.target.classList.contains('library-item-delete')) return;
            const hash = item.dataset.hash;
            await openFromLibrary(hash);
        });
    });

    grid.querySelectorAll('.library-item-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const hash = btn.dataset.hash;
            await removeFromLibrary(hash);
        });
    });
}

async function openFromLibrary(hash) {
    try {
        const library = await libraryDB.getItem('metadata') || {};
        const entry = library[hash];
        if (!entry) {
            showError("Document not found in library");
            return;
        }

        // Check if file was stored
        if (entry.stored === false) {
            showToast("File too large - please re-upload to view", 'info', 4000);
            return;
        }

        const arrayBuffer = await libraryDB.getItem(`doc_${hash}`);
        if (!arrayBuffer) {
            showError("Document data not found - please re-upload");
            return;
        }

        // Update last opened
        entry.lastOpened = Date.now();
        library[hash] = entry;
        await libraryDB.setItem('metadata', library);

        // Close library modal
        toggleLibrary();

        // Load document
        const blob = new Blob([arrayBuffer], { type: entry.type === 'epub' ? 'application/epub+zip' : 'application/pdf' });
        if (entry.type === 'epub') {
            await loadEPUB(blob, entry.name);
        } else {
            await loadPDF(blob, entry.name);
        }
    } catch (e) {
        showError("Failed to open document: " + e.message);
    }
}

async function removeFromLibrary(hash) {
    try {
        const library = await libraryDB.getItem('metadata') || {};
        delete library[hash];
        await libraryDB.setItem('metadata', library);
        await libraryDB.removeItem(`doc_${hash}`);
        await loadLibrary();
        showSuccess("Document removed from library");
    } catch (e) {
        showError("Failed to remove document");
    }
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function toggleLibrary() {
    state.libraryOpen = !state.libraryOpen;
    document.getElementById('libraryModal').classList.toggle('open', state.libraryOpen);
    if (state.libraryOpen) {
        loadLibrary();
    }
    if (state.moreMenuOpen) toggleMoreMenu();
}

// Perform OCR on an image file and load as PDF
async function performOCR(imageFile) {
    showLoading("Running OCR...");
    try {
        const result = await Tesseract.recognize(imageFile, "eng", { logger: m => { if (m.status === "recognizing text") updateLoading("OCR: " + Math.round(m.progress * 100) + "%"); } });
        hideLoading();
        generatePDFFromText(result.data.text, "OCR Result");
    } catch (e) {
        hideLoading();
        showError("OCR failed: " + (e.message || "Unknown error"));
        console.error("OCR error:", e);
    }
}

// Generate a simple PDF from plain text using jsPDF
function generatePDFFromText(text, title = "Document") {
    if (!window.jspdf) return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const lines = doc.splitTextToSize(text, 170);
    let y = 20;
    doc.setFontSize(16);
    doc.text(title, 20, y);
    y += 15;
    doc.setFontSize(11);
    lines.forEach(line => {
        if (y > 280) {
            doc.addPage();
            y = 20;
        }
        doc.text(line, 20, y);
        y += 6;
    });
    loadPDF(doc.output("blob"));
}

// Generate a test PDF with example pages
function generateTestPDF() {
    if (!window.jspdf) return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("The Ottoman Empire and Eastern Europe", 20, 20);
    doc.setFontSize(11);
    doc.text("The Ottoman Empire controlled Constantinople for centuries.", 20, 35);
    doc.text("The Fall of Astrakhan opened the Volga to Russian control.", 20, 45);
    doc.text("Campaigns in the Balkans near Serbia reached the Danube.", 20, 55);
    doc.text("The Battle of Mohacs opened Hungary to conquest.", 20, 65);
    doc.text("Russia expanded into the Crimea and the Caucasus.", 20, 75);
    doc.addPage();
    doc.setFontSize(18);
    doc.text("The Crimean War", 20, 20);
    doc.setFontSize(11);
    doc.text("The Battle of Sinope started the Crimean War.", 20, 35);
    doc.text("The Siege of Sevastopol lasted almost a year.", 20, 45);
    doc.text("Russia faced the Ottoman Empire, Britain, and France.", 20, 55);
    loadPDF(doc.output("blob"));
}

// Show/hide loading overlay
function showLoading(text) {
    document.getElementById("loadingText").textContent = text;
    document.getElementById("loadingOverlay").classList.add("show");
}
function updateLoading(text) {
    document.getElementById("loadingText").textContent = text;
}
function hideLoading() {
    document.getElementById("loadingOverlay").classList.remove("show");
}

// Toast notification system - replaces blocking alerts
function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = {
        error: '⚠️',
        success: '✓',
        info: 'ℹ️'
    };

    toast.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;
    container.appendChild(toast);

    // Auto-dismiss
    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    }, duration);

    // Click to dismiss
    toast.addEventListener('click', () => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    });
}

function showError(message) {
    showToast(message, 'error', 5000);
}

function showSuccess(message) {
    showToast(message, 'success', 3000);
}

// Update reading progress bar on scroll
function updateReadingProgress() {
    const viewer = document.getElementById("pdf-viewer");
    const percent = (viewer.scrollTop / (viewer.scrollHeight - viewer.clientHeight || 1)) * 100;
    document.getElementById("readingProgress").style.width = Math.min(percent, 100) + "%";
}

// Reading mode: auto-hide navigation on scroll for better landscape viewing
const readingMode = {
    lastScrollTop: 0,
    scrollThreshold: 50, // Minimum scroll distance to trigger hide/show
    isNavHidden: false,

    handleScroll() {
        // Don't hide nav if map panel or any overlay is open
        if (state.mapOpen || state.moreMenuOpen || state.searchOpen) {
            this.showNav();
            return;
        }

        const viewer = document.getElementById("pdf-viewer");
        const currentScroll = viewer.scrollTop;
        const scrollDelta = currentScroll - this.lastScrollTop;

        // Don't hide if at the top of the page
        if (currentScroll < 100) {
            this.showNav();
            this.lastScrollTop = currentScroll;
            return;
        }

        // Check if we've scrolled enough to trigger
        if (Math.abs(scrollDelta) < this.scrollThreshold) return;

        if (scrollDelta > 0 && !this.isNavHidden) {
            // Scrolling down - hide nav
            this.hideNav();
        } else if (scrollDelta < 0 && this.isNavHidden) {
            // Scrolling up - show nav
            this.showNav();
        }

        this.lastScrollTop = currentScroll;
    },

    hideNav() {
        this.isNavHidden = true;
        document.querySelector('.app-header')?.classList.add('nav-hidden');
        document.querySelector('.bottom-nav')?.classList.add('nav-hidden');
        document.getElementById('timelineControls')?.classList.add('nav-hidden');
    },

    showNav() {
        this.isNavHidden = false;
        document.querySelector('.app-header')?.classList.remove('nav-hidden');
        document.querySelector('.bottom-nav')?.classList.remove('nav-hidden');
        document.getElementById('timelineControls')?.classList.remove('nav-hidden');
    }
};

// Toggle auto-map behaviour
function toggleAutoMap() {
    state.autoMap = !state.autoMap;
    const btn = document.getElementById('auto-map-toggle');
    const menuStatus = document.getElementById('menu-auto-status');
    if (state.autoMap) {
        btn.style.background = 'rgba(20, 184, 166, 0.8)';
        btn.innerHTML = '<span style="font-size: 0.65rem; font-weight: 600;">AUTO</span>';
    } else {
        btn.style.background = 'rgba(100, 116, 139, 0.5)';
        btn.innerHTML = '<span style="font-size: 0.65rem; font-weight: 600;">OFF</span>';
    }
    if (menuStatus) menuStatus.textContent = state.autoMap ? "ON" : "OFF";
}

// Export modal toggle
function toggleExportModal() {
    const modal = document.getElementById('exportModal');
    modal.classList.toggle('open');
}

// Export annotations as GeoJSON
function exportGeoJSON() {
    const features = state.allLocations.map(loc => {
        let coords = loc.type === "event" && loc.locationName ?
            (eventLocations[loc.locationName] || getContextualCoords(loc.locationName)) :
            getContextualCoords(loc.name);
        if (!coords) return null;
        return {
            type: "Feature",
            properties: { name: loc.name, page: loc.page, type: loc.type },
            geometry: { type: "Point", coordinates: [coords[1], coords[0]] }
        };
    }).filter(f => f !== null);
    downloadFile(JSON.stringify({ type: "FeatureCollection", features }, null, 2), "annotations.geojson", "application/json");
    toggleExportModal();
}

// Export annotations as KML
function exportKML() {
    let kml = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document><name>ScrollThroughTime</name>';
    state.allLocations.forEach(loc => {
        let coords = loc.type === "event" && loc.locationName ?
            (eventLocations[loc.locationName] || getContextualCoords(loc.locationName)) :
            getContextualCoords(loc.name);
        if (coords) {
            kml += `<Placemark><name>${loc.name}</name><Point><coordinates>${coords[1]},${coords[0]},0</coordinates></Point></Placemark>`;
        }
    });
    kml += "</Document></kml>";
    downloadFile(kml, "annotations.kml", "application/vnd.google-earth.kml+xml");
    toggleExportModal();
}

// Export annotations as CSV
function exportCSV() {
    let csv = "Name,Type,Page,Latitude,Longitude\n";
    state.allLocations.forEach(loc => {
        let coords = loc.type === "event" && loc.locationName ?
            (eventLocations[loc.locationName] || getContextualCoords(loc.locationName)) :
            getContextualCoords(loc.name);
        coords = coords || ["", ""];
        csv += `"${loc.name}","${loc.type}",${loc.page},${coords[0]},${coords[1]}\n`;
    });
    downloadFile(csv, "annotations.csv", "text/csv");
    toggleExportModal();
}

// Utility to download a file client-side
function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}

// Attach UI event listeners
document.getElementById("nav-upload").addEventListener("click", () => document.getElementById("pdf-input").click());
document.getElementById("pdf-input").addEventListener("change", e => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fileName = f.name;
    if (f.type.startsWith("image/")) {
        performOCR(f);
    } else if (fileName.toLowerCase().endsWith('.epub') || f.type === 'application/epub+zip') {
        loadEPUB(f, fileName);
    } else {
        loadPDF(f, fileName);
    }
});
document.getElementById("nav-map").addEventListener("click", toggleMap);
document.getElementById("nav-more").addEventListener("click", toggleMoreMenu);
// More menu items
document.getElementById("menu-library")?.addEventListener("click", toggleLibrary);
document.getElementById("library-close")?.addEventListener("click", toggleLibrary);
document.getElementById("menu-test-pdf")?.addEventListener("click", () => { generateTestPDF(); toggleMoreMenu(); });
document.getElementById("menu-ocr")?.addEventListener("click", () => { document.getElementById("ocr-input").click(); toggleMoreMenu(); });
document.getElementById("menu-split-h")?.addEventListener("click", () => setViewMode('split-h'));
document.getElementById("menu-split-v")?.addEventListener("click", () => setViewMode('split-v'));
document.getElementById("menu-panel-mode")?.addEventListener("click", () => setViewMode('panel'));
document.getElementById("menu-export")?.addEventListener("click", () => { toggleMoreMenu(); toggleExportModal(); });
// Export modal buttons
document.getElementById("export-geojson")?.addEventListener("click", exportGeoJSON);
document.getElementById("export-kml")?.addEventListener("click", exportKML);
document.getElementById("export-csv")?.addEventListener("click", exportCSV);
document.getElementById("close-export-modal")?.addEventListener("click", toggleExportModal);
// Disambiguation modal close button
document.getElementById("close-disambiguation-modal")?.addEventListener("click", closeDisambiguationModal);
// Auto Map toggle (header button)
document.getElementById("auto-map-toggle")?.addEventListener("click", toggleAutoMap);
// Mobile menu: Auto Map toggle
document.getElementById("menu-auto-toggle")?.addEventListener("click", () => {
    toggleAutoMap();
    document.getElementById("menu-auto-status").textContent = state.autoMap ? "ON" : "OFF";
});
// Mobile menu: Theme toggle (placeholder - app is dark-only for now)
document.getElementById("menu-theme-toggle")?.addEventListener("click", () => {
    showToast("Theme switching coming soon!", "info", 2000);
});
// Map style buttons
document.querySelectorAll('.map-style-btn').forEach(btn => {
    btn.addEventListener('click', () => changeMapStyle(btn.dataset.style));
});
// Overlay layer toggles for panel map
document.getElementById("layer-rivers")?.addEventListener("click", () => toggleOverlayLayer('rivers'));
document.getElementById("layer-population")?.addEventListener("click", () => toggleOverlayLayer('population'));
document.getElementById("layer-terrain")?.addEventListener("click", () => toggleOverlayLayer('terrain'));
document.getElementById("layer-geopolitical")?.addEventListener("click", () => toggleOverlayLayer('geopolitical'));
document.getElementById("layer-borders")?.addEventListener("click", () => toggleOverlayLayer('borders'));
// Inline map overlay toggles
document.getElementById("inline-layer-rivers")?.addEventListener("click", () => toggleOverlayLayer('rivers'));
document.getElementById("inline-layer-population")?.addEventListener("click", () => toggleOverlayLayer('population'));
document.getElementById("inline-layer-terrain")?.addEventListener("click", () => toggleOverlayLayer('terrain'));
document.getElementById("inline-layer-geopolitical")?.addEventListener("click", () => toggleOverlayLayer('geopolitical'));
document.getElementById("inline-layer-borders")?.addEventListener("click", () => toggleOverlayLayer('borders'));
// Inline map style buttons
document.querySelectorAll('#inline-map-controls .map-style-btn').forEach(btn => {
    btn.addEventListener('click', () => changeMapStyle(btn.dataset.style));
});
// Search UI
document.getElementById("search-toggle").addEventListener("click", () => {
    state.searchOpen = !state.searchOpen;
    document.getElementById("searchPanel").classList.toggle("open", state.searchOpen);
});
document.getElementById("search-input").addEventListener("keypress", e => {
    if (e.key === "Enter") performSearch(e.target.value);
});
document.getElementById("search-prev").addEventListener("click", () => navigateSearch(-1));
document.getElementById("search-next").addEventListener("click", () => navigateSearch(1));
// Timeline controls
document.getElementById("prev-marker").addEventListener("click", () => navigateToLocation(state.currentLocationIndex - 1));
document.getElementById("next-marker").addEventListener("click", () => navigateToLocation(state.currentLocationIndex + 1));
document.getElementById("play-journey").addEventListener("click", playJourney);
document.getElementById("timeline-bar").addEventListener("click", e => {
    if (!state.allLocations.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const idx = Math.floor((e.clientX - rect.left) / rect.width * state.allLocations.length);
    navigateToLocation(Math.min(idx, state.allLocations.length - 1));
});
// Reading progress scroll and reading mode auto-hide
document.getElementById("pdf-viewer").addEventListener("scroll", () => {
    updateReadingProgress();
    readingMode.handleScroll();
});
// Window resize
window.addEventListener("resize", rescaleOverlays);
// Gesture: swipe down to close map panel
const mapPanel = document.getElementById("mapPanel");
const hammer = new Hammer(mapPanel);
hammer.get("swipe").set({ direction: Hammer.DIRECTION_VERTICAL });
hammer.on("swipedown", () => { if (state.mapOpen) toggleMap(); });
// Install prompt handling
window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    const installBtn = document.getElementById("menu-install");
    const divider = document.getElementById("install-divider");
    if (installBtn) installBtn.style.display = "flex";
    if (divider) divider.style.display = "block";
});
document.getElementById("menu-install")?.addEventListener("click", () => {
    if (state.deferredInstallPrompt) {
        state.deferredInstallPrompt.prompt();
        state.deferredInstallPrompt = null;
        document.getElementById("menu-install").style.display = "none";
        document.getElementById("install-divider").style.display = "none";
    }
});

// Initialize application
async function init() {
    initMap();
    initResizeHandle();
    setViewMode('split-h');
    feather.replace();

    // Load cached document (PDF or EPUB)
    const cached = await localforage.getItem("cachedDocument");
    const cachedType = await localforage.getItem("cachedDocumentType");
    const cachedName = await localforage.getItem("cachedDocumentName") || 'Document';

    if (cached) {
        if (cachedType === 'epub') {
            loadEPUB(new Blob([cached], { type: "application/epub+zip" }), cachedName);
        } else {
            loadPDF(new Blob([cached], { type: "application/pdf" }), cachedName);
        }
    } else if (typeof generateDefaultDocumentPDF === 'function') {
        // No cached document — load the bundled default document
        const defaultBlob = generateDefaultDocumentPDF();
        loadPDF(defaultBlob, DEFAULT_DOCUMENT_TITLE + '.pdf');
    }
}
init();
