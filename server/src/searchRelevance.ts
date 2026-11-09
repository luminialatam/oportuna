export type SearchEvidenceGroups = {
  literal: string[];
  core: string[];
  synonyms: string[];
  related: string[];
  all: string[];
};

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function hasSearchTerm(text: string, term: string): boolean {
  const normalizedTerm = normalize(term);
  const equivalentTerms = normalizedTerm === 'equipamiento' ? ['equipamiento', 'equipo', 'equipos'] : [normalizedTerm];
  const normalizedText = normalize(text);
  return equivalentTerms.some(value => {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?:s|es)?(?=$|[^\\p{L}\\p{N}])`, 'u').test(normalizedText);
  });
}

export function scoreSearchEvidence(input: {
  query: string;
  code: string;
  title: string;
  organization: string;
  description: string;
  itemNames: string;
  itemDescriptions: string;
  groups: SearchEvidenceGroups;
  ambiguous?: boolean;
}) {
  const { query, code, title, organization, description, itemNames, itemDescriptions, groups } = input;
  const exactCode = code.toUpperCase() === query.trim().toUpperCase();
  const normalizedQuery = normalize(query).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const normalizedTitle = normalize(title).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const phraseInTitle = normalizedQuery.length > 2 && ` ${normalizedTitle} `.includes(` ${normalizedQuery} `);
  const literalTerms = groups.literal.length ? groups.literal : groups.core;
  const titleHits = literalTerms.filter(term => hasSearchTerm(title, term));
  const descriptionHits = literalTerms.filter(term => hasSearchTerm(description, term));
  const itemNameHits = literalTerms.filter(term => hasSearchTerm(itemNames, term));
  const itemDescriptionHits = literalTerms.filter(term => hasSearchTerm(itemDescriptions, term));
  const organizationHits = literalTerms.filter(term => hasSearchTerm(organization, term));
  const matchedLiteral = new Set([...titleHits, ...descriptionHits, ...itemNameHits, ...itemDescriptionHits, ...organizationHits]);
  const coverage = literalTerms.length ? matchedLiteral.size / literalTerms.length : 0;
  const exactItems = literalTerms.length > 0 && literalTerms.every(term => itemNameHits.includes(term));
  const exactDescription = literalTerms.length > 0 && literalTerms.every(term => descriptionHits.includes(term));
  const exactItemDescription = literalTerms.length > 0 && literalTerms.every(term => itemDescriptionHits.includes(term));
  const procurementIntent = /\b(adquisicion|compra|suministro)\b/u.test(normalize(title));
  const synonymHits = groups.synonyms.filter(term => hasSearchTerm(title, term) || hasSearchTerm(description, term) || hasSearchTerm(itemNames, term) || hasSearchTerm(itemDescriptions, term));
  const relatedHits = groups.related.filter(term => hasSearchTerm(title, term) || hasSearchTerm(description, term) || hasSearchTerm(itemNames, term) || hasSearchTerm(itemDescriptions, term));

  let score = 0;
  if (exactCode) score = 100;
  else if (phraseInTitle) score = 100;
  else if (literalTerms.length > 0 && literalTerms.every(term => titleHits.includes(term)) && procurementIntent) score = 99;
  else if (literalTerms.length > 0 && literalTerms.every(term => titleHits.includes(term))) score = 95;
  else if (exactItems) score = 94;
  else if (exactDescription) score = 88;
  else if (exactItemDescription) score = 84;
  else if (coverage > 0) {
    const strongestEvidence = titleHits.length ? 3 : itemNameHits.length ? 2 : descriptionHits.length || itemDescriptionHits.length ? 1 : 0;
    score = Math.round(20 + 65 * coverage + strongestEvidence * 2 + Math.min(6, synonymHits.length * 2) + Math.min(2, relatedHits.length));
  } else if (synonymHits.length) score = Math.min(55, 38 + synonymHits.length * 3);
  else if (relatedHits.length) score = Math.min(35, 22 + relatedHits.length * 2);

  const fullCoreCoverage = groups.core.length > 0 && groups.core.every(term => hasSearchTerm(title, term) || hasSearchTerm(itemNames, term) || hasSearchTerm(description, term) || hasSearchTerm(itemDescriptions, term));
  if (input.ambiguous && literalTerms.length === 1 && !exactCode) score = Math.min(score, 60);
  const level: 'high' | 'medium' | 'exploratory' = exactCode || (!input.ambiguous && (phraseInTitle || exactItems || exactDescription || exactItemDescription || (fullCoreCoverage && score >= 75)))
    ? 'high'
    : score >= 40 && (literalTerms.length <= 1 || matchedLiteral.size >= 2) ? 'medium' : 'exploratory';

  const matched = groups.all.filter(term => hasSearchTerm(title, term) || hasSearchTerm(organization, term) || hasSearchTerm(description, term) || hasSearchTerm(itemNames, term) || hasSearchTerm(itemDescriptions, term));
  const matchSources: string[] = [];
  if (exactCode) matchSources.push('código exacto');
  if (titleHits.length || groups.all.some(term => hasSearchTerm(title, term))) matchSources.push('título');
  if (organizationHits.length) matchSources.push('organismo comprador');
  if (descriptionHits.length || groups.all.some(term => hasSearchTerm(description, term))) matchSources.push('descripción oficial');
  if (itemNameHits.length || itemDescriptionHits.length || groups.all.some(term => hasSearchTerm(itemNames, term) || hasSearchTerm(itemDescriptions, term))) matchSources.push('partidas indexadas');
  return { score, level, exactCode, phraseInTitle, procurementIntent, titleHits, descriptionHits, itemNameHits, itemDescriptionHits, organizationHits, synonymHits, relatedHits, matched, matchSources, coverage };
}
