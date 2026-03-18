// Create Cesium Viewer
const viewer = new Cesium.Viewer("cesiumContainer", {
    imageryProvider: false,
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    animation: false,
    timeline: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    contextOptions: { webgl: { alpha: true } }
});

viewer.scene.globe.baseColor = Cesium.Color.TRANSPARENT;
viewer.scene.backgroundColor = Cesium.Color.TRANSPARENT;
viewer.scene.globe.enableLighting = false;
viewer.scene.globe.showGroundAtmosphere = false;
viewer.scene.skyAtmosphere.show = false;
viewer.scene.skyBox.show = false;
viewer.scene.fog.enabled = false;
viewer.scene.sun.show = false;
viewer.scene.moon.show = false;

viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(20, 20, 30000000)
});

// Add grid imagery
viewer.imageryLayers.removeAll();

const grid = new Cesium.GridImageryProvider({
    cells: 10,
    color: Cesium.Color.BLACK.withAlpha(0.3),
    glowColor: Cesium.Color.TRANSPARENT,
    backgroundColor: Cesium.Color.fromCssColorString("#71d0e8ff")
});
viewer.imageryLayers.addImageryProvider(grid);

// Add silhouette post-process
const silhouette = Cesium.PostProcessStageLibrary.createSilhouetteStage();
silhouette.uniforms.color = Cesium.Color.BLACK.withAlpha(1);
viewer.scene.postProcessStages.add(silhouette);

// Helper functions
function rebuildPolygon(entity) {
    const hierarchy = entity.polygon.hierarchy.getValue(Cesium.JulianDate.now());
    return new Cesium.PolygonHierarchy(hierarchy.positions, hierarchy.holes);
}

function getPolygonCenter(entity) {
    const hierarchy = entity.polygon.hierarchy.getValue(Cesium.JulianDate.now());
    return Cesium.BoundingSphere.fromPoints(hierarchy.positions).center;
}

function toTitleCase(str) {
    return str.replace(/\b\w/g, l => l.toUpperCase());
}

// State
let fillDataSource;
let countryIndex = {};
let countryNames = [];
let selectedLabel = null;
let targetCountry = null;
let currentClueIndex = 0;
let targetCountryInfo = {};
const countryInfoCache = {};

// Load country GeoJSON
Cesium.GeoJsonDataSource.load("worldcountriesfill.geojson", { clampToGround: true }).then(ds => {
    fillDataSource = ds;
    viewer.dataSources.add(ds);

    ds.entities.values.forEach(entity => {
        if (!entity.polygon) return;

        entity.polygon.hierarchy = rebuildPolygon(entity);
        entity.polygon.arcType = Cesium.ArcType.GEODESIC;
        entity.polygon.material = Cesium.Color.fromCssColorString("#0f4326ff").withAlpha(1);

        const countryName = entity.properties.name.getValue();
        if (!countryIndex[countryName]) {
            countryIndex[countryName] = [];
            countryNames.push(countryName);
        }
        countryIndex[countryName].push(entity);
    });

    startCountryChallenge();
});

// Country challenge logic
function startCountryChallenge() {
    if (!countryNames.length) return;

    currentClueIndex = 0;
    const randomIndex = Math.floor(Math.random() * countryNames.length);
    targetCountry = countryNames[randomIndex];
    const entity = countryIndex[targetCountry][0];
    const wikidataID = entity.properties.wikidata_id.getValue();

    fetchCountryData(wikidataID).then(info => {
        targetCountryInfo = info;
        showNextClue();
    });
}

function showNextClue() {
    const banner = document.getElementById("countryChallenge");
    const clues = [
        `Population: ${targetCountryInfo.population}`,
        `Capital: ${targetCountryInfo.capital}`,
        `Currency: ${targetCountryInfo.currency}`,
        `Languages: ${targetCountryInfo.languages}`
    ];

    banner.textContent = currentClueIndex < clues.length
        ? clues[currentClueIndex]
        : `The country was: ${targetCountry}. Refresh to try again!`;
}

async function fetchCountryData(wikidataID) {
    if (countryInfoCache[wikidataID]) return countryInfoCache[wikidataID];

    const query = `
        SELECT ?population ?currencyLabel ?capitalLabel ?languageLabel WHERE {
            OPTIONAL { wd:${wikidataID} wdt:P1082 ?population. }
            OPTIONAL { wd:${wikidataID} wdt:P38 ?currency. }
            OPTIONAL { wd:${wikidataID} wdt:P36 ?capital. }
            OPTIONAL { wd:${wikidataID} wdt:P2936 ?language. }
            SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en". }
        }
    `;
    const url = "https://query.wikidata.org/sparql?query=" + encodeURIComponent(query);

    try {
        const response = await fetch(url, { headers: { 'Accept': 'application/sparql-results+json' } });
        const data = await response.json();

        const languages = [...new Set(
            data.results.bindings.map(r => r.languageLabel?.value).filter(Boolean)
        )].join(", ") || "Unknown";

        const row = data.results.bindings[0] || {};
        const result = {
            population: row.population ? Number(row.population.value).toLocaleString() : "Unknown",
            currency: row.currencyLabel ? toTitleCase(row.currencyLabel.value) : "Unknown",
            capital: row.capitalLabel ? row.capitalLabel.value : "Unknown",
            languages
        };

        countryInfoCache[wikidataID] = result;
        return result;
    } catch (err) {
        console.error("Wikidata fetch error:", err);
        return { population: "Unknown", currency: "Unknown", capital: "Unknown", languages: "Unknown" };
    }
}

// Click handler for countries
const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
handler.setInputAction(click => {
    const picked = viewer.scene.pick(click.position);
    if (!Cesium.defined(picked)) return;

    const entity = picked.id;
    if (!fillDataSource?.entities.contains(entity)) return;

    const countryName = entity.properties.name.getValue();
    const banner = document.getElementById("countryChallenge");

    // Correct or incorrect selection
    if (countryName === targetCountry) {
        banner.textContent = "Correct!";
        banner.style.background = "#11ff00ff";
        countryIndex[countryName].forEach(e => e.polygon.material = Cesium.Color.fromCssColorString("#00ff2aff").withAlpha(1));
        setTimeout(() => banner.style.background = "white", 500);
        setTimeout(() => startCountryChallenge(), 1000);
    } else {
        banner.style.background = "#ff0000ff";
        countryIndex[countryName].forEach(e => e.polygon.material = Cesium.Color.fromCssColorString("#ff0000ff").withAlpha(1));
        currentClueIndex++;
        showNextClue();
        setTimeout(() => banner.style.background = "white", 500);
    }

    // Label for selected country
    const center = getPolygonCenter(countryIndex[countryName][0]);
    if (selectedLabel) viewer.entities.remove(selectedLabel);
    selectedLabel = viewer.entities.add({
        position: center,
        label: {
            text: countryName,
            font: "50px sans-serif",
            fillColor: Cesium.Color.YELLOW,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
    });
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);