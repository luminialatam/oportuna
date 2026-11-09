import { classifyCommercialIntent, commercialIntentMatchesOffer, commercialOfferTypeLabels, commercialTerms, findPromisingEnrichmentPhrase, hasCatalogDomainConflict, hasCommercialTerm, isKnownProductPlaceName, matchesCommercialExclusion, scoreCatalogMatch, type CommercialOfferType } from './commercialMatching.js';

export interface PreviewProduct {
  nombre: string;
  categoria?: string | null;
  descripcion?: string | null;
  palabrasClave?: string[];
  sinonimos?: string[];
  terminosRelacionados?: string[];
  aplicaciones?: string[];
  exclusiones?: string[];
  tiposComerciales?: CommercialOfferType[];
  activo?: boolean;
}

export interface PreviewListingRow {
  code: string;
  title: string;
  organism: string | null;
  amount?: string | number | null;
  currency?: string | null;
  closeAt: string | Date;
  description: string;
  category: string;
  itemText: string;
  itemCount: number;
  detailStatus: string | null;
  detailUpdatedAt: string | Date | null;
}

export interface EnrichmentCandidate {
  code: string;
  title: string;
  organism: string | null;
  closeAt: string | Date;
  score: number | null;
  level: 'high' | 'medium' | 'exploratory' | 'none';
  selectionType: 'commercial_evidence' | 'investigation';
  productName: string;
  contractingTypes: string[];
  matchedSources: string[];
  reason: string;
  currentCoverage: string;
  informationAvailable: string[];
  informationMissing: string[];
}

const toTime = (value: string | Date | null | undefined) => {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

export function rankEnrichmentCandidates(
  rows: PreviewListingRow[],
  products: PreviewProduct[],
  profileExclusions: string[] = [],
  now = Date.now(),
  limit = 10,
): { eligibleCandidates: number; candidates: EnrichmentCandidate[] } {
  const catalog = products.filter(product => product.activo !== false);
  const ranked: Array<EnrichmentCandidate & { daysToClose: number }> = [];

  for (const row of rows) {
    const closesAt = toTime(row.closeAt);
    if (!row.code || !row.title || closesAt === null || closesAt < now || closesAt > now + 30 * 86_400_000) continue;
    if (row.itemCount > 0 || row.detailStatus === 'completed' || row.detailStatus === 'empty') continue;
    const evidenceText = `${row.title} ${row.description} ${row.itemText}`;
    if (profileExclusions.some(term => matchesCommercialExclusion(evidenceText, term))) continue;

    const intent = classifyCommercialIntent(row.title, row.description, row.itemText);
    let best: { score: number | null; level: EnrichmentCandidate['level']; matchedSources: string[]; productName: string; selectionType: EnrichmentCandidate['selectionType']; evidencePhrase: string; contractingTypes: string[] } | null = null;
    for (const product of catalog) {
      if ((product.exclusiones ?? []).some(term => matchesCommercialExclusion(evidenceText, term))) continue;
      const productTerms = [product.nombre, product.categoria, product.descripcion, ...(product.palabrasClave ?? []), ...(product.sinonimos ?? []), ...(product.terminosRelacionados ?? [])].filter(Boolean).join(' ');
      if (isKnownProductPlaceName(evidenceText, productTerms)) continue;
      if (hasCatalogDomainConflict(productTerms, evidenceText)) continue;
      if (commercialIntentMatchesOffer(intent, product.tiposComerciales ?? []) === false) continue;
      const match = scoreCatalogMatch(product, row.title, row.description, row.itemText);
      const evidencePhrase = findPromisingEnrichmentPhrase(match, product, row.title, row.description, row.itemText);
      if (!evidencePhrase) continue;
      const unresolvedTypedOffer = Boolean(product.tiposComerciales?.length && !intent.length);
      const effectiveLevel = unresolvedTypedOffer ? 'exploratory' as const : (match?.level ?? 'none');
      const selectionType = !match || effectiveLevel === 'exploratory' ? 'investigation' : 'commercial_evidence';
      if (selectionType === 'investigation' && !evidencePhrase) continue;
      const level = effectiveLevel;
      const score = match?.score ?? null;
      const phraseTerms = evidencePhrase ? commercialTerms(evidencePhrase, true) : [];
      const supportsPhrase = (source: string) => phraseTerms.length >= 2 && phraseTerms.filter(term => hasCommercialTerm(source, term)).length >= 2;
      const matchedSources = match?.matchedSources.length ? match.matchedSources : [
        ...(supportsPhrase(row.title) ? ['título'] : []),
        ...(supportsPhrase(row.description) ? ['descripción oficial'] : []),
        ...(supportsPhrase(row.itemText) ? ['partidas indexadas'] : []),
      ];
      const levelRank = (value: string) => value === 'high' ? 3 : value === 'medium' ? 2 : value === 'exploratory' ? 1 : 0;
      if (!best || levelRank(level) > levelRank(best.level) || (level === best.level && (score ?? -1) > (best.score ?? -1))) {
        best = { score, level, matchedSources, productName: product.nombre, selectionType, evidencePhrase: evidencePhrase ?? product.nombre, contractingTypes: [...new Set(intent.map(item => commercialOfferTypeLabels[item.type]))] };
      }
    }
    if (!best) continue;

    const daysToClose = Math.max(0, Math.ceil((closesAt - now) / 86_400_000));
    const matchedSources = best.matchedSources.length ? best.matchedSources : ['título o descripción'];
    const currentCoverage = row.itemCount > 0
      ? `${row.itemCount} partidas indexadas${row.detailUpdatedAt ? ` · consultada ${new Intl.DateTimeFormat('es-CL').format(new Date(row.detailUpdatedAt))}` : ''}`
      : row.detailStatus === 'empty'
        ? 'Ficha consultada · sin partidas'
        : row.detailStatus === 'failed'
          ? 'Consulta anterior fallida · reintentable'
          : 'Sin partidas indexadas';
    const informationAvailable = ['Título', 'Estado: publicada', ...(row.organism ? ['Organismo comprador'] : []), ...(row.description.trim() ? ['Descripción oficial'] : []), ...(row.closeAt ? ['Fecha de cierre'] : []), ...(row.amount != null ? [`Monto (${row.currency || 'moneda no informada'})`] : [])];
    const informationMissing = [
      ...(!row.description.trim() ? ['Descripción oficial'] : []),
      'Partidas y cantidades oficiales',
      ...(!row.organism ? ['Organismo comprador'] : []),
      ...(row.amount == null ? ['Monto estimado'] : []),
      'Bases, especificaciones y documentos adjuntos por revisar en la ficha oficial',
    ];
    ranked.push({
      code: row.code,
      title: row.title,
      organism: row.organism,
      closeAt: row.closeAt,
      score: best.score,
      level: best.level,
      productName: best.productName,
      contractingTypes: best.contractingTypes,
      matchedSources,
      selectionType: best.selectionType,
      reason: best.selectionType === 'investigation'
        ? `Evidencia prometedora pero incompleta («${best.evidencePhrase}») para «${best.productName}» en ${matchedSources.join(', ')}. Se selecciona solo para revisar la ficha; el Match ${best.level === 'none' ? 'no alcanza evidencia suficiente' : 'sigue exploratorio'}. Cierra en ${daysToClose} día(s).`
        : `Evidencia ${best.level} con «${best.productName}» en ${matchedSources.join(', ')}. El detalle se solicita para revisar especificaciones; el Match no se eleva. Cierra en ${daysToClose} día(s).`,
      currentCoverage,
      informationAvailable,
      informationMissing,
      daysToClose,
    });
  }

  const levelRank = (level: string) => level === 'high' ? 3 : level === 'medium' ? 2 : level === 'exploratory' ? 1 : 0;
  ranked.sort((a, b) => levelRank(b.level) - levelRank(a.level) || (b.score ?? -1) - (a.score ?? -1) || a.daysToClose - b.daysToClose || a.code.localeCompare(b.code));
  const safeLimit = Math.max(1, Math.min(10, Math.trunc(limit) || 10));
  return {
    eligibleCandidates: ranked.length,
    candidates: ranked.slice(0, safeLimit).map(({ daysToClose: _days, ...candidate }) => candidate),
  };
}
