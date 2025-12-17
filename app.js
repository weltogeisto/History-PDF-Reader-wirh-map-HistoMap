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
    regionsVisible: false // Whether region polygons are visible
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
        layer: () => {
            // Count mentions per location
            const mentionCounts = {};
            state.allLocations.forEach(loc => {
                const name = loc.name;
                mentionCounts[name] = (mentionCounts[name] || 0) + 1;
            });
            // Create heatmap points with intensity based on mention count
            const heatPoints = [];
            const maxMentions = Math.max(...Object.values(mentionCounts), 1);
            Object.entries(mentionCounts).forEach(([name, count]) => {
                const coords = getContextualCoords(name);
                if (coords) {
                    // Intensity ranges from 0.3 to 1.0 based on mention frequency
                    const intensity = 0.3 + (count / maxMentions) * 0.7;
                    heatPoints.push([coords[0], coords[1], intensity]);
                }
            });
            return L.heatLayer(heatPoints, {
                radius: 40,
                blur: 25,
                maxZoom: 10,
                max: 1.0,
                gradient: { 0.2: '#3b82f6', 0.5: '#8b5cf6', 0.8: '#ec4899', 1: '#f43f5e' }
            });
        }
    },
    terrain: {
        name: "Terrain & Elevation",
        // Using shaded relief to show topography - this one is actually useful
        layer: () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 13,
            opacity: 0.5,
            attribution: '© Esri',
            className: 'overlay-terrain'
        })
    },
    geopolitical: {
        name: "Theaters of Conflict",
        // Heatmap showing concentration of battles, sieges, and military events
        layer: () => {
            // Extract coordinates from event-type locations
            const eventPoints = state.allLocations
                .filter(loc => loc.type === 'event')
                .map(loc => {
                    const coords = getContextualCoords(loc.locationName || loc.name);
                    // Higher intensity for events (battles are important)
                    return coords ? [coords[0], coords[1], 0.85] : null;
                })
                .filter(p => p !== null);
            // If no events found, show a message layer
            if (eventPoints.length === 0) {
                return L.layerGroup(); // Empty layer if no events
            }
            return L.heatLayer(eventPoints, {
                radius: 35,
                blur: 20,
                maxZoom: 12,
                max: 1.0,
                gradient: { 0.3: '#22c55e', 0.5: '#eab308', 0.7: '#f97316', 1: '#ef4444' }
            });
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

// GeoDatabase (locations and regions)
const geoDatabase = {
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
    Belgrade: { coords: [44.7866, 20.4489], type: "location" },
    Bucharest: { coords: [44.4268, 26.1025], type: "location" },
    Baghdad: { coords: [33.3152, 44.3661], type: "location" },
    Damascus: { coords: [33.5138, 36.2765], type: "location" },
    Cairo: { coords: [30.0444, 31.2357], type: "location" },
    Jerusalem: { coords: [31.7683, 35.2137], type: "location" },
    Mecca: { coords: [21.4225, 39.8262], type: "location" },
    Mohacs: { coords: [45.9928, 18.6839], type: "location" },
    Varna: { coords: [43.2141, 27.9147], type: "location" },
    Sofia: { coords: [42.6977, 23.3219], type: "location" },
    Odessa: { coords: [46.4825, 30.7233], type: "location" },
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
    Venice: { coords: [45.4408, 12.3155], type: "location" },
    Lepanto: { coords: [38.3917, 21.8256], type: "location" },
    Rhodes: { coords: [36.4349, 28.2176], type: "location" },
    Cyprus: { coords: [35.1264, 33.4299], type: "location" },
    Crete: { coords: [35.2401, 24.8093], type: "location" },
    Albania: { coords: [41.1533, 20.1683], type: "location" },
    Astrakhan: { coords: [46.3497, 48.0408], type: "location", aliases: ["Astracan"] },
    Danube: { type: "river", segments: { upper: { coords: [48.3069, 14.2858] }, middle: { coords: [44.8167, 20.4667] }, lower: { coords: [45.248, 28.713] } } },
    "Black Sea": { coords: [43.0, 35.0], type: "location" },
    Volga: { coords: [48.7, 44.5], type: "location" },
    "Ottoman Empire": {
        type: "region", color: "#10b981",
        coords: [
            [[45.2, 16.5], [45.8, 19.1], [44.8, 22.5], [45.5, 26.0], [46.5, 30.2], [45.3, 29.5], [44.4, 28.7], [42.0, 28.0], [41.0, 29.0], [40.3, 26.2], [40.5, 24.5], [39.0, 23.5], [37.0, 22.4], [39.0, 20.0], [42.0, 19.0], [43.5, 17.5]],
            [[41.0, 29.0], [41.8, 32.5], [42.0, 37.0], [41.5, 41.5], [40.0, 43.5], [37.5, 43.8], [36.0, 42.0], [35.5, 36.0], [36.5, 32.5], [36.0, 29.5], [38.5, 26.5]]
        ]
    },
    "Russian Empire": { type: "region", center: [55.0, 40.0], color: "#dc2626" },
    "Byzantine Empire": { type: "region", center: [39.0, 32.0], color: "#7c3aed" },
    Anatolia: { type: "region", coords: [[36.0, 26.0], [41.5, 26.0], [42.0, 40.0], [37.0, 44.5], [36.0, 26.0]], center: [39.0, 35.0], color: "#3b82f6" },
    Balkans: { type: "region", coords: [[37.0, 19.0], [46.0, 13.0], [47.0, 22.0], [40.0, 28.0], [37.0, 21.0]], center: [42.0, 21.0], color: "#8b5cf6" },
    Caucasus: { type: "region", coords: [[40.0, 38.0], [44.0, 48.0], [40.0, 48.0], [40.0, 38.0]], center: [42.0, 43.0], color: "#10b981" },
    Crimea: { type: "region", coords: [[44.4, 32.5], [45.5, 32.5], [46.2, 34.0], [45.5, 36.5], [44.4, 35.5], [44.4, 32.5]], center: [45.0, 34.0], color: "#f59e0b" },
    Hungary: {
        type: "region", color: "#ef4444",
        coords: [[48.0, 17.0], [48.8, 19.5], [48.5, 22.5], [48.0, 23.0], [46.5, 21.5], [46.0, 20.0], [45.8, 19.0], [46.0, 17.5], [47.0, 16.5]]
    },
    Greece: { type: "region", coords: [[35.0, 19.0], [42.0, 19.0], [42.0, 30.0], [35.0, 30.0], [35.0, 19.0]], center: [39.0, 22.0], color: "#2dd4bf" },
    Serbia: { type: "region", coords: [[42.0, 18.5], [46.2, 18.5], [46.2, 23.0], [42.0, 23.0], [42.0, 18.5]], center: [44.0, 21.0], color: "#c084fc" },
    Bulgaria: { type: "region", coords: [[41.2, 22.3], [44.2, 22.3], [44.2, 28.6], [41.2, 28.6], [41.2, 22.3]], center: [42.7, 25.5], color: "#4ade80" }
};

// Event-specific locations (for events like battles, sieges, etc.)
const eventLocations = {
    "Poltava": [49.5883, 34.5514], "Mohacs": [45.9928, 18.6839], "Sinope": [42.0231, 35.1531],
    "Navarino": [36.9167, 21.7], "Chesma": [38.3167, 26.3833], "Kagul": [45.4667, 28.2],
    "Ismail": [45.35, 28.8333], "Ochakov": [46.6167, 31.55], "Vienna": [48.2082, 16.3738],
    "Constantinople": [41.0082, 28.9784], "Sevastopol": [44.6167, 33.525], "Varna": [43.2141, 27.9147],
    "Adrianople": [41.6667, 26.5556], "Gallipoli": [40.4167, 26.6667], "Shipka": [42.7167, 25.3167],
    "Pleven": [43.4167, 24.6167], "Kars": [40.6167, 43.1], "Rhodes": [36.4349, 28.2176],
    "Lepanto": [38.3917, 21.8256], "Azov": [47.1, 39.4], "Cyprus": [35.1264, 33.4299],
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

// Map base tile definitions
const mapTiles = {
    modern: { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attr: "© OpenStreetMap" },
    topo: { url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attr: "© OpenTopoMap" },
    satellite: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attr: "© Esri" }
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

// Initialize the main map with clustering and base layer tracking
function initMap() {
    state.map = L.map("map", { zoomControl: false }).setView([45, 30], 4);
    L.control.zoom({ position: 'topright' }).addTo(state.map);
    // Set initial base layer and track it for style changes
    state.currentTileLayer = L.tileLayer(mapTiles.modern.url, { maxZoom: 18, attribution: mapTiles.modern.attr }).addTo(state.map);
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
    // Update main map base layer
    if (state.currentTileLayer && state.map) {
        state.map.removeLayer(state.currentTileLayer);
    }
    state.currentTileLayer = L.tileLayer(tile.url, { maxZoom: 18, attribution: tile.attr });
    if (state.map) state.currentTileLayer.addTo(state.map);
    // Update inline map base layer
    if (state.inlineTileLayer && state.inlineMap) {
        state.inlineMap.removeLayer(state.inlineTileLayer);
    }
    if (state.inlineMap) {
        state.inlineTileLayer = L.tileLayer(tile.url, { maxZoom: 18, attribution: tile.attr }).addTo(state.inlineMap);
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
            const l = def.layer();
            if (l.setZIndex) l.setZIndex(10);
            l.addTo(state.map);
            tracking.main = l;
        }
        if (state.inlineMap) {
            const l = def.layer();
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

// Disambiguation rules for ambiguous location names
const disambiguationRules = {
    "Georgia": {
        caucasus: { keywords: ["Ottoman", "Russia", "Caucasus", "Tbilisi", "Persia", "Byzantine", "Colchis", "Black Sea"], coords: [41.7151, 44.8271] },
        us: { keywords: ["Atlanta", "Confederate", "Sherman", "Civil War", "United States", "American"], coords: [32.1656, -82.9001] }
    },
    "Alexandria": {
        egypt: { keywords: ["Egypt", "Nile", "Pharaoh", "Ptolemy", "Mediterranean", "Ottoman", "Napoleon"], coords: [31.2001, 29.9187] },
        virginia: { keywords: ["Virginia", "Washington", "Potomac", "American", "Civil War"], coords: [38.8048, -77.0469] }
    },
    "Memphis": {
        egypt: { keywords: ["Egypt", "Pharaoh", "Nile", "Ancient", "Pyramid"], coords: [29.8448, 31.2501] },
        us: { keywords: ["Tennessee", "Mississippi", "Elvis", "Blues", "American"], coords: [35.1495, -90.0490] }
    },
    "Tripoli": {
        libya: { keywords: ["Libya", "Ottoman", "Barbary", "Mediterranean", "Africa", "Gaddafi"], coords: [32.8872, 13.1913] },
        lebanon: { keywords: ["Lebanon", "Crusade", "Levant", "Phoenicia"], coords: [34.4367, 35.8497] }
    }
};

// Disambiguate location based on surrounding text context
function disambiguateLocation(name, text, matchIndex) {
    const rules = disambiguationRules[name];
    if (!rules) return null;

    // Get surrounding context (200 chars before and after)
    const contextStart = Math.max(0, matchIndex - 200);
    const contextEnd = Math.min(text.length, matchIndex + name.length + 200);
    const context = text.slice(contextStart, contextEnd).toLowerCase();

    let bestMatch = null;
    let bestScore = 0;

    for (const [region, rule] of Object.entries(rules)) {
        const score = rule.keywords.filter(kw => context.includes(kw.toLowerCase())).length;
        if (score > bestScore) {
            bestScore = score;
            bestMatch = { region, coords: rule.coords };
        }
    }

    return bestMatch;
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

// Extract entities for a page of text with disambiguation
// Implements longest-match preference and proper regex escaping
function extractEntitiesForPage(text) {
    const candidateMatches = [];

    // Step 1: Find ALL possible matches from geoDatabase
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
            }
        }
    });

    // Step 2: Find event-based matches (Battle of, Siege of, etc.)
    [/Battle of ([A-Z][a-z]+)/gi, /Siege of ([A-Z][a-z]+)/gi, /Fall of ([A-Z][a-z]+)/gi, /Treaty of ([A-Z][a-z]+)/gi].forEach(pattern => {
        let m;
        pattern.lastIndex = 0; // Reset regex state
        while ((m = pattern.exec(text)) !== null) {
            candidateMatches.push({
                text: m[0],
                type: "event",
                name: m[0],
                locationName: m[1],
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
            }

            entities.push(entity);
            usedRanges.push({ start, end });
        }
    }

    // Step 5: Sort final entities by position for rendering
    entities.sort((a, b) => a.index - b.index);

    return entities;
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
                    virtualScrollConfig.observer.unobserve(entry.target);
                    renderPage(pageNum)
                        .then(() => {
                            virtualScrollConfig.renderedPages.add(pageNum);
                            rescaleOverlays();
                            updateTimeline();
                            // Re-observe for potential unloading
                            const newWrapper = document.querySelector(`[data-page="${pageNum}"]`);
                            if (newWrapper) unloadObserver.observe(newWrapper);
                        })
                        .catch(err => {
                            console.error(`Failed to render page ${pageNum}:`, err);
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
                    hl.dataset.location = entity.name;
                    hl.dataset.entityType = entity.type;
                    if (entity.locationName) hl.dataset.eventLocation = entity.locationName;
                    // Store viewport coordinates for accurate rescaling
                    hl.dataset.leftV = leftV;
                    hl.dataset.topV = topV;
                    hl.dataset.widthV = wV;
                    hl.dataset.heightV = hV;
                    hl.onclick = () => handleLocationClick(entity.name, hl, entity.type, entity.locationName);
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

        localforage.setItem("cachedDocument", arrayBuffer);
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

        localforage.setItem("cachedDocument", arrayBuffer);
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
    const walker = document.createTreeWalker(contentDiv, NodeFilter.SHOW_TEXT, null, false);
    let node;

    while (node = walker.nextNode()) {
        const text = node.textContent;
        const escapedText = escapeRegex(entity.text);
        const regex = new RegExp(`\\b${escapedText}\\b`, 'gi');
        const match = regex.exec(text);

        if (match) {
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

            const before = text.substring(0, match.index);
            const after = text.substring(match.index + match[0].length);

            const parent = node.parentNode;
            const beforeNode = document.createTextNode(before);
            const afterNode = document.createTextNode(after);

            parent.insertBefore(beforeNode, node);
            parent.insertBefore(span, node);
            parent.insertBefore(afterNode, node);
            parent.removeChild(node);

            // Add to locations
            state.allLocations.push({
                name: entity.name,
                element: span,
                page: chapterNum,
                type: entity.type,
                locationName: entity.locationName
            });

            // Add marker to map
            const coords = entity.type === "event" && entity.locationName
                ? (eventLocations[entity.locationName] || getContextualCoords(entity.locationName))
                : getContextualCoords(entity.name);

            if (coords) {
                addToContext(entity.name, coords);
                const marker = L.marker(coords).bindPopup(`<b>${entity.name}</b><br>Chapter ${chapterNum}`);
                state.allMarkers.push(marker);
                state.markerCluster.addLayer(marker);
            }

            break; // Only highlight first occurrence per entity per chapter
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
            await libraryDB.setItem(`doc_${hash}`, arrayBuffer);
            entry.stored = true;
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
    }
}
init();