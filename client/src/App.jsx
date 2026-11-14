import { useState, useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  useMapEvents,
  useMap,
} from "react-leaflet";
import "./App.css";

// En desarrollo usa el proxy de Vite; en producción se configura VITE_API_URL
const API = import.meta.env.VITE_API_URL ?? "";

const SCENARIOS = [
  { id: "normal", label: "Normal years" },
  { id: "dry", label: "Dry year" },
  { id: "hot", label: "Hot year" },
];

const CRITERIA = [
  { key: "soilHealth", label: "Soil health" },
  { key: "erosion", label: "Erosion control" },
  { key: "water", label: "Water balance" },
  { key: "climate", label: "Climate resilience" },
  { key: "production", label: "Production" },
];

// Campos de ejemplo para probar la app con un clic
const EXAMPLES = [
  { name: "Paysandú", lat: -32.1756, lon: -57.085 },
  { name: "Soriano", lat: -33.5, lon: -57.8 },
  { name: "Cerro Largo", lat: -32.4912, lon: -54.0747 },
];

const colorFor = (v) =>
  v >= 75 ? "var(--good)" : v >= 50 ? "var(--mid)" : "var(--bad)";

// Contorno aproximado de Uruguay [lat, lon] (simplificado)
const UY_POLYGON = [
  [-30.19, -57.61],
  [-30.27, -57.07],
  [-30.35, -56.75],
  [-30.41, -56.46],
  [-30.58, -56.17],
  [-30.87, -55.95],
  [-30.9, -55.55],
  [-31.07, -55.25],
  [-31.3, -55.02],
  [-31.55, -54.6],
  [-31.87, -54.16],
  [-32.13, -53.9],
  [-32.57, -53.38],
  [-32.75, -53.3],
  [-33.1, -53.5],
  [-33.69, -53.46],
  [-33.9, -53.52],
  [-34.05, -53.54],
  [-34.4, -53.78],
  [-34.66, -54.16],
  [-34.84, -54.63],
  [-34.96, -54.95],
  [-34.87, -55.27],
  [-34.91, -56.18],
  [-34.8, -56.4],
  [-34.68, -56.73],
  [-34.47, -57.85],
  [-34.0, -58.3],
  [-33.88, -58.42],
  [-33.12, -58.31],
  [-32.32, -58.08],
  [-31.39, -57.97],
  [-30.79, -57.78],
];

// Algoritmo "ray casting": ¿el punto está dentro del polígono?
const inUruguay = (p) => {
  let inside = false;
  for (let i = 0, j = UY_POLYGON.length - 1; i < UY_POLYGON.length; j = i++) {
    const [yi, xi] = UY_POLYGON[i];
    const [yj, xj] = UY_POLYGON[j];
    const intersects =
      yi > p.lat !== yj > p.lat &&
      p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
};

function ClickHandler({ onPick }) {
  useMapEvents({
    click: (e) =>
      onPick({ lat: +e.latlng.lat.toFixed(4), lon: +e.latlng.lng.toFixed(4) }),
  });
  return null;
}

// Mueve el mapa hacia el campo de ejemplo elegido
function FlyTo({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lon], 8, { duration: 1 });
  }, [target, map]);
  return null;
}

function Slider({ label, value, onChange }) {
  return (
    <div className="slider">
      <label>
        {label} <strong>{value}</strong>
      </label>
      <input
        type="range"
        min="0"
        max="10"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function RotationCard({ r, rank }) {
  return (
    <div className={`card ${rank === 1 ? "best" : ""}`}>
      <div className="score">
        <span className="num" style={{ color: colorFor(r.finalScore) }}>
          {r.finalScore}
        </span>
        <span className="rank">{rank === 1 ? "Best match" : `#${rank}`}</span>
        {r.baselineScore != null && (
          <span
            className={`delta ${r.finalScore < r.baselineScore ? "down" : "up"}`}
          >
            {r.baselineScore} → {r.finalScore}
            <br />
            {r.finalScore < r.baselineScore ? "▼" : "▲"}{" "}
            {Math.abs(r.finalScore - r.baselineScore)}
          </span>
        )}
      </div>
      <div>
        <h3>{r.name}</h3>
        <p className="sequence">
          {r.sequence
            .map((yr, i) => `Year ${i + 1}: ${yr.join(" + ")}`)
            .join("  →  ")}
        </p>
        {CRITERIA.map((c) => (
          <div className="bar" key={c.key}>
            <span>{c.label}</span>
            <div className="track">
              <div
                className="fill"
                style={{
                  width: `${r.scores[c.key]}%`,
                  background: colorFor(r.scores[c.key]),
                }}
              />
            </div>
            <span>{r.scores[c.key]}</span>
          </div>
        ))}
        {r.warnings.length > 0 && (
          <ul className="warnings">
            {r.warnings.map((w) => (
              <li key={w}>⚠ {w}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [point, setPoint] = useState(null);
  const [flyTarget, setFlyTarget] = useState(null);
  const [prio, setPrio] = useState({ production: 5, soil: 5, water: 5 });
  const [scenario, setScenario] = useState("normal");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [slow, setSlow] = useState(false);

  // El error se cierra solo después de 6 segundos
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  // Si ya hay resultados y se mueven las prioridades, recalcula solo (con una pequeña espera)
  useEffect(() => {
    if (!data || !point) return;
    const t = setTimeout(() => runAnalysis(scenario, point, prio), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prio]);

  async function runAnalysis(sc = scenario, pt = point, pr = prio) {
    if (!pt) return;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => setSlow(true), 4000); // aviso si el server está "despertando"
    try {
      const q = new URLSearchParams({
        lat: pt.lat,
        lon: pt.lon,
        scenario: sc,
        ...pr,
      });
      const r = await fetch(`${API}/api/analyze?${q}`);
      const json = await r.json();
      if (!r.ok) throw new Error(json.detail || json.error || "Request failed");
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      clearTimeout(timer);
      setSlow(false);
      setLoading(false);
    }
  }

  function changeScenario(id) {
    setScenario(id);
    if (data) runAnalysis(id); // si ya hay resultados, recalcula al toque
  }

  function pickExample(ex) {
    const p = { lat: ex.lat, lon: ex.lon };
    setError(null);
    setPoint(p);
    setFlyTarget(p);
    setData(null);
    runAnalysis(scenario, p, prio);
  }

  return (
    <>
      <header className="header">
        <h1>RotaSat</h1>
        <p>
          Compare crop rotations for your field using NASA Earth observation
          data
        </p>
      </header>

      <main className="layout">
        <section>
          <div className="panel">
            <h2>1. Select your field</h2>
            <MapContainer center={[-32.8, -56.0]} zoom={6} className="map">
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <ClickHandler
                onPick={(p) => {
                  if (!inUruguay(p)) {
                    setError(
                      "RotaSat currently supports fields in Uruguay. Please select a point inside the country.",
                    );
                    return;
                  }
                  setError(null);
                  setPoint(p);
                  setData(null);
                }}
              />
              <FlyTo target={flyTarget} />
              {point && (
                <CircleMarker
                  center={[point.lat, point.lon]}
                  radius={9}
                  pathOptions={{ color: "#2f7d32", fillOpacity: 0.7 }}
                />
              )}
            </MapContainer>
            <p className="hint">
              {point
                ? `Selected: ${point.lat}, ${point.lon}`
                : "Click on the map to select your field."}
            </p>
            <div className="examples">
              <span>Try an example:</span>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.name}
                  onClick={() => pickExample(ex)}
                  disabled={loading}
                >
                  {ex.name}
                </button>
              ))}
            </div>
          </div>

          <div className="panel">
            <h2>2. Your priorities</h2>
            <Slider
              label="Production"
              value={prio.production}
              onChange={(v) => setPrio({ ...prio, production: v })}
            />
            <Slider
              label="Soil health"
              value={prio.soil}
              onChange={(v) => setPrio({ ...prio, soil: v })}
            />
            <Slider
              label="Water saving"
              value={prio.water}
              onChange={(v) => setPrio({ ...prio, water: v })}
            />
          </div>

          <div className="panel">
            <h2>3. Climate scenario</h2>
            <div className="scenarios">
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  className={scenario === s.id ? "active" : ""}
                  onClick={() => changeScenario(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <button
            className="analyze"
            disabled={!point || loading}
            onClick={() => runAnalysis()}
          >
            {loading ? "Analyzing NASA data..." : "Analyze rotations"}
          </button>
          {error && (
            <div className="toast" role="alert">
              <span>⚠ {error}</span>
              <button onClick={() => setError(null)} aria-label="Close">
                ×
              </button>
            </div>
          )}
          {slow && (
            <p className="hint">
              Waking up the server and fetching NASA data — the first request
              may take up to a minute…
            </p>
          )}
        </section>

        <section>
          {!data && !loading && (
            <div className="panel empty">
              Select a field (or try an example) and click “Analyze rotations”
              to see results.
            </div>
          )}

          {data && (
            <>
              <div className="panel">
                <h2>Your field</h2>
                <div className="site">
                  <div className="stat">
                    <span>Elevation</span>
                    <strong>{data.site.slope.elevation ?? "–"} m</strong>
                  </div>
                  <div className="stat">
                    <span>Slope</span>
                    <strong>{data.site.slope.slopePct}%</strong>
                  </div>
                  <div className="stat">
                    <span>Clay / Sand / Silt</span>
                    <strong>
                      {data.site.soil.clay} / {data.site.soil.sand} /{" "}
                      {data.site.soil.silt}%
                    </strong>
                  </div>
                  <div className="stat">
                    <span>Soil organic carbon</span>
                    <strong>{data.site.soil.soc} g/kg</strong>
                  </div>
                  {data.scenario.rootZoneMoisture != null && (
                    <div className="stat">
                      <span>Root-zone soil moisture</span>
                      <strong>
                        {Math.round(data.scenario.rootZoneMoisture * 100)}%
                        {data.scenario.id !== "normal" &&
                          data.scenario.normalRootZoneMoisture != null && (
                            <small>
                              {" "}
                              (normal:{" "}
                              {Math.round(
                                data.scenario.normalRootZoneMoisture * 100,
                              )}
                              %)
                            </small>
                          )}
                      </strong>
                    </div>
                  )}
                </div>
                <p className="hint">
                  Sources: NASA POWER (climate & soil moisture),{" "}
                  {data.site.slope.source}, {data.site.soil.source}.
                </p>
              </div>

              <p className="scenario-label">
                Scenario: <strong>{data.scenario.label}</strong>
              </p>
              {data.scenario.id !== "normal" &&
                (() => {
                  const best = data.results[0];
                  const worst = data.results[data.results.length - 1];
                  return (
                    <div className="panel resilient">
                      🛡 Best option under this scenario:{" "}
                      <strong>{best.name}</strong> (score {best.finalScore}).
                      <br />⚠ Most vulnerable: <strong>
                        {worst.name}
                      </strong>{" "}
                      (score {worst.finalScore}).
                    </div>
                  );
                })()}
              {data.results.map((r, i) => (
                <RotationCard key={r.id} r={r} rank={i + 1} />
              ))}
            </>
          )}
        </section>
      </main>

      <footer className="footer">
        Built for NASA Space Apps Challenge 2026 – “Field Shift”. Not affiliated
        with or endorsed by NASA. Scores are simplified indicators for
        exploration, not agronomic prescriptions.
      </footer>
    </>
  );
}
