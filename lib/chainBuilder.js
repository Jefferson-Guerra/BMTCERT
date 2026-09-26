const fs = require('fs');
const path = require('path');

/** Asegura que un bloque PEM termine exactamente en un salto de línea */
function normalizePem(pem) {
  return pem.trim() + '\n';
}

/**
 * Concatena certificados uno tras otro, sin líneas en blanco extra entre ellos.
 */
function concatPem(...blocks) {
  return blocks.map(normalizePem).join('');
}

/**
 * Construye chain.crt (intermedio(s) + root) y certificado_completo.crt
 * (cert hoja + intermedio(s) + root) a partir de una cadena de certificados
 * YA RESUELTA (ver main.js: resolveChainCerts()), la cual puede venir de:
 *  - los intermediarios/root que el usuario agregó en "Intermediarios", o
 *  - las cadenas DV/OV/EV de Sectigo que vienen integradas de fábrica.
 *
 * @param {string} leafCertPem
 * @param {Array<{pem: string, fileName: string|null}>} chainCerts - en orden:
 *   intermedio(s) primero, root al final
 */
function buildChains(leafCertPem, chainCerts) {
  if (!chainCerts || chainCerts.length === 0) {
    throw new Error(
      'No se encontró una cadena de intermedios/root para este certificado. ' +
      'Agrégala en la sección "Intermediarios".'
    );
  }

  const pems = chainCerts.map(c => c.pem);
  const chainCrt = concatPem(...pems);
  const certificadoCompleto = concatPem(leafCertPem, ...pems);

  return { chainCrt, certificadoCompleto };
}

/**
 * Da un nombre de archivo único y válido para escribir en disco, usando
 * el nombre ORIGINAL que tenía el .crt cuando se agregó en "Intermediarios"
 * (para que el usuario reconozca el mismo archivo que subió). Si un eslabón
 * no tiene nombre guardado (por ejemplo viene de la cadena Sectigo integrada
 * de una versión anterior, o algo raro), se usa un nombre genérico de
 * respaldo, igual que antes.
 */
function resolveFileNames(chainCerts) {
  const used = new Set();
  return chainCerts.map((entry, index) => {
    const isLast = index === chainCerts.length - 1;
    let fileName = entry.fileName && entry.fileName.trim()
      ? entry.fileName.trim()
      : (isLast ? 'root.crt' : `intermediate${index + 1}.crt`);

    if (!/\.(crt|cer|pem)$/i.test(fileName)) fileName += '.crt';

    // Evita sobrescribir si dos eslabones terminaran con el mismo nombre
    let finalName = fileName;
    let suffix = 2;
    while (used.has(finalName.toLowerCase())) {
      const dot = fileName.lastIndexOf('.');
      finalName = dot === -1 ? `${fileName}_${suffix}` : `${fileName.slice(0, dot)}_${suffix}${fileName.slice(dot)}`;
      suffix++;
    }
    used.add(finalName.toLowerCase());
    return finalName;
  });
}

/**
 * Exporta las carpetas Nginx y/o Apache dentro de targetDir, y SIEMPRE
 * genera además la carpeta "Intermediate & Root" con los certificados
 * individuales (sin concatenar), usando el nombre de archivo ORIGINAL de
 * cada uno (el que tenían al agregarlos en "Intermediarios").
 *
 * Intermediate & Root/ -> <nombre original 1>.crt, <nombre original 2>.crt (...), <nombre original root>.crt
 * Nginx/  -> certificado_completo.crt, <dominio>.key
 * Apache/ -> chain.crt, <dominio>.crt, <dominio>.key
 */
function exportServerFolders({
  targetDir,
  leafCertPem,
  keyPem,
  chainCerts,
  domain,
  includeApache,
  includeNginx
}) {
  const { chainCrt, certificadoCompleto } = buildChains(leafCertPem, chainCerts);
  const safeDomain = (domain || 'certificado').replace(/[^a-zA-Z0-9.\-_*]/g, '_');
  const created = [];

  // "Intermediate & Root": se genera siempre, independientemente de si se
  // exporta para Apache y/o Nginx. Cada archivo se guarda con su nombre
  // original (o uno genérico de respaldo si no se conserva ese dato).
  const intermediateDir = path.join(targetDir, 'Intermediate & Root');
  fs.mkdirSync(intermediateDir, { recursive: true });
  const fileNames = resolveFileNames(chainCerts);
  chainCerts.forEach((entry, index) => {
    fs.writeFileSync(path.join(intermediateDir, fileNames[index]), normalizePem(entry.pem), 'utf8');
  });
  created.push(intermediateDir);

  if (includeNginx) {
    const nginxDir = path.join(targetDir, 'Nginx');
    fs.mkdirSync(nginxDir, { recursive: true });
    fs.writeFileSync(path.join(nginxDir, 'certificado_completo.crt'), certificadoCompleto, 'utf8');
    fs.writeFileSync(path.join(nginxDir, `${safeDomain}.key`), normalizePem(keyPem), 'utf8');
    created.push(nginxDir);
  }

  if (includeApache) {
    const apacheDir = path.join(targetDir, 'Apache');
    fs.mkdirSync(apacheDir, { recursive: true });
    fs.writeFileSync(path.join(apacheDir, 'chain.crt'), chainCrt, 'utf8');
    fs.writeFileSync(path.join(apacheDir, `${safeDomain}.crt`), normalizePem(leafCertPem), 'utf8');
    fs.writeFileSync(path.join(apacheDir, `${safeDomain}.key`), normalizePem(keyPem), 'utf8');
    created.push(apacheDir);
  }

  return created;
}

module.exports = { buildChains, exportServerFolders, concatPem, normalizePem };
