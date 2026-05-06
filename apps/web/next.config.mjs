import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  turbopack: {
    root: join(__dirname, "../.."),
  },
};

export default nextConfig;
