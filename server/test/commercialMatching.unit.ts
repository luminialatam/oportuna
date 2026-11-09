import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  hasCommercialTerm,
  classifyCommercialIntent,
  commercialIntentMatchesOffer,
  hasCatalogDomainConflict,
  isKnownProductPlaceName,
  literalQueryTerms,
  matchesCommercialExclusion,
  parseExplicitExclusions,
  scoreCatalogMatch,
  searchAmbiguityHint,
} from '../src/commercialMatching.js';

const pendones = scoreCatalogMatch(
  { nombre: 'Pendones', sinonimos: ['banner publicitario'] },
  'SERVICIOS DE IMPRESIÓN DE PENDONES INFORMATIVOS',
  '',
  '',
);
assert.ok(pendones);
assert.equal(pendones.level, 'high');
assert.equal(pendones.score, 94);
assert.ok(pendones.matchedSources.includes('título'));
// Título oficial reportado para la ficha 609-29-LE26.
const pendonesPartida = scoreCatalogMatch(
  { nombre: 'Pendones' }, '', '', 'Impresión de pendones informativos',
);
assert.equal(pendonesPartida?.level, 'high');
assert.ok(pendonesPartida?.matchedSources.includes('partidas indexadas'));

const singularAgainstPlural = scoreCatalogMatch(
  { nombre: 'Pendón' }, 'SERVICIOS DE IMPRESIÓN DE PENDONES INFORMATIVOS', '', '',
);
assert.equal(singularAgainstPlural?.level, 'high');
assert.equal(hasCommercialTerm('Compra de mantequilla de maní', 'mantequilla de mani'), true);

const synonym = scoreCatalogMatch(
  { nombre: 'Pendones', sinonimos: ['banner publicitario'] },
  'Adquisición de banner publicitario', '', '',
);
assert.equal(synonym?.level, 'medium');
assert.ok(synonym?.matchedSources.includes('título'));

const exclusionQuery = 'Molinos industriales para alimentos sin minería ni cobre';
assert.deepEqual(parseExplicitExclusions(exclusionQuery), ['mineria', 'cobre']);
assert.deepEqual(literalQueryTerms('Pendones sin maquinaria minera'), ['pendon']);

const foodCatalog = {
  nombre: 'Molinos industriales para alimentos',
  sinonimos: ['molienda alimentaria'],
  terminosRelacionados: ['procesamiento de alimentos'],
};
const foodListing = scoreCatalogMatch(foodCatalog, 'Molino para procesamiento de alimentos', '', '');
assert.ok(foodListing, 'direct food equipment evidence should match');
// Fase 3.7: «alimentos», «equipos» y «procesamiento» ya no crean coincidencias por sí solos.
const genericFoodProduct = { nombre: 'Equipos de procesamiento de alimentos', categoria: 'Maquinaria alimentaria', palabrasClave: ['procesamiento de alimentos'], sinonimos: ['equipos para producción de alimentos'], terminosRelacionados: ['líneas de proceso alimentario'], aplicaciones: ['producción alimentaria'], profileTerms: ['alimento'] };
assert.equal(scoreCatalogMatch(genericFoodProduct, 'Cajas de alimentos subvencionadas', '', ''), null, 'a generic food mention cannot be a machinery match');
assert.equal(scoreCatalogMatch(genericFoodProduct, 'Servidor de procesamiento de alto rendimiento', '', ''), null, 'a generic process mention cannot be a machinery match');
assert.equal(scoreCatalogMatch(genericFoodProduct, 'Adquisición de indumentaria para el equipo ejecutor', '', ''), null, 'a generic equipment mention cannot be a machinery match');
const foodServiceEquipment = scoreCatalogMatch(genericFoodProduct, 'Equipamiento para servicio de alimentación', '', '');
assert.equal(foodServiceEquipment, null, 'generic equipment and food-service context alone must not qualify as a machinery opportunity.');
const keywordOnly = scoreCatalogMatch({ nombre: 'Equipamiento gastronómico', palabrasClave: ['horno combinado'] }, 'ADQUISICIÓN HORNO ELÉCTRICO COMBINADO Y ACCESORIOS', '', '');
assert.equal(keywordOnly?.level, 'medium', 'a specific commercial keyword can rank a real equipment purchase as medium.');
const commodityOnly = scoreCatalogMatch({ nombre: 'Prensas de aceite', palabrasClave: ['prensa de aceite'] }, 'SUMINISTRO DE MEDIOS DE CONTRASTE Y ACEITE ADORMECEDOR', '', '');
assert.equal(commodityOnly, null, 'a commodity word alone cannot identify a press.');
const technicalService = { nombre: 'Servicio técnico de equipos gastronómicos', categoria: 'Servicio técnico', palabrasClave: ['mantención horno industrial', 'reparación lavavajillas industrial'] };
assert.equal(scoreCatalogMatch(technicalService, 'Servicios de personal técnicos administrativos de apoyo', '', ''), null, 'the generic word «técnico» must not make unrelated staffing services a match.');
assert.equal(scoreCatalogMatch(technicalService, 'Producción audiovisual y apoyo técnico expo 2026', '', ''), null, 'the generic word «técnico» must not make audiovisual production a match.');
const explicitServiceMatch = scoreCatalogMatch(technicalService, 'Servicio de mantención y reparación de lavavajillas industrial', '', '');
assert.equal(explicitServiceMatch?.level, 'medium', 'a technical service remains eligible when the listing names the specific appliance and work.');
assert.equal(scoreCatalogMatch({ nombre: 'Equipos de redes informáticas' }, 'Construcción extensión redes de alcantarillado y agua potable', '', ''), null, 'a public sewer network must not match IT networking from the broad word «red».');
assert.equal(scoreCatalogMatch({ nombre: 'Centrífugas de laboratorio' }, 'Soporte de sistema de gestión de laboratorio clínico', '', ''), null, 'a laboratory software service must not match lab equipment from the sector word alone.');
assert.equal(scoreCatalogMatch({ nombre: 'Camas clínicas eléctricas' }, 'Adquisición de ropa de cama hospitalaria', '', ''), null, 'hospital bedding must not match clinical beds from «cama» alone.');
assert.equal(scoreCatalogMatch({ nombre: 'Instalaciones eléctricas de edificios' }, 'Consultoría diseño arquitectura y estructuras de edificio', '', ''), null, 'building design must not match electrical installation from «edificio» alone.');
assert.ok(scoreCatalogMatch({ nombre: 'Equipos de redes informáticas' }, 'Adquisición de equipos de redes informáticas', '', '')?.level === 'high', 'an exact networking title remains a high match after weakening broad terms.');
const ovenCatalog = { nombre: 'Horno eléctrico combinado industrial', palabrasClave: ['horno combinado', 'horno convector industrial'] };
assert.equal(scoreCatalogMatch(ovenCatalog, 'Adquisición de materiales eléctricos', '', ''), null, 'electrical supplies must not match an oven from «eléctrico» alone.');
assert.ok(scoreCatalogMatch(ovenCatalog, 'Adquisición horno eléctrico combinado y accesorios', '', ''), 'specific oven evidence must remain eligible.');
const refrigerationCatalog = { nombre: 'Refrigerador y cámara frigorífica comercial' };
assert.equal(scoreCatalogMatch(refrigerationCatalog, 'Adquisición de cámara retinal portátil', '', ''), null, 'a medical camera must not match refrigeration from «cámara» alone.');
assert.ok(scoreCatalogMatch(refrigerationCatalog, 'Mantención preventiva para cámaras frigoríficas', '', ''), 'specific refrigeration evidence must remain eligible.');
const waterSoftenerCatalog = { nombre: 'Ablandador de agua para lavavajillas', palabrasClave: ['ablandador de agua', 'suavizador de agua industrial'] };
assert.equal(scoreCatalogMatch(waterSoftenerCatalog, 'Suministro de agua potable', '', ''), null, 'water supply must not match a water softener from «agua» alone.');
assert.ok(scoreCatalogMatch(waterSoftenerCatalog, 'Adquisición ablandador de agua industrial', '', ''), 'specific softener evidence must remain eligible.');

// Historical positive control: commercial compatibility is independent of current open-tender eligibility.
const historicalDishwasherCatalog = {
  nombre: 'Lavavajillas industriales', categoria: 'Equipos lavado cocina',
  palabrasClave: ['lavavajillas industrial capota', 'lavavajillas de túnel', 'lavalozas industrial'],
  sinonimos: ['máquina lavavajillas comercial'], terminosRelacionados: ['lavado vajilla alto volumen'],
  aplicaciones: ['cocinas institucionales'], exclusiones: ['arriendo de maquinaria'],
};
const historicalDishwasher = scoreCatalogMatch(
  historicalDishwasherCatalog,
  'LAVAVAJILLAS INDUSTRIAL MÁS ABLANDADOR DE AGUA II',
  'La adquisición de lavajillas para el Hospital de Urgencia Asistencia Pública',
  'Lavaplatos de uso comercial LAVAVAJILLAS INDUSTRIAL + ABLANDADOR DE AGUA POTABLE',
);
assert.equal(historicalDishwasher?.level, 'high', 'the closed 2111-335-LE26 tender remains a commercial-compatibility positive control.');
assert.ok(classifyCommercialIntent('LAVAVAJILLAS INDUSTRIAL MÁS ABLANDADOR DE AGUA II', 'La adquisición de lavajillas para el Hospital de Urgencia Asistencia Pública').some(item => item.type === 'product_supply'), 'the historical control contains explicit purchase evidence.');
const oilPressCatalog = { nombre: 'Prensa expeller para aceite vegetal', palabrasClave: ['prensa de aceite', 'expeller'] };
assert.equal(scoreCatalogMatch(oilPressCatalog, 'Retiro de material vegetal', '', ''), null, 'plant matter must not match an oil press from «vegetal» alone.');
assert.ok(scoreCatalogMatch(oilPressCatalog, 'Adquisición de prensa expeller para aceite vegetal', '', ''), 'specific oil-press evidence must remain eligible.');
const specificFoodMachine = scoreCatalogMatch({ nombre: 'Molinos coloidales industriales', categoria: 'Maquinaria alimentaria', palabrasClave: ['procesamiento de alimentos'] }, 'Adquisición de molino coloidal para alimentos', '', '');
assert.equal(specificFoodMachine?.level, 'high', 'Specific equipment and process evidence should rank above a generic food mention.');
const gastronomicProduct = { nombre: 'Equipamiento gastronómico', categoria: 'Equipamiento para cocinas y comedores', palabrasClave: ['horno combinado', 'lavavajillas industrial'] };
const officialOven = scoreCatalogMatch(gastronomicProduct,
  'ADQUISICIÓN HORNO ELÉCTRICO COMBINADO Y ACCESORIOS',
  'Se requiere adquirir un horno eléctrico combinado profesional de convección y vapor.',
  'Hornos de convección de uso comercial; cantidad 1');
assert.equal(officialOven?.level, 'medium', 'More official fields must corroborate a specific appliance without automatically promoting the match to high.');
assert.equal(officialOven?.exactPhrase, false);
const officialDishwasher = scoreCatalogMatch(gastronomicProduct,
  'LAVAVAJILLAS INDUSTRIAL MÁS ABLANDADOR DE AGUA II',
  'La adquisición de lavajillas para un hospital.',
  'Lavaplatos de uso comercial; lavavajillas industrial más ablandador de agua potable; cantidad 2');
assert.equal(officialDishwasher?.level, 'medium', 'A matching commercial category and item details keep the opportunity medium absent an exact catalog-name hit.');
assert.equal(officialDishwasher?.exactPhrase, false);
assert.equal(hasCommercialTerm('Servicio de alimentación institucional', 'alimentos'), true, 'alimentación and alimento share the same commercial concept.');
assert.equal(hasCommercialTerm('Adquisición de equipamiento de cocina', 'equipos de cocina'), true, 'equipamiento and equipo share the same commercial concept.');
assert.equal(hasCommercialTerm('Oferta gastronómica', 'gastronomico'), true, 'gastronomía inflections must collapse to one concept.');
const miningListing = scoreCatalogMatch(foodCatalog, 'Adquisición de maquinaria para procesamiento minero', '', '');
assert.equal(miningListing, null, 'shared generic words must not classify mining equipment as food equipment');
assert.equal(matchesCommercialExclusion('Mejoramiento Plaza Los Molinos', 'plaza los molinos'), true);
assert.equal(isKnownProductPlaceName('Mejoramiento Paseo Parque Los Molinos Curaco de Vélez', 'Molino coloidal industrial'), true);
assert.equal(isKnownProductPlaceName('Adquisición de molinos industriales para harina', 'Molino industrial para alimentos'), false, 'Real mill equipment must remain eligible.');
assert.equal(isKnownProductPlaceName('Caleta Hornos, Región de Atacama', 'Horno combinado industrial'), true);
assert.equal(isKnownProductPlaceName('Compra de hornos combinados industriales', 'Horno combinado industrial'), false, 'Real oven equipment must remain eligible.');
assert.equal(matchesCommercialExclusion('Adquisición de molinos para harina', 'plaza los molinos'), false, 'A location phrase exclusion must not remove real mill opportunities.');
assert.equal(matchesCommercialExclusion('Molino para chancado de minerales', 'minerales'), true);
assert.equal(matchesCommercialExclusion('Equipos mineros para procesamiento de mineral', 'minero'), true);
const medicalCatalog = scoreCatalogMatch({ nombre: 'Equipamiento médico' }, 'Impresión de pendones informativos', '', '');
assert.equal(medicalCatalog, null, 'a separate catalog must not match unrelated listing text');

const ovenIntent = classifyCommercialIntent('Adquisición de horno eléctrico combinado y accesorios');
assert.ok(ovenIntent.some(item => item.type === 'product_supply' && item.source === 'título'));
const combinedIntent = classifyCommercialIntent('Suministro e instalación de hornos industriales');
assert.ok(combinedIntent.some(item => item.type === 'product_supply') && combinedIntent.some(item => item.type === 'installation'), 'combined supply and installation must retain both intents');
const serviceIntent = classifyCommercialIntent('Servicio de mantención preventiva de edificios institucionales');
assert.ok(serviceIntent.some(item => item.type === 'service') && serviceIntent.some(item => item.type === 'maintenance_repair'));
assert.ok(classifyCommercialIntent('Arriendo de equipamiento gastronómico').some(item => item.type === 'rental'));
assert.ok(classifyCommercialIntent('Construcción de obras civiles').some(item => item.type === 'construction'));
assert.deepEqual(classifyCommercialIntent('Servidores para montaje en rack 1U'), [], 'rack-mount compatibility is not an installation service');
const genericInfrastructureMaintenance = scoreCatalogMatch({ nombre: 'Mantención de edificios', palabrasClave: ['mantención edificio institucional'], sinonimos: ['reparación de infraestructura'] }, 'Mantención reparación integral de infraestructura', '', '');
assert.ok(genericInfrastructureMaintenance?.level === 'exploratory', 'A generic infrastructure mention cannot confirm a building maintenance match.');
assert.deepEqual(classifyCommercialIntent('Servicios y equipos para actividades institucionales'), [], 'generic words without an object do not classify intent');
assert.deepEqual(classifyCommercialIntent('Horno combinado'), [], 'a bare product title cannot determine procurement modality');
assert.equal(commercialIntentMatchesOffer(ovenIntent, ['maintenance_repair']), false);
assert.equal(commercialIntentMatchesOffer([], ['product_supply']), null);
assert.equal(hasCatalogDomainConflict('Mantención de edificios', 'Servicio de mantención de vehículos'), true);
assert.equal(hasCatalogDomainConflict('Equipos de redes informáticas', 'Construcción de redes de alcantarillado'), true);
assert.equal(hasCatalogDomainConflict('Camas clínicas eléctricas', 'Adquisición de ropa de cama hospitalaria'), true);
assert.equal(hasCatalogDomainConflict('Bodegaje comercial', 'Almacenamiento de servidores'), true);
assert.equal(hasCatalogDomainConflict('Hornos industriales para alimentos', 'Adquisición de hornos industriales'), false);
assert.equal(hasCatalogDomainConflict('Hornos industriales para alimentos', 'Adquisición pan y empanadas de horno'), true);

assert.ok(searchAmbiguityHint('equipamiento'));
assert.equal(searchAmbiguityHint('mantequilla de maní'), null);

const companyService = readFileSync(new URL('../src/companyService.ts', import.meta.url), 'utf8');
assert.match(companyService, /currentCompanyContext\(\)/);
assert.match(companyService, /commercial_profiles WHERE company_id=\?/);
assert.match(companyService, /company_search_preferences WHERE company_id=\?/);
assert.match(companyService, /company_products WHERE company_id=\? AND activo=1/);
assert.match(companyService, /exclusiones,tipos_comerciales FROM company_products WHERE company_id=\? AND activo=1/);

console.log('PASS exact title, accents/plurals, validated synonyms, explicit exclusions, ambiguous queries, mining false-positive guard and company-scoped match reads.');
