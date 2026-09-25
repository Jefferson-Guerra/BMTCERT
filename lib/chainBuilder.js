const fs = require('fs');
const path = require('path');
const { CHAINS } = require('./chains');

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
 * Construye chain.crt (intermedio1 + intermedio2 + root)
 * y certificado_completo.crt (cert hoja + intermedio1 + intermedio2 + root)
 * según el tipo de validación detectado (DV/OV/EV)
 */
function buildChains(leafCertPem, tipoValidacion) {
  const tipo = (tipoValidacion || '').toUpperCase();
  const chainData = CHAINS[tipo];
  if (!chainData) {
    throw new Error(
      `No se reconoce el tipo de validación "${tipoValidacion}". Se esperaba DV, OV o EV.`
    );
  }

  const chainCrt = concatPem(chainData.inter1, chainData.inter2, chainData.root);
  const certificadoCompleto = concatPem(
    leafCertPem,
    chainData.inter1,
    chainData.inter2,
    chainData.root
  );

  return { chainCrt, certificadoCompleto };
}

/**
 * Exporta las carpetas Nginx y/o Apache dentro de targetDir, y SIEMPRE
 * genera además la carpeta "Intermediate & Root" con los certificados
 * individuales (sin concatenar) correspondientes al tipo DV/OV/EV detectado.
 *
 * Intermediate & Root/ -> intermediate1.crt, intermediate2.crt, root.crt
 * Nginx/  -> certificado_completo.crt, <dominio>.key
 * Apache/ -> chain.crt, <dominio>.crt, <dominio>.key
 */
function exportServerFolders({
  targetDir,
  leafCertPem,
  keyPem,
  tipoValidacion,
  domain,
  includeApache,
  includeNginx
}) {
  const tipo = (tipoValidacion || '').toUpperCase();
  const chainData = CHAINS[tipo];
  if (!chainData) {
    throw new Error(
      `No se reconoce el tipo de validación "${tipoValidacion}". Se esperaba DV, OV o EV.`
    );
  }

  const { chainCrt, certificadoCompleto } = buildChains(leafCertPem, tipoValidacion);
  const safeDomain = (domain || 'certificado').replace(/[^a-zA-Z0-9.\-_*]/g, '_');
  const created = [];

  // "Intermediate & Root": se genera siempre, independientemente de si se
  // exporta para Apache y/o Nginx, ya que sirve como referencia general.
  const intermediateDir = path.join(targetDir, 'Intermediate & Root');
  fs.mkdirSync(intermediateDir, { recursive: true });
  fs.writeFileSync(path.join(intermediateDir, 'intermediate1.crt'), normalizePem(chainData.inter1), 'utf8');
  fs.writeFileSync(path.join(intermediateDir, 'intermediate2.crt'), normalizePem(chainData.inter2), 'utf8');
  fs.writeFileSync(path.join(intermediateDir, 'root.crt'), normalizePem(chainData.root), 'utf8');
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
