import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const env = loadEnv('', process.cwd());

const { VITE_HOST, VITE_PORT } = env;


export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  server: {
    host: VITE_HOST || 'localhost',
    port: Number(VITE_PORT) || 3000,
  },
});
