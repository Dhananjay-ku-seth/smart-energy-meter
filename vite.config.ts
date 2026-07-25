import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Smart Energy Meter Dashboard (LabBench, portfolio demo)
export default defineConfig({
  server: { host: "::", port: 5190 },
  plugins: [react()],
});
