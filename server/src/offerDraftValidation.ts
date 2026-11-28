import { z } from 'zod';

const offerAmountSchema = z.string().trim().max(30).refine(
  value => value === '' || /^\d+(?:\.\d{1,4})?$/.test(value),
  'Ingresa un valor numérico válido.',
);

const offerDraftItemSchema = z.object({
  enabled: z.boolean(),
  unitPrice: offerAmountSchema,
  directUnitCost: offerAmountSchema.default(''),
  specification: z.string().max(2000),
  comment: z.string().max(500),
  catalogProductId: z.string().max(30).default(''),
}).strict();

const offerDocumentFindingSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(['requirement', 'deadline', 'document', 'evaluation_criterion', 'technical_condition', 'risk']),
  title: z.string().trim().min(1).max(240),
  extractedText: z.string().max(800),
  interpretation: z.string().max(800),
  sourceLocation: z.string().max(80),
  sourceQuote: z.string().max(800),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  reviewStatus: z.enum(['pending', 'confirmed', 'corrected', 'discarded']),
  correction: z.string().max(800),
  relatedItemCode: z.string().max(100),
  relatedDocumentName: z.string().max(255),
}).strict();

export const offerDraftSchema = z.object({
  quoteName: z.string().max(255),
  details: z.string().max(5000),
  responsible: z.string().max(160),
  deadline: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/),
  minimumMarginPercent: z.string().trim().max(8).refine(
    value => value === '' || (/^(?:\d{1,2}(?:\.\d{1,2})?|100(?:\.0{1,2})?)$/.test(value) && Number(value) >= 0 && Number(value) <= 100),
    'El margen objetivo debe estar entre 0 y 100%.',
  ).default(''),
  declarationReviewed: z.boolean(),
  items: z.record(z.string().max(100), offerDraftItemSchema).refine(
    value => Object.keys(value).length <= 100,
    'La licitación supera el máximo de partidas guardables.',
  ),
  documents: z.array(z.object({
    name: z.string().trim().min(1).max(255),
    url: z.string().max(2048).refine(value => value === '' || /^https?:\/\//i.test(value), 'La referencia debe ser una URL http o https.'),
    requirement: z.string().max(500).default(''),
    reviewStatus: z.enum(['pending', 'reviewed', 'covered']).default('pending'),
    reviewNotes: z.string().max(1000).default(''),
    sourceKind: z.enum(['official', 'uploaded']).optional(),
    analysisStatus: z.enum(['running', 'completed', 'failed']).optional(),
    analysisError: z.string().max(300).optional(),
    analysisAt: z.string().max(40).optional(),
    analysisProvider: z.literal('groq').optional(),
    analysisPartial: z.boolean().optional(),
    analysisWarnings: z.array(z.string().max(240)).max(8).optional(),
    analysisOmittedUnverifiable: z.number().int().min(0).max(30).optional(),
    analysisFindings: z.array(offerDocumentFindingSchema).max(30).optional(),
  })).max(100),
}).strict();
