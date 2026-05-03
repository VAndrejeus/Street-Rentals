const { Map, View } = ol;
const { Tile: TileLayer, Vector: VectorLayer } = ol.layer;
const { XYZ, Vector: VectorSource } = ol.source;
const { Feature } = ol;
const { Point, Polygon } = ol.geom;
const { Style, Circle: CircleStyle, Fill, Stroke, Text } = ol.style;
const { fromLonLat, toLonLat } = ol.proj;

const centerStart = fromLonLat([-73.9352, 40.7306]);
const tileSources = [
  {
    name: "Carto Voyager",
    urls: [
      "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
      "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
      "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
      "https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"
    ],
    attributions:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
  },
  {
    name: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attributions: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }
];

let activeTileIndex = 0;
const tileLayer = new TileLayer({
  preload: Infinity,
  source: createTileSource(activeTileIndex)
});
const markerSource = new VectorSource();
const radiusSource = new VectorSource();
const radiusLayer = new VectorLayer({
  source: radiusSource,
  style: new Style({
    fill: new Fill({ color: "rgba(8, 127, 91, 0.08)" }),
    stroke: new Stroke({ color: "#087f5b", width: 2 })
  })
});
const markerLayer = new VectorLayer({
  source: markerSource,
  style: markerStyle
});

const map = new Map({
  target: "map",
  layers: [tileLayer, radiusLayer, markerLayer],
  view: new View({
    center: centerStart,
    zoom: 13,
    maxZoom: 20
  })
});

const mapElement = document.querySelector("#map");
const mapPaneElement = document.querySelector(".map-pane");
let redrawTimer = null;
let lastQuery = "";
let lastCoords = null;
let currentItems = [];
let activeId = "";

const els = {
  form: document.querySelector("#searchForm"),
  input: document.querySelector("#locationInput"),
  radius: document.querySelector("#radiusInput"),
  radiusOut: document.querySelector("#radiusOutput"),
  refresh: document.querySelector("#refreshBtn"),
  locate: document.querySelector("#locateBtn"),
  status: document.querySelector("#status"),
  resultCount: document.querySelector("#resultCount"),
  vehicleCount: document.querySelector("#vehicleCount"),
  providerCount: document.querySelector("#providerCount"),
  selected: document.querySelector("#selectedCard"),
  list: document.querySelector("#resultsList"),
  filter: document.querySelector("#filterSelect")
};

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  search();
});
els.radius.addEventListener("input", () => {
  els.radiusOut.value = `${Number(els.radius.value).toFixed(1).replace(".0", "")} mi`;
});
els.radius.addEventListener("change", () => rerunLastSearch());
els.refresh.addEventListener("click", () => rerunLastSearch());
els.locate.addEventListener("click", useCurrentLocation);
els.filter.addEventListener("change", renderList);

window.addEventListener("resize", () => refreshMap());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshMap();
});

if ("ResizeObserver" in window) {
  const resizeObserver = new ResizeObserver(() => refreshMap());
  resizeObserver.observe(mapElement);
  resizeObserver.observe(mapPaneElement);
}

tileLayer.getSource().on("tileloaderror", handleTileError);
map.on("click", (event) => {
  const feature = map.forEachFeatureAtPixel(event.pixel, (candidate) => candidate);
  const item = feature?.get("item");
  if (item) selectItem(item.id);
});
map.on("pointermove", (event) => {
  const hit = map.hasFeatureAtPixel(event.pixel);
  map.getTargetElement().style.cursor = hit ? "pointer" : "";
});

function createTileSource(index) {
  const source = tileSources[index];
  const options = {
    attributions: source.attributions,
    crossOrigin: "anonymous",
    maxZoom: 20,
    transition: 0,
    wrapX: true
  };
  if (source.urls) {
    options.urls = source.urls;
  } else {
    options.url = source.url;
  }
  return new XYZ(options);
}

function handleTileError() {
  if (activeTileIndex >= tileSources.length - 1) return;
  activeTileIndex += 1;
  const nextSource = createTileSource(activeTileIndex);
  nextSource.on("tileloaderror", handleTileError);
  tileLayer.setSource(nextSource);
  refreshMap();
}

function refreshMap() {
  window.clearTimeout(redrawTimer);
  redrawTimer = window.setTimeout(() => {
    map.updateSize();
    tileLayer.getSource()?.refresh();
  }, 80);
}

function markerStyle(feature) {
  const item = feature.get("item");
  const isActive = item.id === activeId;
  const available = Number(item.available) || 0;
  const fill = available > 0 && item.renting
    ? item.kind === "station" ? "#087f5b" : "#277da1"
    : "#e76f51";
  return new Style({
    image: new CircleStyle({
      radius: isActive ? 18 : 15,
      fill: new Fill({ color: fill }),
      stroke: new Stroke({ color: "#ffffff", width: isActive ? 4 : 3 })
    }),
    text: new Text({
      text: item.kind === "station" ? String(Math.min(available, 99)) : "1",
      fill: new Fill({ color: "#ffffff" }),
      font: "700 12px Inter, system-ui, sans-serif"
    })
  });
}

async function search(query = els.input.value) {
  const q = query.trim();
  if (!q) return;
  lastQuery = q;
  lastCoords = null;
  activeId = "";
  setLoading(true, `Loading live public feeds near ${q}...`);
  try {
    const params = new URLSearchParams({ q, radius: els.radius.value });
    const response = await fetch(`/api/rentals?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Search failed.");
    currentItems = data.items || [];
    drawMap(data);
    renderSummary(data);
    renderList();
    renderSelected(null);
    const place = data.location.city || data.location.label;
    const sourceText = data.systems.length
      ? `${data.systems.map((system) => system.provider).join(", ")}`
      : "no matching open GBFS provider";
    els.status.textContent = currentItems.length
      ? `${currentItems.length} result${currentItems.length === 1 ? "" : "s"} within ${data.radiusMiles} miles of ${place}. Sources: ${sourceText}.`
      : `No live rentals found within ${data.radiusMiles} miles of ${place}. Try a larger radius or a major nearby city.`;
    if (data.errors?.length) {
      els.status.textContent += " Some feeds were unreachable right now.";
    }
    refreshMap();
  } catch (error) {
    currentItems = [];
    markerSource.clear();
    radiusSource.clear();
    renderSummary({ systems: [], items: [] });
    renderList();
    renderSelected(null);
    els.status.textContent = error.message;
    refreshMap();
  } finally {
    setLoading(false);
  }
}

function rerunLastSearch() {
  if (lastCoords) {
    searchByCoordinates(lastCoords.lat, lastCoords.lon);
    return;
  }
  search(lastQuery || els.input.value);
}

function useCurrentLocation() {
  if (!navigator.geolocation) {
    els.status.textContent = "This browser does not support location lookup.";
    return;
  }
  setLoading(true, "Waiting for your browser location permission...");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      els.input.value = "Current location";
      searchByCoordinates(latitude, longitude);
    },
    (error) => {
      setLoading(false);
      const messages = {
        1: "Location permission was blocked. You can still search by city or ZIP.",
        2: "Your location is unavailable right now. Try a city or ZIP.",
        3: "Location lookup timed out. Try again or search by city or ZIP."
      };
      els.status.textContent = messages[error.code] || "Unable to get your location.";
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000
    }
  );
}

async function searchByCoordinates(lat, lon) {
  activeId = "";
  lastQuery = "Current location";
  lastCoords = { lat, lon };
  setLoading(true, "Loading live public feeds near your location...");
  try {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      radius: els.radius.value
    });
    const response = await fetch(`/api/rentals?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Location search failed.");
    currentItems = data.items || [];
    drawMap(data);
    renderSummary(data);
    renderList();
    renderSelected(null);
    const sourceText = data.systems.length
      ? `${data.systems.map((system) => system.provider).join(", ")}`
      : "no matching open GBFS provider";
    els.status.textContent = currentItems.length
      ? `${currentItems.length} result${currentItems.length === 1 ? "" : "s"} within ${data.radiusMiles} miles of your location. Sources: ${sourceText}.`
      : `No live rentals found within ${data.radiusMiles} miles of your location. Try a larger radius or search a nearby city.`;
    if (data.errors?.length) {
      els.status.textContent += " Some feeds were unreachable right now.";
    }
    refreshMap();
  } catch (error) {
    currentItems = [];
    markerSource.clear();
    radiusSource.clear();
    renderSummary({ systems: [], items: [] });
    renderList();
    renderSelected(null);
    els.status.textContent = error.message;
    refreshMap();
  } finally {
    setLoading(false);
  }
}

function drawMap(data) {
  markerSource.clear();
  radiusSource.clear();
  const centerLonLat = [data.location.lon, data.location.lat];
  const center = fromLonLat(centerLonLat);
  const radiusMeters = data.radiusMiles * 1609.344;
  const radiusFeature = new Feature(createGeodesicCircle(centerLonLat, radiusMeters));
  radiusSource.addFeature(radiusFeature);

  currentItems.forEach((item) => {
    const feature = new Feature(new Point(fromLonLat([item.lon, item.lat])));
    feature.set("item", item);
    markerSource.addFeature(feature);
  });

  const extent = ol.extent.createEmpty();
  ol.extent.extend(extent, radiusFeature.getGeometry().getExtent());
  markerSource.getFeatures().forEach((feature) => {
    ol.extent.extend(extent, feature.getGeometry().getExtent());
  });

  if (ol.extent.isEmpty(extent)) {
    map.getView().animate({ center, zoom: 14, duration: 250 });
  } else {
    map.getView().fit(extent, {
      padding: [90, 90, 90, 90],
      maxZoom: 15,
      duration: 300
    });
  }
  refreshMap();
}

function createGeodesicCircle(centerLonLat, radiusMeters) {
  const [lon, lat] = centerLonLat.map((value) => Number(value));
  const earthRadius = 6371008.8;
  const latRad = toRadians(lat);
  const lonRad = toRadians(lon);
  const angularDistance = radiusMeters / earthRadius;
  const coordinates = [];

  for (let bearingDegrees = 0; bearingDegrees <= 360; bearingDegrees += 3) {
    const bearing = toRadians(bearingDegrees);
    const pointLat = Math.asin(
      Math.sin(latRad) * Math.cos(angularDistance) +
        Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const pointLon = lonRad + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
      Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(pointLat)
    );
    coordinates.push(fromLonLat([toDegrees(pointLon), toDegrees(pointLat)]));
  }

  return new Polygon([coordinates]);
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function toDegrees(value) {
  return (value * 180) / Math.PI;
}

function renderSummary(data) {
  els.resultCount.textContent = data.items?.length || 0;
  els.vehicleCount.textContent = (data.items || []).reduce((sum, item) => sum + (Number(item.available) || 0), 0);
  els.providerCount.textContent = data.systems?.length || 0;
}

function visibleItems() {
  const filter = els.filter.value;
  return currentItems.filter((item) => {
    if (filter === "station") return item.kind === "station";
    if (filter === "vehicle") return item.kind === "vehicle";
    if (filter === "available") return item.available > 0 && item.renting;
    return true;
  });
}

function renderList() {
  const items = visibleItems();
  if (!items.length) {
    els.list.innerHTML = `<p class="status">No results match this filter.</p>`;
    return;
  }
  els.list.innerHTML = items
    .slice(0, 120)
    .map((item) => {
      const active = item.id === activeId ? " active" : "";
      return `
        <button class="result-card${active}" data-id="${escapeHtml(item.id)}">
          <h3>${escapeHtml(item.name)}</h3>
          <div class="meta-row">
            <span>${escapeHtml(item.provider)}</span>
            <span>${miles(item.distanceKm)} away</span>
          </div>
          <div class="pill-row">
            ${availabilityPill(item)}
            <span class="pill info">${item.kind === "station" ? "Station" : "Free-floating"}</span>
            ${item.docks !== null ? `<span class="pill">${item.docks} docks</span>` : ""}
          </div>
        </button>
      `;
    })
    .join("");
  els.list.querySelectorAll("[data-id]").forEach((button) => {
    button.addEventListener("click", () => selectItem(button.dataset.id));
  });
}

function selectItem(id) {
  const item = currentItems.find((candidate) => candidate.id === id);
  if (!item) return;
  activeId = id;
  markerLayer.changed();
  renderSelected(item);
  renderList();
  map.getView().animate({
    center: fromLonLat([item.lon, item.lat]),
    zoom: Math.max(map.getView().getZoom() || 14, 16),
    duration: 250
  });
}

function renderSelected(item) {
  if (!item) {
    els.selected.className = "selected-card empty";
    els.selected.innerHTML = `
      <h2>Select a marker</h2>
      <p>Details, current availability, pricing, app links, and service alerts appear here.</p>
    `;
    return;
  }
  els.selected.className = "selected-card";
  const rentalUrl = item.rentalUris?.web || item.rentalUris?.ios || item.rentalUris?.android || "";
  els.selected.innerHTML = `
    <h2>${escapeHtml(item.name)}</h2>
    <div class="meta-row">
      <span>${escapeHtml(item.provider)}</span>
      <span>${miles(item.distanceKm)} away</span>
      <span>${item.kind === "station" ? "Station" : "Free-floating vehicle"}</span>
    </div>
    <div class="detail-grid">
      <div><strong>${Number(item.available) || 0}</strong><small>Available</small></div>
      <div><strong>${item.docks ?? "N/A"}</strong><small>Open docks</small></div>
      <div><strong>${item.capacity ?? "N/A"}</strong><small>Capacity</small></div>
      <div><strong>${item.renting ? "Yes" : "No"}</strong><small>Renting now</small></div>
    </div>
    ${item.address ? `<p>${escapeHtml(item.address)}</p>` : ""}
    ${item.battery ? `<p><strong>${escapeHtml(item.battery)}</strong></p>` : ""}
    ${detailSection("Vehicle mix", vehicleMix(item))}
    ${detailSection("Pricing", item.pricing?.length ? item.pricing : ["Pricing not published in this feed"])}
    ${detailSection("Service alerts", item.alerts?.length ? item.alerts.map((alert) => alert.summary) : ["No active alert in feed"])}
    ${item.updatedAt ? `<p class="meta-row">Updated ${new Date(item.updatedAt).toLocaleString()}</p>` : ""}
    ${rentalUrl ? `<a class="link-button" href="${escapeAttr(rentalUrl)}" target="_blank" rel="noreferrer">Open rental link</a>` : ""}
  `;
}

function detailSection(title, rows) {
  return `
    <section>
      <h3>${escapeHtml(title)}</h3>
      <div class="pill-row">
        ${rows.map((row) => `<span class="pill">${escapeHtml(row)}</span>`).join("")}
      </div>
    </section>
  `;
}

function vehicleMix(item) {
  if (item.vehicleTypes?.length) {
    return item.vehicleTypes.map((type) => `${type.count} ${type.name}`);
  }
  return [item.kind === "station" ? `${item.available} vehicles` : item.name];
}

function availabilityPill(item) {
  if (!item.installed) return `<span class="pill stop">Not installed</span>`;
  if (!item.renting) return `<span class="pill stop">Not renting</span>`;
  if (item.available <= 0) return `<span class="pill warn">None available</span>`;
  return `<span class="pill">${item.available} available</span>`;
}

function miles(distanceKm) {
  return `${(distanceKm * 0.621371).toFixed(1)} mi`;
}

function setLoading(isLoading, text) {
  els.refresh.disabled = isLoading;
  els.locate.disabled = isLoading;
  els.form.querySelector("button").disabled = isLoading;
  if (text) els.status.textContent = text;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

search();
