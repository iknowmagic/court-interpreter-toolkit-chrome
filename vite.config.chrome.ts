import { resolve } from 'path';
import { mergeConfig, defineConfig } from 'vite';
import { crx, ManifestV3Export } from '@crxjs/vite-plugin';
import { createBaseConfig, createBaseManifest } from './vite.config.base'

const outDir = resolve(__dirname, 'dist_chrome');

export default defineConfig(({ mode }) => {
  const isDevelopment = mode === 'development';

  return mergeConfig(
    createBaseConfig(isDevelopment),
    defineConfig({
      plugins: [
        crx({
          manifest: {
            ...createBaseManifest(isDevelopment),
            background: {
              service_worker: 'src/pages/background/index.ts',
              type: 'module'
            },
          } as ManifestV3Export,
          browser: 'chrome',
          contentScripts: {
            injectCss: true,
          }
        })
      ],
      build: {
        outDir
      },
    })
  );
});
