import express from "express";
import cors from "cors";
import { getClimateYears, getSlope, getSoil } from "./services.js";
import { analyze } from "./scoring.js";

const app = express();
app.use(cors());
const PORT = 3001;

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Clima histórico de NASA POWER para un punto
app.get("/api/climate", async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon)
    return res.status(400).json({ error: "lat y lon requeridos" });

  const url =
    `https://power.larc.nasa.gov/api/temporal/monthly/point` +
    `?parameters=T2M,T2M_MAX,T2M_MIN,PRECTOTCORR&community=AG` +
    `&latitude=${lat}&longitude=${lon}&start=2005&end=2024&format=JSON`;

  try {
    const r = await fetch(url);
    const data = await r.json();
    const p = data.properties.parameter;

    // Promedio por mes (1-12) de todos los años, ignorando el "mes 13" (anual) y valores -999
    const monthly = (param) => {
      const sums = Array(12).fill(0),
        counts = Array(12).fill(0);
      for (const [key, val] of Object.entries(p[param])) {
        const m = Number(key.slice(4));
        if (m >= 1 && m <= 12 && val !== -999) {
          sums[m - 1] += val;
          counts[m - 1]++;
        }
      }
      return sums.map((s, i) => +(s / counts[i]).toFixed(2));
    };

    res.json({
      source: "NASA POWER (monthly, 2005-2024)",
      lat: Number(lat),
      lon: Number(lon),
      tmax: monthly("T2M_MAX"), // °C máxima extrema del mes
      tmin: monthly("T2M_MIN"), // °C mínima extrema del mes
      tmean: monthly("T2M"), // °C promedio
      rainMmPerDay: monthly("PRECTOTCORR"), // mm/día
      raw: p, // lo guardamos para el stress test
    });
  } catch (e) {
    res
      .status(500)
      .json({ error: "Error consultando NASA POWER", detail: e.message });
  }
});

// Caché simple para no volver a pedir los datos al cambiar prioridades o escenario
const cache = new Map();
async function getSiteData(lat, lon) {
  const key = `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
  if (cache.has(key)) return cache.get(key);
  const [years, slope, soil] = await Promise.all([
    getClimateYears(lat, lon),
    getSlope(lat, lon),
    getSoil(lat, lon),
  ]);
  const site = { years, slope, soil };
  cache.set(key, site);
  return site;
}

// Análisis de rotaciones: /api/analyze?lat=..&lon=..&production=5&soil=5&water=5&scenario=normal|dry|hot
app.get("/api/analyze", async (req, res) => {
  const { lat, lon, scenario = "normal" } = req.query;
  if (!lat || !lon)
    return res.status(400).json({ error: "lat and lon are required" });
  const priorities = {
    production: Number(req.query.production ?? 5),
    soil: Number(req.query.soil ?? 5),
    water: Number(req.query.water ?? 5),
  };
  try {
    const site = await getSiteData(lat, lon);
    const out = analyze({
      years: site.years,
      slopePct: site.slope.slopePct,
      soil: site.soil,
      priorities,
      scenario,
    });
    res.json({
      location: { lat: Number(lat), lon: Number(lon) },
      site: { slope: site.slope, soil: site.soil },
      priorities,
      ...out,
    });
  } catch (e) {
    res.status(500).json({ error: "Analysis failed", detail: e.message });
  }
});

app.listen(PORT, () => console.log(`Server en http://localhost:${PORT}`));
