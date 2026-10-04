import type { NextConfig } from 'next';

const config: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ['@scalelab/model', '@scalelab/catalog', '@scalelab/engine', '@scalelab/templates', '@scalelab/planner'],
  reactStrictMode: true,
};

export default config;
