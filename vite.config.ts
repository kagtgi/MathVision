import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path, { resolve } from 'path';
import { copyFileSync } from 'fs';
import {defineConfig} from 'vite';

// Copies the PDF.js worker into dist/ so the Electron app never needs CDN access.
const copyPdfjsWorker = () => ({
  name: 'copy-pdfjs-worker',
  writeBundle({ dir }: { dir?: string }) {
    const outDir = dir ?? resolve(__dirname, 'dist');
    copyFileSync(
      resolve(__dirname, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'),
      resolve(outDir, 'pdf.worker.min.mjs'),
    );
  },
});

export default defineConfig(() => {
  return {
    base: './',
    plugins: [react(), tailwindcss(), copyPdfjsWorker()],
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
            katex: ['katex'],
            markdown: ['react-markdown', 'remark-math', 'rehype-katex', 'remark-gfm'],
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
