import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { ManifestV3Export } from '@crxjs/vite-plugin';
import { defineConfig, type UserConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths'
import manifest from './manifest.json';
import manifestDev from './manifest.dev.json';
import pkg from './package.json';
import { stripDevIcons } from './custom-vite-plugins';

export function createBaseManifest(isDevelopment: boolean): ManifestV3Export {
  return {
    ...manifest,
    ...(isDevelopment ? manifestDev : {}),
    version: pkg.version,
  } as ManifestV3Export;
}

export function createBaseConfig(isDevelopment: boolean): UserConfig {
  return defineConfig({
    plugins: [
      tsconfigPaths(),
      react(),
      stripDevIcons(isDevelopment),
    ],
    publicDir: resolve(__dirname, 'public'),
    build: {
      sourcemap: isDevelopment,
      emptyOutDir: true,
    },
  });
}
