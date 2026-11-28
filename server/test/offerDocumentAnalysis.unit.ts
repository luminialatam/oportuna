import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { analyzeOfferDocumentText, extractOfferDocument, isTrustedOfficialDocumentUrl, OfferDocumentAnalysisError } from '../src/offerDocumentAnalysis.js';

function makeMinimalPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[\\()]/g, '\\$&')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

const pdfQuote = 'Offer must include warranty certificate through 2026-12-15.';
const pdf = await extractOfferDocument(makeMinimalPdf(pdfQuote), 'bases.pdf');
assert.equal(pdf.format, 'pdf');
assert.equal(pdf.pageCount, 1);
assert.match(pdf.chunks[0].location, /Página 1/);
assert.ok(pdf.chunks.some(chunk => chunk.text.includes(pdfQuote)));

const docxBuffer = await readFile(join(process.cwd(), 'server/test/fixtures/offer-analysis-sample.docx'));
const docx = await extractOfferDocument(docxBuffer, 'bases.docx');
assert.equal(docx.format, 'docx');
assert.ok(docx.chunks.some(chunk => chunk.location === 'Párrafo 1' && chunk.text.includes('certificado de garantía')));
assert.ok(docx.warnings.some(warning => warning.includes('no permite ubicar páginas')));

assert.equal(isTrustedOfficialDocumentUrl('https://www.mercadopublico.cl/documentos/bases.pdf'), true);
assert.equal(isTrustedOfficialDocumentUrl('https://api.mercadopublico.cl/file.pdf'), true);
assert.equal(isTrustedOfficialDocumentUrl('http://www.mercadopublico.cl/bases.pdf'), false);
assert.equal(isTrustedOfficialDocumentUrl('https://mercadopublico.cl.evil.example/bases.pdf'), false);
assert.equal(isTrustedOfficialDocumentUrl('https://127.0.0.1/bases.pdf'), false);

let requestedUrl = '';
const groundedQuote = docx.chunks[0].text.slice(docx.chunks[0].text.indexOf('certificado'), docx.chunks[0].text.indexOf('certificado') + 'certificado de garantía por doce meses'.length);
const explicitDeadline = docx.chunks[1].text;
const mocked = await analyzeOfferDocumentText('bases.docx', docx, {
  apiKey: 'test-only',
  fetcher: async (input, init) => {
    requestedUrl = String(input);
    assert.match(new Headers(init?.headers).get('authorization') ?? '', /^Bearer test-only$/);
    const content = JSON.stringify({ findings: [
      { kind: 'requirement', title: 'Certificado de garantía', sourceId: docx.chunks[0].id, sourceQuote: groundedQuote, interpretation: 'La propuesta debe incluir este respaldo.', dueDate: null },
      { kind: 'deadline', title: 'Fecha de recepción', sourceId: docx.chunks[1].id, sourceQuote: explicitDeadline, interpretation: 'Fecha escrita en el texto fuente.', dueDate: '2026-12-15' },
      { kind: 'deadline', title: 'Fecha sin respaldo', sourceId: docx.chunks[1].id, sourceQuote: explicitDeadline, interpretation: 'La fecha exacta debe confirmarse.', dueDate: '2026-01-01' },
      { kind: 'deadline', title: 'Fecha inventada', sourceId: docx.chunks[0].id, sourceQuote: 'La apertura es el día 1 de enero.', interpretation: 'Fecha límite de presentación.', dueDate: '2026-01-01' },
    ] });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  },
});
assert.equal(requestedUrl, 'https://api.groq.com/openai/v1/chat/completions');
assert.equal(mocked.provider, 'groq');
assert.equal(mocked.findings.length, 3);
assert.equal(mocked.findings[0].sourceQuote, groundedQuote);
assert.equal(mocked.findings[0].reviewStatus, 'pending');
assert.equal(mocked.findings[1].dueDate, '2026-12-15');
assert.equal(mocked.findings[2].dueDate, null);
assert.equal(mocked.omittedUnverifiable, 2);

await assert.rejects(
  analyzeOfferDocumentText('bases.pdf', pdf, { apiKey: '', fetcher: async () => { throw new Error('should not call network'); } }),
  (error: unknown) => error instanceof OfferDocumentAnalysisError && error.code === 'AI_UNAVAILABLE',
);
await assert.rejects(
  analyzeOfferDocumentText('bases.pdf', pdf, { apiKey: 'test-only', fetcher: async () => new Response('unavailable', { status: 429 }) }),
  (error: unknown) => error instanceof OfferDocumentAnalysisError && error.code === 'AI_PROVIDER_ERROR' && error.status === 502,
);
await assert.rejects(extractOfferDocument(Buffer.from('%PDF-not-a-valid-document'), 'invalid.pdf'), OfferDocumentAnalysisError);
await assert.rejects(extractOfferDocument(Buffer.from('legacy Word is not supported'), 'bases.doc'), (error: unknown) => error instanceof OfferDocumentAnalysisError && error.code === 'UNSUPPORTED_FORMAT');

process.stdout.write('offerDocumentAnalysis.unit: ok\n');
