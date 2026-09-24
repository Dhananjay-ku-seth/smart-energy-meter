import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_APPLIANCES, NOMINAL_VOLTAGE, NOMINAL_FREQ, BREAKER_AMPS, TARIFF_PER_KWH,
  initMeter, stepMeter, type Appliance, type GridEvent, type MeterState,
} from "./meter";
import AuthPanel from "./AuthPanel";
import SavePreset, { type EnergyConfig } from "./SavePreset";
import { useProfile } from "./useProfile";

const SPEEDS = [1, 60, 3600];

type Sample = { power: number; voltage: number };
type LogEntry = { t: number; text: string; level: "info" | "warn" | "critical" };

function fmtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function voltageColor(v: number): string {
  if (v < 1) return "#8a9182";
  if (v < 200 || v > 250) return "#f43f5e";
  if (v < 215 || v > 245) return "#eab308";
  return "#2dd4bf";
}
function freqColor(f: number): string {
  if (Math.abs(f - NOMINAL_FREQ) > 1) return "#f43f5e";
  if (Math.abs(f - NOMINAL_FREQ) > 0.3) return "#eab308";
  return "#2dd4bf";
}

function drawChart(canvas: HTMLCanvasElement | null, samples: Sample[], key: "power" | "voltage", min: number, max: number, color: string) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#1a2422";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (h / 4) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  if (samples.length < 2) return;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  samples.forEach((s, i) => {
    const v = key === "power" ? s.power : s.voltage;
    const x = (i / (samples.length - 1)) * w;
    const t = Math.min(1, Math.max(0, (v - min) / (max - min)));
    const y = h - t * h;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

export default function App() {
  const { isPro } = useProfile();
  const [appliances, setAppliances] = useState<Appliance[]>(() => DEFAULT_APPLIANCES.map((a) => ({ ...a })));
  const [meter, setMeter] = useState<MeterState>(() => initMeter());
  // Latest meter state, readable inside the animation loop so updates stay free of side effects.
  const meterRef = useRef<MeterState>(meter);
  meterRef.current = meter;
  const [event, setEvent] = useState<GridEvent>(null);
  const [speed, setSpeed] = useState(60);
  const [running, setRunning] = useState(true);
  const [live, setLive] = useState({ voltage: NOMINAL_VOLTAGE, currentA: 0, realW: 0, apparentVa: 0, pf: 1 });
  const [log, setLog] = useState<LogEntry[]>([]);

  const historyRef = useRef<Sample[]>([]);
  const [, forceTick] = useState(0);
  const lastFrameRef = useRef<number | null>(null);
  const lastSampleRef = useRef(0);
  const powerCanvasRef = useRef<HTMLCanvasElement>(null);
  const voltageCanvasRef = useRef<HTMLCanvasElement>(null);

  function pushLog(text: string, level: LogEntry["level"], t: number) {
    setLog((l) => [{ t, text, level }, ...l].slice(0, 12));
  }

  useEffect(() => {
    if (!running) { lastFrameRef.current = null; return; }
    let raf = 0;
    const loop = (now: number) => {
      if (lastFrameRef.current === null) lastFrameRef.current = now;
      const realDeltaMs = Math.min(250, now - lastFrameRef.current);
      lastFrameRef.current = now;
      const dt = (realDeltaMs / 1000) * speed;

      const result = stepMeter(meterRef.current, appliances, event, dt);
      meterRef.current = result.next;
      setMeter(result.next);
      setLive({ voltage: result.voltage, currentA: result.currentA, realW: result.realW, apparentVa: result.apparentVa, pf: result.pf });
      if (result.tripNow) pushLog(`Breaker tripped — ${result.causeCurrentA.toFixed(1)}A exceeds ${BREAKER_AMPS}A rating`, "critical", result.next.time);
      if (now - lastSampleRef.current > 150) {
        lastSampleRef.current = now;
        historyRef.current = [...historyRef.current, { power: result.realW, voltage: result.voltage }].slice(-400);
      }
      forceTick((n) => n + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, appliances, event, speed]);

  useEffect(() => {
    drawChart(powerCanvasRef.current, historyRef.current, "power", 0, 6500, "#2dd4bf");
    drawChart(voltageCanvasRef.current, historyRef.current, "voltage", 150, 270, voltageColor(live.voltage));
  });

  function toggleAppliance(id: string) {
    setAppliances((as) => as.map((a) => a.id === id ? { ...a, on: !a.on } : a));
  }

  function triggerEvent(kind: "sag" | "swell" | "freqdip") {
    const duration = kind === "freqdip" ? 8 : 5;
    setEvent({ kind, until: meter.time + duration });
    pushLog(
      kind === "sag" ? "Voltage sag event triggered (grid disturbance)" :
      kind === "swell" ? "Voltage swell event triggered (grid disturbance)" :
      "Frequency dip triggered (generator strain)",
      "warn", meter.time,
    );
  }

  function resetBreaker() {
    const reset = { ...meterRef.current, tripped: false, overCurrentSince: null };
    meterRef.current = reset;
    setMeter(reset);
    pushLog("Breaker manually reset", "info", meter.time);
  }

  const alerts: { text: string; level: "warn" | "critical" }[] = [];
  if (meter.tripped) alerts.push({ text: `Breaker tripped — overload (current exceeded ${BREAKER_AMPS}A). Reset to restore power.`, level: "critical" });
  if (!meter.tripped && live.voltage > 0 && (live.voltage < 200 || live.voltage > 250)) alerts.push({ text: `Voltage out of normal band: ${live.voltage.toFixed(0)}V`, level: "warn" });
  if (!meter.tripped && Math.abs(meter.freq - NOMINAL_FREQ) > 0.3) alerts.push({ text: `Frequency deviation: ${meter.freq.toFixed(2)}Hz`, level: "warn" });
  if (!meter.tripped && live.pf < 0.85 && live.apparentVa > 0) alerts.push({ text: `Low power factor (${live.pf.toFixed(2)}) — inductive loads dominant`, level: "warn" });

  const cost = meter.energyKwh * TARIFF_PER_KWH;

  const config: EnergyConfig = useMemo(() => ({ appliances }), [appliances]);
  function loadConfig(c: EnergyConfig) {
    setAppliances(c.appliances);
  }

  return (
    <div className="app">
      <header>
        <div className="mark">⚡</div>
        <div>
          <h1>SMART ENERGY METER DASHBOARD</h1>
          <p>Real vs apparent power · power factor · voltage sag/swell · frequency deviation · breaker-trip logic · live kWh billing</p>
        </div>
        <div className="badges">
          <AuthPanel />
          <div className="badge-links">
            <a className="labbench-badge" href="https://labbench-hub.vercel.app/" target="_blank" rel="noopener noreferrer">⚡ LabBench</a>
            <a className="src" href="https://dhananjay-kumar-seth.vercel.app/" target="_blank" rel="noopener noreferrer">ECE Portfolio · Dhananjay Seth</a>
          </div>
        </div>
      </header>

      <div className="savebar">
        <SavePreset config={config} onLoad={loadConfig} />
      </div>

      {alerts.length > 0 && (
        <div className="alerts">
          {alerts.map((a, i) => (
            <div key={i} className={"alert " + a.level}>{a.level === "critical" ? "⛔" : "⚠️"} {a.text}</div>
          ))}
        </div>
      )}

      <div className="panel">
        <div className="row">
          <button className={"ghost" + (running ? " on" : "")} onClick={() => setRunning((r) => !r)}>
            {running ? "⏸ Pause" : "▶ Run"}
          </button>
          <div className="seg small">
            {SPEEDS.map((s) => (
              <button key={s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)}>{s}x</button>
            ))}
          </div>
          <button className="ghost" onClick={() => triggerEvent("sag")}>📉 Simulate Sag</button>
          <button className="ghost" onClick={() => triggerEvent("swell")}>📈 Simulate Swell</button>
          <button className="ghost" onClick={() => triggerEvent("freqdip")}>〰️ Simulate Freq Dip</button>
          {meter.tripped && <button className="ghost on" onClick={resetBreaker}>🔌 Reset Breaker</button>}
          <span className="hint-line" style={{ margin: 0 }}>Sim time: {fmtTime(meter.time)}</span>
        </div>

        <div className="stats-row">
          <div className="stat">
            <span className="stat-label">Voltage</span>
            <span className="stat-val" style={{ color: voltageColor(live.voltage) }}>{live.voltage.toFixed(0)} V</span>
          </div>
          <div className="stat">
            <span className="stat-label">Frequency</span>
            <span className="stat-val" style={{ color: freqColor(meter.freq) }}>{meter.freq.toFixed(2)} Hz</span>
          </div>
          <div className="stat">
            <span className="stat-label">Real Power</span>
            <span className="stat-val" style={{ color: "#2dd4bf" }}>{(live.realW / 1000).toFixed(2)} kW</span>
          </div>
          <div className="stat">
            <span className="stat-label">Apparent Power</span>
            <span className="stat-val">{(live.apparentVa / 1000).toFixed(2)} kVA</span>
          </div>
          <div className="stat">
            <span className="stat-label">Power Factor</span>
            <span className="stat-val" style={{ color: live.pf < 0.85 && live.apparentVa > 0 ? "#eab308" : "#e4e8de" }}>{live.pf.toFixed(2)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Current</span>
            <span className="stat-val" style={{ color: live.currentA > BREAKER_AMPS ? "#f43f5e" : "#e4e8de" }}>{live.currentA.toFixed(1)} A</span>
          </div>
          <div className="stat">
            <span className="stat-label">Energy</span>
            <span className="stat-val">{meter.energyKwh.toFixed(3)} kWh</span>
          </div>
          <div className="stat">
            <span className="stat-label">Est. Bill</span>
            <span className="stat-val" style={{ color: "#a78bfa" }}>₹{cost.toFixed(2)}</span>
          </div>
        </div>

        <p className="desc" style={{ marginTop: 16 }}>Appliances — toggle to change load. Breaker rated {BREAKER_AMPS}A at ~{NOMINAL_VOLTAGE}V.</p>
        <div className="appliance-grid">
          {appliances.map((a) => (
            <button key={a.id} className={"appliance-card" + (a.on ? " on" : "")} onClick={() => toggleAppliance(a.id)}>
              <span className="appliance-name">{a.name}</span>
              <span className="appliance-watts">{a.watts}W · pf {a.pf.toFixed(2)}</span>
            </button>
          ))}
        </div>

        <div className="charts-grid">
          <div className="chart-box">
            <span className="chart-label">Real Power (0–6500W)</span>
            <canvas ref={powerCanvasRef} width={460} height={110} />
          </div>
          <div className="chart-box">
            <span className="chart-label">Voltage (150–270V)</span>
            <canvas ref={voltageCanvasRef} width={460} height={110} />
          </div>
        </div>

        {log.length > 0 && (
          <div className="log-box">
            <span className="chart-label">Event Log</span>
            {log.map((entry, i) => (
              <div key={i} className={"log-row " + entry.level}>
                <span className="log-time">{fmtTime(entry.t)}</span>
                <span>{entry.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {isPro ? (
        <div className="pro-strip pro-tools">
          <span>Pro: save/load full appliance load profiles via 💾 above.</span>
        </div>
      ) : (
        <div className="pro-strip">
          <span>🔒 Save/load appliance load profiles — <b>LabBench Pro</b> feature.</span>
          <a href="https://logic-circuit-sim.vercel.app/" target="_blank" rel="noopener noreferrer">Upgrade to Pro →</a>
        </div>
      )}

      <footer>Real/apparent power, source-impedance voltage sag, breaker-trip current logic, and kWh billing — computed from scratch, no MQTT/Flask backend needed for the demo.</footer>
    </div>
  );
}
