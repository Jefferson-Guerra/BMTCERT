const fs = require('fs');

/**
 * Almacén simple de certificados Intermediarios/Raíces guardados por el
 * usuario. Se persiste como un archivo JSON en storePath (la ruta la decide
 * quien llama a estas funciones - ver main.js: getIntermediariosStorePath()).
 *
 * IMPORTANTE: a propósito NO se guarda en la carpeta de datos de usuario
 * (userData), porque esa carpeta es distinta en cada máquina y por lo tanto
 * NO viaja cuando se comparte el .exe con otras personas. En cambio, se
 * guarda dentro de la propia carpeta de la app (ver main.js), para que lo
 * que agregues durante el desarrollo quede incluido cuando generes el
 * instalador con "npm run dist" y se lo compartas a tus compañeros.
 *
 * Cada registro tiene la forma:
 * {
 *   id: string,
 *   emitidoPor: string,   // Título 1
 *   emitidoPara: string,  // Título 2
 *   fechaInicio: string,  // Título 3
 *   fechaFin: string,     // Título 4
 *   nota: string,         // Título 5 (opcional)
 *   tipo: 'Intermediario' | 'Raíz',
 *   pem: string           // contenido completo del certificado (.crt)
 * }
 */

function readStore(storePath) {
  try {
    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function writeStore(storePath, list) {
  fs.writeFileSync(storePath, JSON.stringify(list, null, 2), 'utf8');
}

function addRecord(storePath, record) {
  const list = readStore(storePath);
  const newRecord = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    ...record
  };
  list.push(newRecord);
  writeStore(storePath, list);
  return list;
}

function deleteRecords(storePath, ids) {
  const list = readStore(storePath).filter(item => !ids.includes(item.id));
  writeStore(storePath, list);
  return list;
}

/**
 * Normaliza una etiqueta (Emisor/Titular) para compararla: quita espacios
 * al inicio/final, colapsa espacios múltiples y no distingue mayúsculas.
 * Esto evita que la cadena falle en silencio por una diferencia mínima de
 * formato entre lo guardado en "Intermediarios" y lo leído del certificado.
 */
function normalizeLabel(s) {
  return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Arma la cadena de confianza (intermedios + root) para un certificado hoja,
 * siguiendo los eslabones guardados en este almacén: busca quién emitió al
 * emisor del certificado, y sigue subiendo hasta llegar a un registro
 * marcado como "Raíz" (o hasta un certificado autofirmado, donde
 * emitidoPor === emitidoPara).
 *
 * @param {string} issuerLabel - el "Emisor (CA)" del certificado hoja (issuerCN)
 * @param {Array}  list - la lista completa del almacén (readStore(...))
 * @returns {{chain: Array<{pem: string, fileName: string|null}>, completa: boolean}}
 *   chain: arreglo en orden (intermedio(s) primero, root al final), cada uno
 *   con su PEM y su nombre de archivo ORIGINAL (el que tenía el .crt cuando
 *   se agregó en "Intermediarios"), para que al exportar se conserve el
 *   mismo nombre en vez de uno genérico.
 *   completa: true si se llegó hasta una Raíz; false si quedó cortada
 *   (falta agregar algún eslabón en "Intermediarios")
 */
function resolveChain(issuerLabel, list, maxHops = 8) {
  const chain = [];
  const used = new Set();
  let currentIssuer = issuerLabel;
  let completa = false;

  for (let hop = 0; hop < maxHops; hop++) {
    const match = list.find(
      item => normalizeLabel(item.emitidoPara) === normalizeLabel(currentIssuer) && !used.has(item.id)
    );
    if (!match) break;

    used.add(match.id);
    chain.push({ pem: match.pem, fileName: match.nombreArchivo || null });

    const esRaiz = match.tipo === 'Raíz' || normalizeLabel(match.emitidoPor) === normalizeLabel(match.emitidoPara);
    if (esRaiz) {
      completa = true;
      break;
    }
    currentIssuer = match.emitidoPor;
  }

  return { chain, completa };
}

module.exports = { readStore, writeStore, addRecord, deleteRecords, resolveChain };
