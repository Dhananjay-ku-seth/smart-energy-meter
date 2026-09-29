# Smart Energy Meter Dashboard

**Toggle household appliances live and watch real vs apparent power, power factor, voltage sag/swell, frequency deviation, breaker-trip logic, and kWh billing update in real time.**

Part of the [LabBench](https://labbench-hub.vercel.app/) suite of interactive engineering tools.

**Live demo:** https://smart-energy-meter-pink.vercel.app/

## What it does

Simulates a single-phase household service (230V/50Hz, India) fed by 7 toggleable appliances:

- **Real vs apparent power** — each appliance has a rated wattage and power factor; real power `P = ΣW`, apparent power `S = ΣW/pf`, and overall power factor `P/S` are computed from whichever appliances are actually on, not hard-coded.
- **Current and voltage sag** — current `I = S/V`, and the terminal voltage sags under load through a simplified source impedance (`V = 230 − I·Rsource`), the same effect real feeders exhibit under heavy draw.
- **Breaker-trip logic** — the modeled 20A main breaker trips if current stays over its rating for more than 2 seconds, cutting all load until manually reset — real overcurrent-protection behavior, not just a warning label.
- **Grid disturbance buttons** — manually trigger a voltage sag, a voltage swell, or a frequency dip (simulated generator strain) to see how the meter's alerts and charts respond, with an exponential frequency-recovery curve once the event ends.
- **Live kWh billing** — energy is integrated from actual instantaneous power (`kWh += (W/1000)·(dt/3600)`), multiplied by a ₹7.5/unit tariff for a running estimated bill.
- Hover either chart to read the exact power/voltage at that moment, export either as PNG, and watch
  the dashboard visibly flicker the instant the breaker trips.

## LabBench Pro

Sign in to save and reload full appliance load profiles, part of the same optional ₹29/mo LabBench Pro subscription as the rest of the suite. Upgrade from [Logic Circuit Simulator](https://logic-circuit-sim.vercel.app/), which hosts the checkout for all tools.

## Tech

React + TypeScript + Vite. The power/current/voltage/frequency/breaker/billing model (`src/meter.ts`) is written from scratch — no MQTT broker or Flask backend needed for the demo, everything runs client-side. Auth/save-load via Supabase (Postgres + RLS).

## Run locally
```sh
npm install
npm run dev
```

_Built by Dhananjay Kumar Seth — part of [LabBench](https://labbench-hub.vercel.app/)._
