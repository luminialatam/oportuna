export type CatalogMatchItem = {
  id: number;
  nombre: string;
  categoria?: string;
  descripcion?: string;
  palabrasClave?: string[];
  sinonimos?: string[];
  terminosRelacionados?: string[];
  aplicaciones?: string[];
  activo: boolean;
};

const ignored = new Set(['para', 'con', 'por', 'del', 'una', 'uno', 'las', 'los', 'servicio', 'servicios', 'producto', 'productos', 'segun', 'incluye']);
export function normalizeMatchTokens(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter(token => token.length > 2 && !ignored.has(token));
}

export function suggestCatalogMatches(part: { name: string; description?: string; category?: string }, catalog: CatalogMatchItem[], limit = 3) {
  const partFields: Array<[string, string]> = [['nombre de partida', part.name], ['descripción de partida', part.description ?? ''], ['categoría de partida', part.category ?? '']];
  const partText = partFields.map(([, value]) => value).filter(Boolean).join(' ');
  const partTokens = new Set(normalizeMatchTokens(partText));
  if (!partTokens.size) return [];
  return catalog.filter(item => item.activo).map(item => {
    const fields: Array<[string, string]> = [
      ['nombre', item.nombre], ['categoría', item.categoria ?? ''], ['descripción', item.descripcion ?? ''],
      ['palabra clave', ...(item.palabrasClave ?? [])], ['sinónimo', ...(item.sinonimos ?? [])],
      ['término relacionado', ...(item.terminosRelacionados ?? [])], ['aplicación', ...(item.aplicaciones ?? [])],
    ].flatMap(([label, ...values]) => values.map(value => [label, String(value)] as [string, string]));
    const evidence = fields.flatMap(([source, value]) => {
      const matches = normalizeMatchTokens(value).filter(token => partTokens.has(token));
      return matches.map(term => ({ source, text: value, term }));
    });
    const terms = [...new Set(evidence.map(value => value.term))];
    const partEvidence = terms.flatMap(term => partFields.flatMap(([source, text]) => normalizeMatchTokens(text).includes(term) ? [{ source, text, term }] : []));
    return { item, terms, evidence, partEvidence, score: terms.length / Math.max(partTokens.size, 1) };
  }).filter(match => match.terms.length >= 2)
    .sort((a, b) => b.score - a.score || a.item.nombre.localeCompare(b.item.nombre, 'es'))
    .slice(0, limit);
}
