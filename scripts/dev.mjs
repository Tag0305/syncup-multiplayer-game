import { createTestHarness } from "wrangler";
import { createServer } from "vite";

const harness = createTestHarness({
  workers: [{ configPath: "./wrangler.jsonc", prebuiltWorkerDir: "./dist-worker" }],
});
const worker = await harness.listen();
const vite = await createServer({
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    proxy: {
      "/api": {
        target: worker.url.toString(),
        changeOrigin: true,
        ws: true,
      },
    },
  },
});

await vite.listen();
console.log("SyncUp local multiplayer is ready at http://localhost:4173/");

const shutdown = async () => {
  await vite.close();
  await harness.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
