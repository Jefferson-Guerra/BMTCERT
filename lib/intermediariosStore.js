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

module.exports = { readStore, writeStore, addRecord, deleteRecords };
