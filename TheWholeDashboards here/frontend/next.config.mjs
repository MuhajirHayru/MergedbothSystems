import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  outputFileTracingRoot: projectRoot,
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: projectRoot,
  },
}

export default nextConfig
