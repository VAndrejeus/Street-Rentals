const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 4173;
const PUBLIC_DIR = path.join(__dirname, "public");
const TWO_MILES_KM = 3.21869;
const SYSTEMS_CSV =
  "https://raw.githubusercontent.com/MobilityData/gbfs/master/systems.csv";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT =
  "StreetRentals/1.0 (local development; public open-data demo)";

const cache = new Map();

const curatedSystems = [
  {
    id: "citibike",
    name: "Citi Bike",
    cities: ["new york", "nyc", "jersey city", "hoboken", "brooklyn", "queens"],
    lat: 40.7306,
    lon: -73.9352,
    url: "https://gbfs.citibikenyc.com/gbfs/2.3/gbfs.json"
  },
  {
    id: "baywheels",
    name: "Bay Wheels",
    cities: ["san francisco", "oakland", "san jose", "berkeley", "bay area"],
    lat: 37.7749,
    lon: -122.4194,
    url: "https://gbfs.baywheels.com/gbfs/2.3/gbfs.json"
  },
  {
    id: "capital-bikeshare",
    name: "Capital Bikeshare",
    cities: ["washington", "washington dc", "dc", "arlington", "alexandria"],
    lat: 38.9072,
    lon: -77.0369,
    url: "https://gbfs.capitalbikeshare.com/gbfs/2.3/gbfs.json"
  },
  {
    id: "divvy",
    name: "Divvy",
    cities: ["chicago", "evanston"],
    lat: 41.8781,
    lon: -87.6298,
    url: "https://gbfs.divvybikes.com/gbfs/2.3/gbfs.json"
  },
  {
    id: "bluebikes",
    name: "Bluebikes",
    cities: ["boston", "cambridge", "somerville", "brookline", "everett"],
    lat: 42.3601,
    lon: -71.0589,
    url: "https://gbfs.bluebikes.com/gbfs/gbfs.json"
  },
  {
    id: "metro-bike-share",
    name: "Metro Bike Share",
    cities: ["los angeles", "la", "santa monica", "dtla"],
    lat: 34.0522,
    lon: -118.2437,
    url: "https://gbfs.bcycle.com/bcycle_lametro/gbfs.json"
  },
  {
    id: "bublr",
    name: "Bublr Bikes",
    cities: ["milwaukee", "wauwatosa", "west allis"],
    lat: 43.0389,
    lon: -87.9065,
    url: "https://gbfs.bcycle.com/bcycle_bublr/gbfs.json"
  },
  {
    id: "reddy",
    name: "Reddy Bikeshare",
    cities: ["buffalo", "niagara falls"],
    lat: 42.8864,
    lon: -78.8784,
    url: "https://reddybikeshare.socialbicycles.com/opendata/gbfs.json"
  }
];

function send(res, status, body, type = "application/json") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

function notFound(res) {
  send(res, 404, { error: "Not found" });
}

function readStatic(filePath, res) {
  const requestedPath = filePath === "/" ? "index.html" : filePath.replace(/^[/\\]+/, "");
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const fullPath = path.join(PUBLIC_DIR, safePath);
  if (!fullPath.startsWith(PUBLIC_DIR)) return notFound(res);
  fs.readFile(fullPath, (err, data) => {
    if (err) return notFound(res);
    const ext = path.extname(fullPath).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    };
    send(res, 200, data, types[ext] || "application/octet-stream");
  });
}

async function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < ttlMs) return hit.value;
  const value = await loader();
  cache.set(key, { value, time: Date.now() });
  return value;
}

async function fetchText(url, ttlMs = 300000) {
  return cached(`text:${url}`, ttlMs, async () => {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.text();
  });
}

async function fetchJson(url, ttlMs = 60000) {
  return cached(`json:${url}`, ttlMs, async () => {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (field || row.length) {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      }
      if (char === "\r" && next === "\n") i += 1;
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header.trim(), values[index] || ""]))
  );
}

async function geocode(query) {
  const url = new URL(NOMINATIM);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "us,ca");
  url.searchParams.set("q", query);
  const results = await fetchJson(url.toString(), 86400000);
  if (!Array.isArray(results) || !results[0]) {
    throw new Error("Location not found. Try a nearby city name or ZIP code.");
  }
  const place = results[0];
  const address = place.address || {};
  return {
    query,
    lat: Number(place.lat),
    lon: Number(place.lon),
    label: place.display_name,
    city:
      address.city ||
      address.town ||
      address.village ||
      address.hamlet ||
      address.county ||
      query,
    state: address.state || "",
    postcode: address.postcode || ""
  };
}

async function catalogSystems() {
  return cached("catalog-systems", 86400000, async () => {
    const text = await fetchText(SYSTEMS_CSV, 86400000);
    return parseCsv(text)
      .map((row) => ({
        id: row["System ID"] || row.system_id || row.ID || row.Name,
        name: row.Name || row.System || "Shared mobility system",
        location: row.Location || "",
        country: row["Country Code"] || row.Country || "",
        url: row["Auto-Discovery URL"] || row["URL"] || row.URL || ""
      }))
      .filter((system) => system.url && /^https?:\/\//i.test(system.url));
  });
}

function normalize(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function findCandidateSystems(location) {
  const city = normalize(location.city);
  const state = normalize(location.state);
  const query = normalize(location.query);
  const nearCurated = curatedSystems.filter((system) => {
    const distance = haversine(location.lat, location.lon, system.lat, system.lon);
    const nameHit = system.cities.some((item) => query.includes(item) || city.includes(item));
    return distance <= 80 || nameHit;
  });
  return catalogSystems()
    .then((systems) => {
      const tokens = [city, state, query].filter(Boolean);
      const catalogMatches = systems
        .filter((system) => {
          const haystack = normalize(`${system.name} ${system.location} ${system.id}`);
          return tokens.some((token) => token.length > 2 && haystack.includes(token));
        })
        .slice(0, 10);
      const merged = [...nearCurated, ...catalogMatches];
      return Array.from(new Map(merged.map((system) => [system.url, system])).values()).slice(0, 12);
    })
    .catch(() => nearCurated);
}

function languageFeeds(discovery) {
  const data = discovery.data || {};
  if (Array.isArray(data.feeds)) return data.feeds;
  const languageKey = Object.keys(data).find((key) => Array.isArray(data[key]?.feeds));
  return languageKey ? data[languageKey].feeds : [];
}

function feedUrl(feeds, name) {
  return feeds.find((feed) => feed.name === name)?.url;
}

function asArray(value, keys) {
  for (const key of keys) {
    if (Array.isArray(value?.data?.[key])) return value.data[key];
  }
  return [];
}

async function loadSystem(system, center, radiusKm) {
  const discovery = await fetchJson(system.url, 60000);
  const feeds = languageFeeds(discovery);
  const urls = {
    info: feedUrl(feeds, "system_information"),
    stationInfo: feedUrl(feeds, "station_information"),
    stationStatus: feedUrl(feeds, "station_status"),
    vehicleStatus: feedUrl(feeds, "vehicle_status") || feedUrl(feeds, "free_bike_status"),
    vehicleTypes: feedUrl(feeds, "vehicle_types"),
    pricing: feedUrl(feeds, "system_pricing_plans"),
    alerts: feedUrl(feeds, "system_alerts")
  };

  const [info, stationInfo, stationStatus, vehicleStatus, vehicleTypes, pricing, alerts] =
    await Promise.allSettled([
      urls.info ? fetchJson(urls.info, 300000) : null,
      urls.stationInfo ? fetchJson(urls.stationInfo, 300000) : null,
      urls.stationStatus ? fetchJson(urls.stationStatus, 30000) : null,
      urls.vehicleStatus ? fetchJson(urls.vehicleStatus, 30000) : null,
      urls.vehicleTypes ? fetchJson(urls.vehicleTypes, 300000) : null,
      urls.pricing ? fetchJson(urls.pricing, 300000) : null,
      urls.alerts ? fetchJson(urls.alerts, 60000) : null
    ]).then((values) => values.map((result) => (result.status === "fulfilled" ? result.value : null)));

  const systemInfo = info?.data || {};
  const statusById = new Map(asArray(stationStatus, ["stations"]).map((item) => [item.station_id, item]));
  const typeById = new Map(asArray(vehicleTypes, ["vehicle_types"]).map((item) => [item.vehicle_type_id, item]));
  const pricingById = new Map(asArray(pricing, ["plans"]).map((plan) => [plan.plan_id, plan]));
  const activeAlerts = asArray(alerts, ["alerts"]).filter((alert) => !alert.is_deleted);

  const stations = asArray(stationInfo, ["stations"])
    .map((station) => {
      const status = statusById.get(station.station_id) || {};
      const distanceKm = haversine(center.lat, center.lon, Number(station.lat), Number(station.lon));
      return {
        id: `${system.id || system.name}:station:${station.station_id}`,
        sourceId: station.station_id,
        kind: "station",
        name: station.name || systemInfo.name || system.name,
        provider: systemInfo.name || system.name,
        lat: Number(station.lat),
        lon: Number(station.lon),
        distanceKm,
        address: station.address || station.cross_street || "",
        capacity: station.capacity ?? null,
        available: status.num_vehicles_available ?? status.num_bikes_available ?? 0,
        docks: status.num_docks_available ?? null,
        renting: status.is_renting !== false,
        returning: status.is_returning !== false,
        installed: status.is_installed !== false,
        vehicleTypes: summarizeVehicleCounts(status.vehicle_types_available, typeById),
        rentalUris: station.rental_uris || status.rental_uris || {},
        pricing: pricesForStation(station, pricingById),
        alerts: activeAlerts.map(alertSummary).slice(0, 3),
        updatedAt: status.last_reported ? Number(status.last_reported) * 1000 : null
      };
    })
    .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon) && item.distanceKm <= radiusKm);

  const vehicles = asArray(vehicleStatus, ["vehicles", "bikes"])
    .map((vehicle) => {
      const lat = Number(vehicle.lat);
      const lon = Number(vehicle.lon);
      const type = typeById.get(vehicle.vehicle_type_id) || {};
      const distanceKm = haversine(center.lat, center.lon, lat, lon);
      return {
        id: `${system.id || system.name}:vehicle:${vehicle.vehicle_id || vehicle.bike_id || `${lat},${lon}`}`,
        sourceId: vehicle.vehicle_id || vehicle.bike_id || "",
        kind: "vehicle",
        name: type.name || type.form_factor || "Available vehicle",
        provider: systemInfo.name || system.name,
        lat,
        lon,
        distanceKm,
        address: "",
        capacity: null,
        available: vehicle.is_reserved || vehicle.is_disabled ? 0 : 1,
        docks: null,
        renting: !vehicle.is_reserved && !vehicle.is_disabled,
        returning: null,
        installed: true,
        battery: vehicle.current_range_meters
          ? `${Math.round(vehicle.current_range_meters / 1609.344)} mi range`
          : vehicle.current_fuel_percent
            ? `${vehicle.current_fuel_percent}% battery`
            : "",
        vehicleTypes: type.name || type.form_factor ? [{ name: type.name || type.form_factor, count: 1 }] : [],
        rentalUris: vehicle.rental_uris || {},
        pricing: pricesForVehicle(vehicle, type, pricingById),
        alerts: activeAlerts.map(alertSummary).slice(0, 3),
        updatedAt: vehicle.last_reported ? Number(vehicle.last_reported) * 1000 : null
      };
    })
    .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon) && item.distanceKm <= radiusKm);

  return {
    provider: systemInfo.name || system.name,
    url: systemInfo.url || system.url,
    feeds: urls,
    items: [...stations, ...vehicles]
  };
}

function summarizeVehicleCounts(items, typeById) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    name: typeById.get(item.vehicle_type_id)?.name || item.vehicle_type_id || "Vehicle",
    count: item.count ?? 0
  }));
}

function pricesForStation(station, pricingById) {
  const plans = Array.isArray(station.pricing_plan_ids) ? station.pricing_plan_ids : [];
  return plans.map((id) => priceText(pricingById.get(id))).filter(Boolean);
}

function pricesForVehicle(vehicle, type, pricingById) {
  const ids = [
    ...(Array.isArray(vehicle.pricing_plan_ids) ? vehicle.pricing_plan_ids : []),
    ...(Array.isArray(type.pricing_plan_ids) ? type.pricing_plan_ids : [])
  ];
  return Array.from(new Set(ids)).map((id) => priceText(pricingById.get(id))).filter(Boolean);
}

function priceText(plan) {
  if (!plan) return "";
  const costs = Array.isArray(plan.per_km_pricing) || Array.isArray(plan.per_min_pricing)
    ? "Variable trip pricing"
    : "";
  return [plan.name, plan.price ? formatMoney(plan.price, plan.currency) : "", costs]
    .filter(Boolean)
    .join(" - ");
}

function formatMoney(amount, currency = "USD") {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function alertSummary(alert) {
  return {
    type: alert.alert_type || "alert",
    summary: localized(alert.summary) || localized(alert.description) || "Service alert",
    url: localized(alert.url) || ""
  };
}

function localized(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0]?.text || value[0]?.translation || "";
  return value.text || value.translation || "";
}

function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function rentalsApi(reqUrl, res) {
  const query = reqUrl.searchParams.get("q") || "";
  const hasCoords = reqUrl.searchParams.has("lat") && reqUrl.searchParams.has("lon");
  const lat = hasCoords ? Number(reqUrl.searchParams.get("lat")) : NaN;
  const lon = hasCoords ? Number(reqUrl.searchParams.get("lon")) : NaN;
  const radiusMiles = Math.min(Math.max(Number(reqUrl.searchParams.get("radius") || 2), 0.25), 10);
  const validCoords = Number.isFinite(lat) && Number.isFinite(lon);
  if (!query.trim() && !validCoords) {
    return send(res, 400, { error: "Enter a city or ZIP code, or use your current location." });
  }

  try {
    const location = validCoords
      ? {
          query: "Current location",
          lat,
          lon,
          label: "Current location",
          city: "Current location",
          state: "",
          postcode: ""
        }
      : await geocode(query);
    const radiusKm = radiusMiles * 1.609344 || TWO_MILES_KM;
    const candidates = await findCandidateSystems(location);
    const settled = await Promise.allSettled(
      candidates.map((system) => loadSystem(system, location, radiusKm))
    );
    const systems = settled
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value)
      .filter((system) => system.items.length);
    const errors = settled
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason.message)
      .slice(0, 3);
    const items = systems
      .flatMap((system) => system.items)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 800);

    send(res, 200, {
      location,
      radiusMiles,
      generatedAt: new Date().toISOString(),
      systems: systems.map(({ provider, url, items: systemItems }) => ({
        provider,
        url,
        count: systemItems.length
      })),
      items,
      errors
    });
  } catch (error) {
    send(res, 500, { error: error.message || "Unable to load rental availability." });
  }
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  if (reqUrl.pathname === "/api/rentals") return rentalsApi(reqUrl, res);
  if (reqUrl.pathname === "/health") return send(res, 200, { ok: true });
  return readStatic(reqUrl.pathname, res);
});

server.listen(PORT, () => {
  console.log(`Street Rentals running at http://localhost:${PORT}`);
});
