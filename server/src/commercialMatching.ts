const stopWords = new Set('de del la el los las un una unos unas en y o por para con a al como sus que desde hasta'.split(' '));
// Palabras que no identifican por sí solas un producto: sector, trámite o categoría.
const genericWords = new Set('servicio servicios equipo equipos equipamiento industrial industriales comercial comerciales producto productos suministro suministros compra compras adquisicion adquisiciones varios varias gestion integral general publico publica chile empresa licitacion licitaciones alimento alimentario alimentaria alimentarios alimentarias alimentacion maquinaria maquina maquinas procesamiento proceso produccion producciones gastronomico gastronomica gastronomicos gastronomicas instalacion instalaciones montaje puesta marcha configuracion configuraciones'.split(' '));
const nonSpecificProductNameTerms = new Set('servicio servicios industrial industriales comercial comerciales producto productos suministro suministros compra compras adquisicion adquisiciones varios varias gestion integral general publico publica chile empresa licitacion licitaciones instalacion instalaciones montaje puesta marcha configuracion configuraciones'.split(' '));
// Términos que describen el rubro o el proceso, nunca el equipo concreto.
const weakNameTerms = new Set('alimento equipo maquinaria producto servicio tecnico tecnica tecnicos tecnicas electrico electrica electricos electricas camara procesamiento proceso produccion elaboracion gastronomico sistema planta linea conjunto equipamiento maquina instalacion montaje puesta marcha configuracion red redes laboratorio edificio infraestructura infraestructuras digital institucional cama monitor'.split(' '));
// Materias primas: acompañan a un equipo, pero no lo identifican.
const commodityNameTerms = new Set('aceite harina grano cereal agua vegetal'.split(' '));
const lowSpecificitySingleTerms = new Set('alimento comida gastronomico cocina procesamiento molino maquinaria equipo horno prensa informatica mantencion mantenimiento reparacion instalacion montaje'.split(' '));

export const commercialOfferTypes = ['product_supply', 'service', 'installation', 'maintenance_repair', 'rental', 'construction'] as const;
export type CommercialOfferType = typeof commercialOfferTypes[number];
export const commercialOfferTypeLabels: Record<CommercialOfferType, string> = {
  product_supply: 'Compra o suministro', service: 'Servicios', installation: 'Instalación y puesta en marcha',
  maintenance_repair: 'Mantención y reparación', rental: 'Arriendo de equipamiento', construction: 'Construcción y obras',
};
export type CommercialIntent = { type: CommercialOfferType; phrase: string; source: 'título' | 'descripción oficial' | 'partidas indexadas' };

const intentStopWords = new Set([...stopWords, ...genericWords, 'nuevo', 'nueva', 'nuevos', 'nuevas', 'usado', 'usada', 'industrial', 'industriales', 'profesional', 'profesionales', 'institucional', 'institucionales', 'publico', 'publica', 'portatil', 'electrico', 'electrica', 'comercial', 'preventivo', 'preventiva', 'correctivo', 'correctiva', 'integral', 'mantencion', 'mantenimiento', 'reparacion', 'instalacion', 'montaje', 'arriendo', 'arrendamiento', 'alquiler', 'servicio', 'servicios', 'suministro', 'suministros', 'adquisicion', 'compra', 'construccion', 'actividad', 'actividades']);
const intentActions: Array<{ type: CommercialOfferType; re: RegExp }> = [
  { type: 'product_supply', re: /\b(?:adquisicion|compra|comprar|suministro|suministrar|provision|proveer|venta|vender|entrega|entregar)\s+(?:(?:de|del|para|por)\s+)?([a-z0-9][a-z0-9 ]{1,100})/g },
  { type: 'service', re: /\b(?:servicio|servicios|prestacion|consultoria|contratacion)\s+(?:(?:de|del|para|por)\s+)?([a-z0-9][a-z0-9 ]{1,100})/g },
  { type: 'installation', re: /\b(?:instalacion|montaje|puesta en marcha|comisionamiento)\s+(?:(?:de|del|para|por)\s+)?([a-z0-9][a-z0-9 ]{1,100})/g },
  { type: 'maintenance_repair', re: /\b(?:mantencion|mantenimiento|reparacion|reparaciones|servicio tecnico)\s+(?:(?:de|del|para|por)\s+)?([a-z0-9][a-z0-9 ]{1,100})/g },
  { type: 'rental', re: /\b(?:arriendo|arrendamiento|alquiler|leasing)\s+(?:(?:de|del|para|por)\s+)?([a-z0-9][a-z0-9 ]{1,100})/g },
  { type: 'construction', re: /\b(?:construccion|obra|obras|pavimentacion|edificacion)\s+(?:(?:de|del|para|por)\s+)?([a-z0-9][a-z0-9 ]{1,100})/g },
];

function hasIntentSubject(value: string): boolean {
  return value.split(' ').map(canonicalCommercialWord).filter(word => word.length > 2 && !intentStopWords.has(word)).length > 0;
}

/** Classifies only an action plus a meaningful object; standalone words such as "servicio" are not evidence. */
export function classifyCommercialIntent(title: string, description = '', items = ''): CommercialIntent[] {
  const sources: Array<[CommercialIntent['source'], string]> = [['título', title], ['descripción oficial', description], ['partidas indexadas', items]];
  const found: CommercialIntent[] = [];
  for (const [source, rawText] of sources) {
    const text = normalizeCommercialText(rawText);
    if (!text) continue;
    for (const action of intentActions) {
      const re = new RegExp(action.re.source, action.re.flags);
      for (const match of text.matchAll(re)) {
        const objectParts = (match[1] ?? '').split(/\b(?:y|e|ademas|incluye|incluyendo|junto|segun|considera|cantidad)\b/).map(part => part.trim()).filter(Boolean);
        const object = objectParts.find(hasIntentSubject) ?? objectParts[0] ?? '';
        // Chilean public health agencies are commonly named "Servicio de Salud …".
        // Their institutional name is not evidence that healthcare services are being bought.
        if (action.type === 'service' && /^servicios?\s+(?:de\s+salud\b|public[oa]\b)/.test(match[0])) continue;
        if (action.type === 'installation' && /^en rack\b/.test(object)) continue;
        const explicitRentalCategory = action.type === 'rental' && /^(?:equipamiento|maquinaria)\s+(?:gastronomico|gastronomica|alimentario|alimentaria|medico|medica|industrial|industriales)\b/.test(object);
        if (!hasIntentSubject(object) && !explicitRentalCategory) continue;
        if (action.type === 'product_supply' && /^(?:servicio|servicios|mantencion|mantenimiento|reparacion|instalacion|montaje|arriendo|arrendamiento|obra|obras|construccion)\b/.test(object)) continue;
        const phrase = `${match[0].slice(0, match[0].length - (match[1]?.length ?? 0)).trim()} ${object}`.trim();
        found.push({ type: action.type, phrase: phrase.slice(0, 140), source });
        if (action.type === 'maintenance_repair' && /\bservicio(?:s)?\b/.test(text)) found.push({ type: 'service', phrase: `servicio de ${object}`.slice(0, 140), source });
      }
    }
    // Explicit paired acquisition keeps both commercial components.
    if (/\b(?:suministro|adquisicion|compra)\b.{0,60}\b(?:e|y)\s+(?:instalacion|montaje|puesta en marcha)\b/.test(text)) {
      const subject = text.match(/\b(?:de|del)\s+([a-z0-9 ]{3,80})/)?.[1]?.split(/\b(?:e|y|para|junto|incluye)\b/)[0]?.trim();
      if (subject && hasIntentSubject(subject)) {
        found.push({ type: 'product_supply', phrase: `suministro de ${subject}`, source });
        found.push({ type: 'installation', phrase: `instalación de ${subject}`, source });
      }
    }
    // Construction phrases are meaningful by themselves when the object is an explicit work type.
    const workPhrase = text.match(/\b(obras? civiles|obras? de infraestructura|construccion de edificios|pavimentacion de calles|edificacion de recintos)\b/);
    if (workPhrase) found.push({ type: 'construction', phrase: workPhrase[1], source });
  }
  const seen = new Set<string>();
  return found.filter(item => { const key = `${item.type}|${item.source}|${item.phrase}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

/** Blocks only explicit cross-domain conflicts; shared terms alone remain eligible. */
export function hasCatalogDomainConflict(product: string, listing: string): boolean {
  const catalog = normalizeCommercialText(product); const tender = normalizeCommercialText(listing);
  const catalogHas = (re: RegExp) => re.test(catalog); const tenderHas = (re: RegExp) => re.test(tender);
  if (catalogHas(/\b(?:edificio|edificios|inmueble|inmuebles)\b/) && tenderHas(/\b(?:vehiculo|vehiculos|automovil|camioneta|camiones|bus|buses|flota)\b/)) return true;
  if (catalogHas(/\b(?:edificio|edificios|inmueble|inmuebles)\b/) && /\b(?:mantencion|mantenimiento|reparacion)\b/.test(tender) && tenderHas(/\b(?:lavavajillas?|lavalozas?|horno industrial|maquinaria gastronomica|equipo gastronomico)\b/)) return true;
  if (catalogHas(/\b(?:bodegaje|bodega|almacenaje de mercaderia|almacenamiento comercial)\b/) && tenderHas(/\b(?:servidor|servidores|centro de datos|base de datos|nas|storage informatico)\b/)) return true;
  if (catalogHas(/\b(?:molinos?|prensas?|hornos?|lavavajillas?|maquinaria alimentaria|equipamiento gastronomico)\b/) && tenderHas(/\b(?:pan y empanadas|panaderia y empanadas|raciones preparadas|productos alimenticios|adquisicion de alimentos)\b/) && !tenderHas(/\b(?:horno industrial|maquinaria|equipamiento|lavavajilla industrial|molino coloidal|prensa expeller)\b/)) return true;
  if (catalogHas(/\b(?:ropa de cama|sabanas|sabaneria|textiles de cama)\b/) && tenderHas(/\b(?:cama clinica|cama hospitalaria|catre clinico)\b/)) return true;
  if (catalogHas(/\b(?:camas? clinicas?|camas? hospitalarias?|catres? clinicos?)\b/) && tenderHas(/\b(?:ropa de cama|sabanas|sabaneria|textiles de cama)\b/)) return true;
  if (catalogHas(/\b(?:sanitaria|sanitarias|alcantarillado|agua potable)\b/) && tenderHas(/\b(?:informatica|informaticas|informatico|informaticos|servidor|datos|ethernet|wifi|router|switch)\b/)) return true;
  if (catalogHas(/\b(?:informatica|informaticas|informatico|informaticos|ethernet|wifi|router|switch|datos)\b/) && tenderHas(/\b(?:alcantarillado|red sanitaria|agua potable|aguas servidas)\b/)) return true;
  return false;
}

export function commercialIntentMatchesOffer(intent: CommercialIntent[], offerTypes: CommercialOfferType[]): boolean | null {
  if (!offerTypes.length || !intent.length) return null;
  return intent.some(item => offerTypes.includes(item.type));
}

export function commercialOfferTypeList(value: unknown): CommercialOfferType[] {
  let parsed = value;
  if (typeof value === 'string') { try { parsed = JSON.parse(value); } catch { return []; } }
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.filter((item): item is CommercialOfferType => typeof item === 'string' && commercialOfferTypes.includes(item as CommercialOfferType)))];
}

const canonicalAliases: Record<string, string> = {
  alimentacion: 'alimento', alimentario: 'alimento', alimentaria: 'alimento', alimentarios: 'alimento', alimentarias: 'alimento',
  alimenticio: 'alimento', alimenticia: 'alimento', alimenticios: 'alimento', alimenticias: 'alimento',
  gastronomica: 'gastronomico', gastronomicas: 'gastronomico', gastronomicos: 'gastronomico',
  equipamiento: 'equipo', equipamientos: 'equipo', maquina: 'maquinaria', maquinas: 'maquinaria',
};

export function normalizeCommercialText(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function canonicalCommercialWord(word: string): string {
  const alias = canonicalAliases[word];
  if (alias) return alias;
  if (word.length > 6 && word.endsWith('es')) return canonicalAliases[word.slice(0, -2)] ?? word.slice(0, -2);
  if (word.length > 5 && word.endsWith('s')) return canonicalAliases[word.slice(0, -1)] ?? word.slice(0, -1);
  return word;
}

export function commercialTerms(value: string, includeGeneric = false): string[] {
  return normalizeCommercialText(value).split(' ')
    .filter(word => word.length >= 3 && !stopWords.has(word) && (includeGeneric || !genericWords.has(word)))
    .map(canonicalCommercialWord);
}

// Variantes que aparecen en los títulos oficiales y que el prefiltrar SQL debe cubrir por prefijo.
const surfaceVariants: Record<string, string[]> = {
  alimento: ['alimento', 'alimentacion', 'alimentario', 'alimentaria', 'alimenticios'],
  equipo: ['equipo', 'equipamiento'],
  gastronomico: ['gastronomico', 'gastronomica'],
  maquinaria: ['maquinaria', 'maquina'],
  molino: ['molino', 'molienda'],
  prensa: ['prensa', 'prensado'],
};

export function commercialTermVariants(term: string): string[] {
  const canonical = canonicalCommercialWord(term);
  return [...new Set([canonical, ...(surfaceVariants[canonical] ?? [])])];
}

export function hasCommercialTerm(text: string, term: string): boolean {
  const haystack = new Set(normalizeCommercialText(text).split(' ').map(canonicalCommercialWord));
  const wanted = [...new Set(commercialTerms(term, true))];
  return wanted.length > 0 && wanted.every(word => haystack.has(word));
}

export function hasCommercialPhrase(text: string, phrase: string): boolean {
  const normalized = normalizeCommercialText(phrase);
  return normalized.length >= 5 && ` ${normalizeCommercialText(text)} `.includes(` ${normalized} `);
}

export function matchesCommercialExclusion(text: string, exclusion: string): boolean {
  const meaningfulTerms = commercialTerms(exclusion, true);
  if (!meaningfulTerms.length) return false;
  return meaningfulTerms.length > 1 ? hasCommercialPhrase(text, exclusion) : hasCommercialTerm(text, meaningfulTerms[0]);
}

// Nombres de parques y plazas usan «Los Molinos» como topónimo, no como equipo.
export function isKnownProductPlaceName(text: string, productText: string): boolean {
  const productTerms = new Set(commercialTerms(productText, true));
  if (productTerms.has('molino') && ['parque los molinos', 'plaza los molinos', 'borde costero los molinos'].some(phrase => hasCommercialPhrase(text, phrase))) return true;
  return productTerms.has('horno') && hasCommercialPhrase(text, 'caleta hornos');
}

export type CatalogMatchInput = {
  nombre: string;
  categoria?: string | null;
  palabrasClave?: string[];
  sinonimos?: string[];
  terminosRelacionados?: string[];
  aplicaciones?: string[];
  profileTerms?: string[];
};

export type CatalogMatch = {
  score: number;
  level: 'high' | 'medium' | 'exploratory';
  exactPhrase: boolean;
  matchedSources: string[];
  nameTerms: string[];
  weakTerms: string[];
  categoryHits: string[];
  keywordHits: string[];
  synonymHits: string[];
  relatedHits: string[];
  applicationHits: string[];
  profileHits: string[];
};

export function scoreCatalogMatch(product: CatalogMatchInput, title: string, description: string, items: string): CatalogMatch | null {
  const nameTerms = [...new Set(commercialTerms(product.nombre, true).filter(term => !nonSpecificProductNameTerms.has(term)))];
  if (!nameTerms.length) return null;
  // Términos que identifican un equipo concreto; los débiles solo corroboran.
  const specificNameTerms = nameTerms.filter(term => !weakNameTerms.has(term) && !commodityNameTerms.has(term));
  const weakNameTermsInName = nameTerms.filter(term => !specificNameTerms.includes(term));
  const sourceTexts = { title, description, items };

  const specificHits = (text: string) => specificNameTerms.filter(term => hasCommercialTerm(text, term));
  const titleNameHits = specificHits(title);
  const descriptionNameHits = specificHits(description);
  const itemNameHits = specificHits(items);
  const weakHits = (text: string) => weakNameTermsInName.filter(term => hasCommercialTerm(text, term));
  const weakTitleHits = weakHits(title);
  const weakDescriptionHits = weakHits(description);
  const weakItemHits = weakHits(items);
  const exactTitle = hasCommercialPhrase(title, product.nombre);
  const exactItems = hasCommercialPhrase(items, product.nombre);
  const exactDescription = hasCommercialPhrase(description, product.nombre);

  const hits = (values: string[] | undefined) => (values ?? []).filter(value => {
    const valueTerms = [...new Set(normalizeCommercialText(value).split(' ')
      .filter(word => word.length >= 3 && !stopWords.has(word))
      .map(canonicalCommercialWord))];
    if (!valueTerms.length) return false;
    // El valor debe aportar al menos un término concreto y todos sus términos deben aparecer en la misma fuente.
    const specificValueTerms = valueTerms.filter(term => !weakNameTerms.has(term) && !nonSpecificProductNameTerms.has(term) && !lowSpecificitySingleTerms.has(term));
    if (!specificValueTerms.length) return false;
    return Object.values(sourceTexts).some(text => valueTerms.every(term => hasCommercialTerm(text, term)));
  });
  const categoryHits = hits(product.categoria ? [product.categoria] : []);
  const keywordHits = hits(product.palabrasClave);
  const synonymHits = hits(product.sinonimos);
  const relatedHits = hits(product.terminosRelacionados);
  const applicationHits = hits(product.aplicaciones);
  const profileHits = hits(product.profileTerms);

  const directNameHits = [...new Set([...titleNameHits, ...descriptionNameHits, ...itemNameHits])];
  const corroboratingTerms = [...new Set([...categoryHits, ...keywordHits, ...synonymHits, ...relatedHits, ...applicationHits, ...profileHits].flatMap(value => commercialTerms(value)))];
  const independentSupport = corroboratingTerms.filter(term => !nameTerms.includes(term));
  const exploratoryEvidence = [...new Set([...relatedHits, ...applicationHits])];
  // Dos términos de rubro (p. ej. «equipos» + «alimentación») describen un
  // contexto, no una compra de maquinaria. Se exige evidencia de producto:
  // nombre concreto, palabra clave o sinónimo comercial validado.
  if (!directNameHits.length && !synonymHits.length && !keywordHits.length && !(exploratoryEvidence.length >= 2)) return null;

  const coverage = specificNameTerms.length ? directNameHits.length / specificNameTerms.length : 0;
  let score = exactTitle ? 94 : exactItems ? 90 : exactDescription ? 78 : 0;
  if (!score && titleNameHits.length) score = 50 + Math.round(25 * coverage);
  if (!score && itemNameHits.length) score = 46 + Math.round(24 * coverage);
  if (!score && descriptionNameHits.length) score = 38 + Math.round(22 * coverage);
  if (!score && synonymHits.length) score = 48;
  if (!score && keywordHits.length) score = 44;
  if (!score && exploratoryEvidence.length) score = 24 + Math.min(12, (exploratoryEvidence.length - 1) * 4);

  score += Math.min(12, independentSupport.length * 4);
  if (specificNameTerms.length > 1 && coverage > 0 && coverage <= 0.5) score = Math.min(score, 48);
  score = Math.min(100, score);

  const evidenceTerms = [...new Set([
    ...commercialTerms(product.nombre), ...commercialTerms(product.categoria ?? ''),
    ...(product.palabrasClave ?? []).flatMap(value => commercialTerms(value)),
    ...(product.sinonimos ?? []).flatMap(value => commercialTerms(value)),
    ...(product.terminosRelacionados ?? []).flatMap(value => commercialTerms(value)),
    ...(product.aplicaciones ?? []).flatMap(value => commercialTerms(value)),
    ...(product.profileTerms ?? []),
  ])];
  const matchedSources = [
    ...(exactTitle || evidenceTerms.some(term => hasCommercialTerm(title, term)) ? ['título'] : []),
    ...(exactDescription || evidenceTerms.some(term => hasCommercialTerm(description, term)) ? ['descripción oficial'] : []),
    ...(exactItems || evidenceTerms.some(term => hasCommercialTerm(items, term)) ? ['partidas indexadas'] : []),
  ];

  const fullTitleCoverage = specificNameTerms.length >= 2 && titleNameHits.length === specificNameTerms.length;
  const fullItemCoverage = specificNameTerms.length >= 2 && itemNameHits.length === specificNameTerms.length;
  const fullDescriptionCoverage = specificNameTerms.length >= 2 && descriptionNameHits.length === specificNameTerms.length;
  let level: CatalogMatch['level'];
  if (exactTitle || exactItems || (specificNameTerms.length === 1 && titleNameHits.length === 1 && !lowSpecificitySingleTerms.has(specificNameTerms[0]))) level = 'high';
  else if (fullTitleCoverage || (fullItemCoverage && score >= 70) || (fullDescriptionCoverage && score >= 80)) level = 'high';
  else if (directNameHits.length && coverage >= 0.5 && !(specificNameTerms.length === 1 && lowSpecificitySingleTerms.has(specificNameTerms[0]))) level = 'medium';
  else if (synonymHits.length || keywordHits.length) level = 'medium';
  else level = 'exploratory';

  return {
    score, level, exactPhrase: exactTitle || exactItems || exactDescription, matchedSources: [...new Set(matchedSources)],
    nameTerms: directNameHits, weakTerms: [...new Set([...weakTitleHits, ...weakItemHits, ...weakDescriptionHits])],
    categoryHits, keywordHits, synonymHits, relatedHits, applicationHits, profileHits,
  };
}

export function hasPromisingCatalogEvidence(match: CatalogMatch): boolean {
  const specific = (term: string) => !weakNameTerms.has(term) && !commodityNameTerms.has(term) && !lowSpecificitySingleTerms.has(term) && !nonSpecificProductNameTerms.has(term);
  if (match.exactPhrase) return true;
  if (match.nameTerms.some(specific)) return true;
  return [...match.keywordHits, ...match.synonymHits, ...match.relatedHits, ...match.applicationHits]
    .some(value => commercialTerms(value, true).some(specific));
}

export function findPromisingEnrichmentPhrase(match: CatalogMatch | null, product: CatalogMatchInput, title: string, description: string, items: string): string | null {
  if (match && hasPromisingCatalogEvidence(match)) {
    if (match.exactPhrase) return product.nombre;
    const specific = (term: string) => !weakNameTerms.has(term) && !commodityNameTerms.has(term) && !lowSpecificitySingleTerms.has(term) && !nonSpecificProductNameTerms.has(term);
    const evidence = [...match.nameTerms, ...match.keywordHits, ...match.synonymHits, ...match.relatedHits, ...match.applicationHits];
    return evidence.find(value => commercialTerms(value, true).some(specific)) ?? null;
  }
  const text = `${title} ${description} ${items}`;
  const equipmentAnchors = new Set(['molino','harina','coloidal','prensa','aceite','horno','lavavajilla','lavaloza','cocina','convector','rotatorio','harinero','oleaginosa','capota','tunel','ablandador']);
  const configuredPhrases = [...(product.palabrasClave ?? []), ...(product.sinonimos ?? [])];
  return configuredPhrases.find(phrase => {
    const terms = [...new Set(commercialTerms(phrase, true))];
    if (terms.length < 2 || !terms.some(term => equipmentAnchors.has(term))) return false;
    const matched = terms.filter(term => hasCommercialTerm(text, term));
    return matched.length >= 2 && matched.some(term => equipmentAnchors.has(term));
  }) ?? null;
}

export function parseExplicitExclusions(query: string): string[] {
  const exclusions: string[] = [];
  const marker = /\b(?:sin|excepto|excluyendo|excluir|excluye|no incluir|no quiero|evitar)\s+([^,;.!?]+)/giu;
  for (const match of query.matchAll(marker)) {
    const phrase = match[1].split(/\b(?:pero|para|desde|hasta|en|con)\b/i)[0].trim();
    for (const part of phrase.split(/\b(?:ni|y)\b/i)) {
      const tokens = commercialTerms(part, true).slice(0, 4);
      if (tokens.length) exclusions.push(tokens.join(' '));
    }
  }
  return [...new Set(exclusions)];
}

export function literalQueryTerms(query: string): string[] {
  return [...new Set(normalizeCommercialText(removeExplicitExclusionPhrases(query)).split(' ')
    .filter(word => word.length > 2 && !stopWords.has(word) && !/^\d+$/.test(word))
    .map(canonicalCommercialWord))].slice(0, 10);
}

export function removeExplicitExclusionPhrases(query: string): string {
  return query.replace(/\b(?:sin|excepto|excluyendo|excluir|excluye|no incluir|no quiero|evitar)\s+[^,;.!?]+/giu, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function searchAmbiguityHint(query: string): string | null {
  const meaningful = commercialTerms(query);
  if (meaningful.length === 1 && ['molino','alimento','medico','laboratorio','mantencion'].includes(meaningful[0])) {
    return 'Búsqueda amplia: agrega producto, servicio o aplicación para ordenar mejor las coincidencias.';
  }
  if (!meaningful.length) return 'Consulta ambigua: describe un producto o servicio concreto para obtener resultados útiles.';
  return null;
}
