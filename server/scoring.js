// Motor de puntaje de rotaciones.
// Parámetros de cultivos indicativos (FAO-56 y literatura regional), simplificados para el MVP.

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export const CROPS = {
  soy1: {
    name: "Soybean (1st)",
    months: [11, 12, 1, 2, 3],
    waterNeed: 500,
    residue: 0.3,
    grass: false,
    harvest: true,
    flowering: [1, 2],
    heatMax: 37,
    frostSensitive: true,
  },
  soy2: {
    name: "Soybean (2nd)",
    months: [12, 1, 2, 3, 4],
    waterNeed: 450,
    residue: 0.3,
    grass: false,
    harvest: true,
    flowering: [2, 3],
    heatMax: 37,
    frostSensitive: true,
  },
  wheat: {
    name: "Wheat",
    months: [6, 7, 8, 9, 10, 11],
    waterNeed: 450,
    residue: 0.8,
    grass: true,
    harvest: true,
    flowering: [10],
    heatMax: 32,
    frostSensitive: false,
  },
  maize: {
    name: "Maize",
    months: [10, 11, 12, 1, 2, 3],
    waterNeed: 600,
    residue: 1.0,
    grass: true,
    harvest: true,
    flowering: [12, 1],
    heatMax: 37,
    frostSensitive: true,
  },
  cover: {
    name: "Cover crop (oats/ryegrass)",
    months: [5, 6, 7, 8, 9],
    waterNeed: 250,
    residue: 0.6,
    grass: true,
    harvest: false,
    flowering: [],
    heatMax: 99,
    frostSensitive: false,
  },
  pasture: {
    name: "Perennial pasture",
    months: ALL_MONTHS,
    waterNeed: 700,
    residue: 1.5,
    grass: true,
    harvest: false,
    flowering: [],
    heatMax: 99,
    frostSensitive: false,
  },
};

export const ROTATIONS = [
  { id: "soy-mono", name: "Continuous soybean", years: [["soy1"]] },
  { id: "wheat-soy", name: "Wheat / 2nd soybean", years: [["wheat", "soy2"]] },
  {
    id: "wheat-soy-maize",
    name: "Wheat-Soybean → Cover crop-Maize",
    years: [
      ["wheat", "soy2"],
      ["cover", "maize"],
    ],
  },
  {
    id: "crop-pasture",
    name: "Crop-pasture (3 yrs crops + 3 yrs pasture)",
    years: [
      ["wheat", "soy2"],
      ["wheat", "soy2"],
      ["wheat", "soy2"],
      ["pasture"],
      ["pasture"],
      ["pasture"],
    ],
  },
];

const mean = (a) => {
  const v = a.filter((x) => x != null && !Number.isNaN(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0;
};
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const annualRain = (y) =>
  y.PRECTOTCORR.reduce((s, v, i) => s + (v ?? 0) * DAYS[i], 0);

// Escenarios: normal = promedio de todos los años; dry = año más seco; hot = año más caluroso
export function buildScenario(years, scenario = "normal") {
  if (scenario === "dry") {
    const y = years.reduce((a, b) => (annualRain(b) < annualRain(a) ? b : a));
    return {
      id: "dry",
      label: `Driest year on record (${y.year}, ${Math.round(annualRain(y))} mm)`,
      years: [y],
    };
  }
  if (scenario === "hot") {
    const y = years.reduce((a, b) => (mean(b.T2M) > mean(a.T2M) ? b : a));
    return {
      id: "hot",
      label: `Hottest year on record (${y.year}, mean ${mean(y.T2M).toFixed(1)} °C)`,
      years: [y],
    };
  }
  return {
    id: "normal",
    label: `Average ${years[0].year}-${years[years.length - 1].year}`,
    years,
  };
}

// Índice simplificado de erodibilidad (inspirado en el factor K de USLE): más limo y menos carbono => más erosionable
function erodibility(soil) {
  return clamp(1 + (soil.silt - 40) / 100 - (soil.soc - 15) / 100, 0.6, 1.4);
}

function scoreRotation(rot, scen, slopePct, soil) {
  const yrs = scen.years;
  const instances = rot.years.flat().map((id) => CROPS[id]);
  const freq = (fn) => mean(yrs.map((y) => (fn(y) ? 1 : 0)));

  // 1) Salud del suelo: cobertura, rastrojo, gramíneas y pasturas perennes
  const cover = mean(
    rot.years.map(
      (ids) => new Set(ids.flatMap((id) => CROPS[id].months)).size / 12,
    ),
  );
  const resid = clamp(
    mean(
      rot.years.map((ids) => ids.reduce((s, id) => s + CROPS[id].residue, 0)),
    ) / 1.5,
  );
  const grassShare = instances.filter((c) => c.grass).length / instances.length;
  const hasPerennial = instances.some((c) => c.months.length === 12);
  const soilHealth =
    100 *
    clamp(
      0.45 * cover + 0.35 * resid + 0.2 * grassShare + (hasPerennial ? 0.1 : 0),
    );

  // 2) Agua: lluvia en la estación de cada cultivo vs. lo que necesita
  // Simplificación: los meses de cada cultivo se toman del mismo año calendario
  const rainSeason = (c) =>
    mean(
      yrs.map((y) =>
        c.months.reduce(
          (s, m) => s + (y.PRECTOTCORR[m - 1] ?? 0) * DAYS[m - 1],
          0,
        ),
      ),
    );
  const supply = mean(instances.map((c) => clamp(rainSeason(c) / c.waterNeed)));
  const demandPerYear = mean(
    rot.years.map((ids) => ids.reduce((s, id) => s + CROPS[id].waterNeed, 0)),
  );
  const water = 100 * (0.7 * supply + 0.3 * clamp(1 - demandPerYear / 1400));

  // 3) Erosión (inspirado en RUSLE: lluvia × pendiente × suelo × cobertura)
  const rainF = clamp(mean(yrs.map(annualRain)) / 1400, 0, 1.3);
  const slopeF = 0.2 + slopePct / 3;
  const coverF = (1 - cover) * 0.7 + (1 - resid) * 0.3;
  const erosion = 100 * clamp(1 - rainF * slopeF * erodibility(soil) * coverF);

  // 4) Riesgo climático: calor extremo en floración y heladas en cultivos sensibles
  const climateRisks = instances.map((c) => {
    const heat = c.flowering.length
      ? freq((y) =>
          c.flowering.some((m) => (y.T2M_MAX[m - 1] ?? 0) >= c.heatMax),
        )
      : 0;
    const frost = c.frostSensitive
      ? freq((y) => c.months.some((m) => (y.T2M_MIN[m - 1] ?? 99) < 0))
      : 0;
    return { crop: c, heat, frost, risk: clamp(0.6 * heat + 0.4 * frost) };
  });
  const climate = 100 * (1 - mean(climateRisks.map((r) => r.risk)));

  // 5) Producción: cosechas de grano por año, ajustadas por disponibilidad de agua
  const harvests = mean(
    rot.years.map((ids) => ids.filter((id) => CROPS[id].harvest).length),
  );
  const production = 100 * clamp(harvests / 2) * (0.5 + 0.5 * supply);

  // Alertas explicables
  const warnings = [];
  if (erosion < 50)
    warnings.push(
      `High erosion risk: ${slopePct}% slope with soil uncovered ~${Math.round((1 - cover) * 12)} months/year.`,
    );
  if (supply < 0.7)
    warnings.push(
      `Rainfall covers only ${Math.round(supply * 100)}% of crop water needs in this scenario.`,
    );
  const when = (f) =>
    yrs.length === 1
      ? `in ${yrs[0].year}`
      : `in ${Math.round(f * 100)}% of years`;
  for (const r of climateRisks) {
    if (r.heat >= 0.5)
      warnings.push(
        `At least one day ≥${r.crop.heatMax} °C during ${r.crop.name} flowering ${when(r.heat)}.`,
      );
    if (r.frost >= 0.3)
      warnings.push(`Frost risk for ${r.crop.name} ${when(r.frost)}.`);
  }
  if (grassShare === 0)
    warnings.push(
      "No grasses in the rotation: low residue, soil organic matter likely to decline.",
    );

  return {
    id: rot.id,
    name: rot.name,
    sequence: rot.years.map((ids) => ids.map((id) => CROPS[id].name)),
    scores: {
      soilHealth: Math.round(soilHealth),
      erosion: Math.round(erosion),
      water: Math.round(water),
      climate: Math.round(climate),
      production: Math.round(production),
    },
    warnings: [...new Set(warnings)],
  };
}

export function analyze({ years, slopePct, soil, priorities, scenario }) {
  const scen = buildScenario(years, scenario);
  const w = {
    production: priorities.production,
    soil: priorities.soil,
    water: priorities.water,
    climate: 3,
  };
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;

  const results = ROTATIONS.map((rot) => {
    const r = scoreRotation(rot, scen, slopePct, soil);
    const s = r.scores;
    const final =
      (w.production * s.production +
        w.soil * (0.6 * s.soilHealth + 0.4 * s.erosion) +
        w.water * s.water +
        w.climate * s.climate) /
      total;
    return { ...r, finalScore: Math.round(final) };
  }).sort((a, b) => b.finalScore - a.finalScore);

  // Si es un escenario de estrés, calculamos también el normal para comparar
  let baseline = null;
  if (scen.id !== "normal") {
    const normal = analyze({
      years,
      slopePct,
      soil,
      priorities,
      scenario: "normal",
    });
    baseline = Object.fromEntries(
      normal.results.map((r) => [r.id, r.finalScore]),
    );
  }

  return {
    scenario: { id: scen.id, label: scen.label },
    results: results.map((r) => ({
      ...r,
      baselineScore: baseline ? baseline[r.id] : null,
    })),
  };
}
