export type CommercialDecisionInput = {
  availability: { status: string; label: string; isOpen: boolean | null };
  match: {
    score: number | null;
    level: string;
    productName?: string | null;
    matchedSources?: string[];
    reason: string;
  };
  coverage: { missing: string[] };
  buyer: string | null;
  amount: string | number | null;
  currency: string | null;
  itemCount: number;
  documentsPresent: boolean;
};

export type CommercialDecision = {
  label: string;
  tone: 'positive' | 'caution' | 'muted';
  summary: string;
  evidence: string[];
  toConfirm: string[];
  nextAction: { label: string; tab: 'resumen' | 'requisitos' | 'oferta' | 'catalogo'; reason: string };
};

const sourceNames: Record<string, string> = {
  título: 'título de la licitación',
  'descripción oficial': 'descripción disponible',
  'partidas indexadas': 'partidas indexadas',
};

export function buildCommercialDecision(input: CommercialDecisionInput): CommercialDecision {
  const { availability, match, coverage } = input;
  const evidence: string[] = [];
  const sources = (match.matchedSources ?? []).map(source => sourceNames[source] ?? source);

  if (match.score != null && match.productName) {
    evidence.push(`El catálogo «${match.productName}» coincide en ${sources.length ? sources.join(', ') : 'el texto disponible de la ficha'}. Puntaje textual: ${match.score}/100; no es una probabilidad de adjudicación.`);
  } else if (match.reason) {
    evidence.push(match.reason);
  }
  if (availability.label) evidence.push(`Estado según el índice local: ${availability.label}.`);
  if (input.buyer) evidence.push(`Organismo comprador informado: ${input.buyer}.`);
  if (input.itemCount > 0) evidence.push(`${input.itemCount} partida${input.itemCount === 1 ? '' : 's'} disponible${input.itemCount === 1 ? '' : 's'} para revisar.`);
  if (input.documentsPresent) evidence.push('La ficha local indica que hay documentos asociados; su contenido debe revisarse en la fuente oficial.');

  const toConfirm = coverage.missing.filter(item => item !== 'Documentos y bases');
  if (input.amount != null && !input.currency) toConfirm.push('Moneda del monto estimado');
  if (!input.documentsPresent && !toConfirm.includes('Bases y anexos')) toConfirm.push('Bases y anexos');
  const uniqueGaps = [...new Set(toConfirm)];

  if (availability.isOpen === false) {
    const awarded = availability.status === 'awarded';
    return {
      label: awarded ? 'Proceso adjudicado' : 'No está abierto',
      tone: 'muted',
      summary: awarded
        ? 'No prepares una oferta nueva para este proceso. Revisa el resultado para aprender del comprador y del mercado.'
        : 'La ficha no aparece dentro del plazo de postulación. Confirma el estado oficial antes de invertir tiempo comercial.',
      evidence,
      toConfirm: uniqueGaps,
      nextAction: { label: awarded ? 'Revisar ficha y resultado' : 'Confirmar estado oficial', tab: 'resumen', reason: awarded ? 'El proceso ya figura adjudicado.' : availability.label },
    };
  }

  if (match.level === 'unavailable') {
    return {
      label: 'Falta configurar el catálogo', tone: 'caution',
      summary: 'Oportuna no puede medir el encaje comercial sin productos o actividad configurados para la empresa.',
      evidence, toConfirm: uniqueGaps,
      nextAction: { label: 'Completar catálogo comercial', tab: 'catalogo', reason: match.reason },
    };
  }

  if (match.level === 'excluded' || match.level === 'none' || match.level === 'exploratory') {
    return {
      label: match.level === 'excluded' ? 'Excluida por el perfil' : match.level === 'none' ? 'Sin encaje comprobado' : 'Señal exploratoria',
      tone: 'muted',
      summary: match.reason,
      evidence, toConfirm: uniqueGaps,
      nextAction: { label: 'Revisar catálogo comercial', tab: 'catalogo', reason: 'Confirma si los productos, sinónimos y exclusiones reflejan lo que Andes Organics puede suministrar.' },
    };
  }

  if (availability.isOpen !== true) {
    return {
      label: 'Estado pendiente de validar', tone: 'caution',
      summary: 'Hay una coincidencia comercial, pero el índice no confirma que siga abierto el plazo de postulación.',
      evidence, toConfirm: uniqueGaps,
      nextAction: { label: 'Revisar estado y ficha oficial', tab: 'resumen', reason: 'No cotices hasta confirmar el estado y el cierre en la fuente oficial.' },
    };
  }

  const requiresScopeReview = !input.documentsPresent || input.itemCount === 0;
  return {
    label: requiresScopeReview ? 'Validar alcance antes de cotizar' : 'Avanzar a evaluación económica',
    tone: requiresScopeReview ? 'caution' : 'positive',
    summary: requiresScopeReview
      ? 'La ficha está dentro del plazo y coincide con el catálogo, pero falta revisar bases, anexos o partidas antes de decidir si se puede cumplir.'
      : 'La ficha está dentro del plazo, tiene coincidencia con el catálogo y ofrece partidas para revisar. Compara especificaciones y costos antes de decidir participar.',
    evidence,
    toConfirm: uniqueGaps,
    nextAction: requiresScopeReview
      ? { label: 'Revisar requisitos y documentos', tab: 'requisitos', reason: 'Confirma el alcance técnico, cantidades, garantías y condiciones en las bases oficiales.' }
      : { label: 'Preparar escenario de costos', tab: 'oferta', reason: 'Registra costos y precios propios por partida; el cálculo no inventa costos ni decide por la empresa.' },
  };
}
