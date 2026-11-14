// Servicios de datos: NASA POWER (clima), SRTM (pendiente), SoilGrids (suelo)

// Clima mensual por año desde NASA POWER
export async function getClimateYears(lat, lon) {
  const url =
    `https://power.larc.nasa.gov/api/temporal/monthly/point` +
    `?parameters=T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,GWETROOT&community=AG` +
    `&latitude=${lat}&longitude=${lon}&start=2005&end=2024&format=JSON`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`NASA POWER error ${r.status}`);
  const p = (await r.json()).properties.parameter;

  // Reorganiza a: [{ year: 2005, T2M: [12], T2M_MAX: [12], T2M_MIN: [12], PRECTOTCORR: [12] }, ...]
  const years = {};
  for (const [param, series] of Object.entries(p)) {
    for (const [key, val] of Object.entries(series)) {
      const y = Number(key.slice(0, 4));
      const m = Number(key.slice(4));
      if (m < 1 || m > 12) continue; // ignora el "mes 13" (anual)
      years[y] ??= { year: y };
      years[y][param] ??= Array(12).fill(null);
      years[y][param][m - 1] = val === -999 ? null : val;
    }
  }
  return Object.values(years).sort((a, b) => a.year - b.year);
}

// Pendiente del terreno con SRTM 30 m (NASA), vía OpenTopoData
export async function getSlope(lat, lon) {
  lat = Number(lat);
  lon = Number(lon);
  const d = 0.001; // ~100 m
  const pts = [
    [lat, lon],
    [lat + d, lon],
    [lat - d, lon],
    [lat, lon + d],
    [lat, lon - d],
  ];
  try {
    const url = `https://api.opentopodata.org/v1/srtm30m?locations=${pts.map((p) => p.join(",")).join("|")}`;
    const r = await fetch(url);
    const e = (await r.json()).results.map((x) => x.elevation);
    if (e.some((v) => v == null)) throw new Error("No elevation data");
    const dy = 111320 * d;
    const dx = 111320 * Math.cos((lat * Math.PI) / 180) * d;
    const gy = (e[1] - e[2]) / (2 * dy);
    const gx = (e[3] - e[4]) / (2 * dx);
    return {
      elevation: e[0],
      slopePct: +(Math.sqrt(gx * gx + gy * gy) * 100).toFixed(2),
      source: "NASA SRTM 30 m (via OpenTopoData)",
    };
  } catch (err) {
    return {
      elevation: null,
      slopePct: 2,
      fallback: true,
      source: "Default value (SRTM unavailable)",
    };
  }
}

// Suelo (0-30 cm) desde SoilGrids (ISRIC)
export async function getSoil(lat, lon) {
  const url =
    `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lon}&lat=${lat}` +
    `&property=clay&property=sand&property=silt&property=soc` +
    `&depth=0-5cm&depth=5-15cm&depth=15-30cm&value=mean`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`SoilGrids error ${r.status}`);
    const layers = (await r.json()).properties.layers;
    const out = {};
    for (const l of layers) {
      const vals = l.depths.map((d) => d.values.mean).filter((v) => v != null);
      if (!vals.length) throw new Error("No soil data");
      out[l.name] = +(
        vals.reduce((a, b) => a + b, 0) /
        vals.length /
        l.unit_measure.d_factor
      ).toFixed(1);
    }
    // clay/sand/silt en %, soc en g/kg
    return { ...out, source: "ISRIC SoilGrids 2.0" };
  } catch (err) {
    // Valores típicos de suelos agrícolas del litoral uruguayo
    return {
      clay: 30,
      sand: 25,
      silt: 45,
      soc: 20,
      fallback: true,
      source: "Default typical values (SoilGrids unavailable)",
    };
  }
}
