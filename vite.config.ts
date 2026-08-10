import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path, { resolve } from 'path';
import { copyFileSync, mkdirSync, readFileSync } from 'fs';
import {defineConfig} from 'vite';

// Mathpix Markdown renderer (preview pane).
//
// Shipped as the prebuilt es5 UMD bundle loaded via a CLASSIC <script>, never imported:
// the ESM build trips Vite's strict mode on MathJax's sloppy-mode AsciiMath files
// (mathpix-markdown-it#278), and the package hard-depends on react@^18 which collides
// with React 19. Copying the file keeps it out of the app bundle and out of the CDN.
const MATHPIX_BUNDLE = 'node_modules/mathpix-markdown-it/es5/bundle.js';
const MATHPIX_URL = '/vendor/mathpix/bundle.js';

const vendorMathpix = () => ({
  name: 'vendor-mathpix',
  configureServer(server: { middlewares: { use: (path: string, fn: unknown) => void } }) {
    server.middlewares.use(MATHPIX_URL, (_req: unknown, res: any) => {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(readFileSync(resolve(__dirname, MATHPIX_BUNDLE)));
    });
  },
  writeBundle({ dir }: { dir?: string }) {
    const outDir = dir ?? resolve(__dirname, 'dist');
    mkdirSync(resolve(outDir, 'vendor/mathpix'), { recursive: true });
    copyFileSync(resolve(__dirname, MATHPIX_BUNDLE), resolve(outDir, 'vendor/mathpix/bundle.js'));
  },
});

export default defineConfig(() => {
  return {
    base: './',
    plugins: [react(), tailwindcss(), vendorMathpix()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: {
      include: ['pdfjs-dist'],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            pdfjs: ['pdfjs-dist'],
            docx: ['docx'],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
