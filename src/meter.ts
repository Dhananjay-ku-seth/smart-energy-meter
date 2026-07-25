export type Appliance = { id: string; name: string; watts: number; pf: number; on: boolean };

export const DEFAULT_APPLIANCES: Appliance[] = [
  { id: "fridge", name: "Refrigerator", watts: 150, pf: 0.85, on: true },
  { id: "lights", name: "Lighting", watts: 200, pf: 0.95, on: true },
  { id: "tv", name: "TV & Electronics", watts: 150, pf: 0.90, on: true },
  { id: "ac", name: "Air Conditioner", watts: 1500, pf: 0.90, on: false },
  { id: "geyser", name: "Water Heater", watts: 2000, pf: 0.98, on: false },
  { id: "washer", name: "Washing Machine", watts: 800, pf: 0.80, on: false },
  { id: "microwave", name: "Microwave", watts: 1200, pf: 0.95, on: false },
];

export const NOMINAL_VOLTAGE = 230; // V, single-phase (India)
export const NOMINAL_FREQ = 50; // Hz
export const SOURCE_R = 0.35; // ohm, simplified feeder/source impedance
export const BREAKER_AMPS = 20; // A, main breaker rating
export const TARIFF_PER_KWH = 7.5; // ₹/unit

export type GridEvent = { kind: "sag" | "swell" | "freqdip"; until: number } | null;

export type MeterState = {
  time: number;
  energyKwh: number;
  tripped: boolean;
  overCurrentSince: number | null; // sim-time when current first exceeded breaker rating, or null
  freq: number; // slowly-tracked instantaneous frequency (for smoothing the freqdip recovery)
};

export function initMeter(): MeterState {
  return { time: 0, energyKwh: 0, tripped: false, overCurrentSince: null, freq: NOMINAL_FREQ };
}

// Real power (W), apparent power (VA), and overall power factor from the appliances currently on.
export function computePower(appliances: Appliance[]): { realW: number; apparentVa: number; pf: number } {
  const on = appliances.filter((a) => a.on);
  const realW = on.reduce((s, a) => s + a.watts, 0);
  const apparentVa = on.reduce((s, a) => s + a.watts / a.pf, 0);
  const pf = apparentVa > 0 ? realW / apparentVa : 1;
  return { realW, apparentVa, pf };
}

// Terminal voltage sags with load current through the source impedance (V = Vnominal - I*Rsource),
// then a manually-triggered grid event (sag/swell) is overlaid on top.
export function computeVoltage(currentA: number, event: GridEvent, simTime: number): number {
  let v = NOMINAL_VOLTAGE - currentA * SOURCE_R;
  if (event?.kind === "sag" && simTime < event.until) v = Math.min(v, 180);
  if (event?.kind === "swell" && simTime < event.until) v = Math.max(v, 262);
  return v;
}

// Frequency: a normal grid holds close to nominal; a manually-triggered "generator strain" event
// dips it, then it recovers over a few seconds once the event ends (simple exponential recovery).
export function stepFrequency(prevFreq: number, event: GridEvent, simTime: number, dtSeconds: number): number {
  const target = (event?.kind === "freqdip" && simTime < event.until) ? 48.5 : NOMINAL_FREQ;
  const recoveryRate = 0.6; // per second
  return prevFreq + (target - prevFreq) * Math.min(1, recoveryRate * dtSeconds);
}

export function currentFromApparent(apparentVa: number, voltage: number): number {
  return voltage > 1 ? apparentVa / voltage : 0;
}

export function stepMeter(
  state: MeterState,
  appliances: Appliance[],
  event: GridEvent,
  dtSeconds: number,
): { next: MeterState; voltage: number; currentA: number; realW: number; apparentVa: number; pf: number; tripNow: boolean; causeCurrentA: number } {
  const { realW, apparentVa, pf } = computePower(appliances);
  const voltageEstimate = computeVoltage(0, event, state.time); // pre-estimate ignoring self-drop for current calc
  const currentA = currentFromApparent(apparentVa, voltageEstimate);
  const voltage = computeVoltage(currentA, event, state.time);
  const freq = stepFrequency(state.freq, event, state.time, dtSeconds);

  let overCurrentSince = state.overCurrentSince;
  let tripped = state.tripped;
  let tripNow = false;

  if (!tripped) {
    if (currentA > BREAKER_AMPS) {
      if (overCurrentSince === null) overCurrentSince = state.time;
      else if (state.time - overCurrentSince > 2) {
        tripped = true;
        tripNow = true;
      }
    } else {
      overCurrentSince = null;
    }
  }

  const activePowerW = tripped ? 0 : realW;
  const energyKwh = state.energyKwh + (activePowerW / 1000) * (dtSeconds / 3600);

  return {
    next: { time: state.time + dtSeconds, energyKwh, tripped, overCurrentSince, freq },
    voltage: tripped ? 0 : voltage,
    currentA: tripped ? 0 : currentA,
    realW: activePowerW,
    apparentVa: tripped ? 0 : apparentVa,
    pf,
    tripNow,
    causeCurrentA: currentA, // the actual current that caused/would cause a trip, unzeroed, for logging
  };
}
