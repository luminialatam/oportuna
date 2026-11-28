import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const repositoryRoot = process.cwd();
const outputDirectory = resolve(repositoryRoot, 'dist-server/vendor');
await mkdir(outputDirectory, { recursive: true });

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  logLevel: 'warning',
  absWorkingDir: repositoryRoot,
};

await Promise.all([
  build({
    ...shared,
    stdin: {
      contents: "import multer from 'multer'; module.exports = multer;",
      resolveDir: repositoryRoot,
      sourcefile: 'sharkasp-multer-entry.cjs',
      loader: 'js',
    },
    format: 'cjs',
    outfile: resolve(outputDirectory, 'multer.cjs'),
  }),
  build({
    ...shared,
    stdin: {
      contents: "module.exports = require('mammoth');",
      resolveDir: repositoryRoot,
      sourcefile: 'sharkasp-mammoth-entry.cjs',
      loader: 'js',
    },
    format: 'cjs',
    outfile: resolve(outputDirectory, 'mammoth.cjs'),
  }),
  build({
    ...shared,
    stdin: {
      contents: "export { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';",
      resolveDir: repositoryRoot,
      sourcefile: 'sharkasp-pdfjs-entry.mjs',
      loader: 'js',
    },
    format: 'esm',
    external: ['canvas'],
    outfile: resolve(outputDirectory, 'pdfjs-dist.mjs'),
  }),
  build({
    ...shared,
    entryPoints: ['node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
    format: 'esm',
    outfile: resolve(outputDirectory, 'pdf.worker.mjs'),
  }),
]);

process.stdout.write('Bundled SharkASP-only runtime dependencies: multer, mammoth, pdfjs-dist.\n');
