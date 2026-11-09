import assert from 'node:assert/strict';
import pool from '../src/db.js';
import { classifyCommercialIntent } from '../src/commercialMatching.js';

const authorizedCodes = ['1057898-110-LE26', '2107-172-LE26'];

try {
  for (const code of authorizedCodes) {
    const [rows] = await pool.query<any[]>(
      `SELECT l.nombre title,COALESCE(JSON_UNQUOTE(JSON_EXTRACT(l.payload_json,'$.Descripcion')),'') description,
         COALESCE((SELECT GROUP_CONCAT(DISTINCT CONCAT_WS(' ',i.nombre,i.descripcion,i.categoria,i.search_text) SEPARATOR ' ')
           FROM licitacion_items i WHERE i.codigo_externo=l.codigo_externo),'') items
       FROM licitaciones l WHERE l.codigo_externo=? LIMIT 1`,
      [code],
    );
    assert.ok(rows[0], `Expected local listing ${code} to exist.`);
    const intents = classifyCommercialIntent(rows[0].title, rows[0].description, rows[0].items);
    assert.ok(intents.some(intent => intent.type === 'product_supply'), `${code} must retain its explicit acquisition/supply intent.`);
    assert.equal(intents.some(intent => intent.type === 'service'), false, `${code} must not classify the buyer's institutional name as a purchased service.`);
  }

  const combined = classifyCommercialIntent('Suministro e instalación de lavavajillas industrial');
  assert.ok(combined.some(intent => intent.type === 'product_supply'));
  assert.ok(combined.some(intent => intent.type === 'installation'));
  const realService = classifyCommercialIntent('Servicio de mantención preventiva de ascensores');
  assert.ok(realService.some(intent => intent.type === 'service'));
  console.log('PASS local pilot regression: both official purchase listings exclude institutional “servicio” mentions; explicit service and combined supply/installation remain classified.');
} finally {
  await pool.end();
}
