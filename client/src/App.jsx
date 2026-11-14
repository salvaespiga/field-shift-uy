import { useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  useMapEvents,
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

const colorFor = (v) =>
  v >= 75 ? "var(--good)" : v >= 50 ? "var(--mid)" : "var(--bad)";

function ClickHandler({ onPick }) {
  useMapEvents({
    click: (e) =>
      onPick({ lat: +e.latlng.lat.toFixed(4), lon: +e.latlng.lng.toFixed(4) }),
  });
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
  const [prio, setPrio] = useState({ production: 5, soil: 5, water: 5 });
  const [scenario, setScenario] = useState("normal");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [slow, setSlow] = useState(false);

  async function runAnalysis(sc = scenario) {
    if (!point) return;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => setSlow(true), 4000); // aviso si el server está "despertando"
    try {
      const q = new URLSearchParams({
        lat: point.lat,
        lon: point.lon,
        scenario: sc,
        ...prio,
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
                  setPoint(p);
                  setData(null);
                }}
              />
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
          {error && <p className="error">Error: {error}</p>}
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
              Select a field and click “Analyze rotations” to see results.
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
