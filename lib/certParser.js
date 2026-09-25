const forge = require('node-forge');
const { detectTypeFromIssuerCN } = require('./chains');

function getAttrValue(attrs, shortName) {
  const a = attrs.find(x => x.shortName === shortName || x.name === shortName);
  return a ? a.value : null;
}

function formatDate(d) {
  if (!d) return null;
  const opts = { year: 'numeric', month: 'long', day: 'numeric' };
  return d.toLocaleDateString('es-ES', opts);
}

/**
 * Parsea un certificado PEM (.crt) y devuelve la info estructurada
 * que pide la pantalla principal + la que pide el decodificador.
 */
function parseCertificatePem(pem) {
  const cert = forge.pki.certificateFromPem(pem);

  const subjectAttrs = cert.subject.attributes;
  const issuerAttrs = cert.issuer.attributes;

  const cn = getAttrValue(subjectAttrs, 'CN');
  const org = getAttrValue(subjectAttrs, 'O');
  const ou = getAttrValue(subjectAttrs, 'OU');
  const locality = getAttrValue(subjectAttrs, 'L');
  const state = getAttrValue(subjectAttrs, 'ST');
  const country = getAttrValue(subjectAttrs, 'C');

  const issuerCN = getAttrValue(issuerAttrs, 'CN');
  const issuerO = getAttrValue(issuerAttrs, 'O');

  // SAN
  let sanList = [];
  const sanExt = cert.extensions.find(e => e.name === 'subjectAltName');
  if (sanExt && sanExt.altNames) {
    sanList = sanExt.altNames
      .filter(a => a.type === 2 || a.type === 7) // DNS o IP
      .map(a => a.value);
  }

  const validFrom = cert.validity.notBefore;
  const validTo = cert.validity.notAfter;
  const now = new Date();

  let estado = 'Válido';
  if (now < validFrom) estado = 'Aún no vigente';
  else if (now > validTo) estado = 'Expirado';
  else {
    const diasRestantes = Math.ceil((validTo - now) / (1000 * 60 * 60 * 24));
    if (diasRestantes <= 30) estado = `Vigente (expira en ${diasRestantes} días)`;
    else estado = 'Vigente';
  }

  const tipo = detectTypeFromIssuerCN(issuerCN) || 'Desconocido';

  const serial = cert.serialNumber
    .replace(/^0+/, '')
    .toLowerCase();

  return {
    commonName: cn,
    sanList,
    organization: org,
    organizationUnit: ou,
    locality,
    state,
    country,
    validFrom,
    validTo,
    validFromStr: formatDate(validFrom),
    validToStr: formatDate(validTo),
    estado,
    tipoValidacion: tipo, // DV / OV / EV / Desconocido
    issuerCN,
    issuerO,
    serialNumber: serial,
    modulus: cert.publicKey.n ? cert.publicKey.n.toString(16) : null,
    raw: cert
  };
}

/**
 * Parsea una llave privada PEM (.key) y devuelve su modulo (para comparar con el cert)
 */
function parsePrivateKeyPem(pem) {
  let key;
  try {
    key = forge.pki.privateKeyFromPem(pem);
  } catch (e) {
    // intentar como PKCS8 encriptado sin password no soportado aqui;
    // se asume llave sin passphrase, formato PKCS1 o PKCS8 plano
    throw new Error('No se pudo leer la llave privada. ¿Está encriptada con contraseña?');
  }
  return {
    modulus: key.n ? key.n.toString(16) : null,
    raw: key
  };
}

/**
 * Parsea un CSR (.csr) y devuelve su modulo + CN
 */
function parseCsrPem(pem) {
  const csr = forge.pki.certificationRequestFromPem(pem);
  const cn = getAttrValue(csr.subject.attributes, 'CN');
  return {
    commonName: cn,
    modulus: csr.publicKey.n ? csr.publicKey.n.toString(16) : null,
    raw: csr
  };
}

module.exports = {
  parseCertificatePem,
  parsePrivateKeyPem,
  parseCsrPem
};
