import express from "express";
import cors from "cors";

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

app.listen(PORT, () => console.log(`Server en http://localhost:${PORT}`));
