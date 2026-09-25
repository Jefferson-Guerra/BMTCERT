const { parseCertificatePem, parsePrivateKeyPem, parseCsrPem } = require('./certParser');

/**
 * Compara si un certificado .crt y una llave privada .key corresponden al mismo par
 * comparando el módulo (n) de la clave pública del certificado contra el módulo
 * de la llave privada. Si coinciden, forman un par válido.
 */
function validateCertAndKey(certPem, keyPem) {
  const certInfo = parseCertificatePem(certPem);
  const keyInfo = parsePrivateKeyPem(keyPem);

  const coincide =
    !!certInfo.modulus && !!keyInfo.modulus && certInfo.modulus === keyInfo.modulus;

  return {
    coincide,
    certModulusPreview: certInfo.modulus ? certInfo.modulus.slice(0, 16) + '...' : null,
    keyModulusPreview: keyInfo.modulus ? keyInfo.modulus.slice(0, 16) + '...' : null,
    commonName: certInfo.commonName
  };
}

/**
 * Compara si un CSR .csr y un certificado .crt corresponden al mismo par
 * comparando el módulo de la clave pública de ambos.
 */
function validateCsrAndCert(csrPem, certPem) {
  const csrInfo = parseCsrPem(csrPem);
  const certInfo = parseCertificatePem(certPem);

  const coincide =
    !!csrInfo.modulus && !!certInfo.modulus && csrInfo.modulus === certInfo.modulus;

  return {
    coincide,
    csrModulusPreview: csrInfo.modulus ? csrInfo.modulus.slice(0, 16) + '...' : null,
    certModulusPreview: certInfo.modulus ? certInfo.modulus.slice(0, 16) + '...' : null,
    csrCommonName: csrInfo.commonName,
    certCommonName: certInfo.commonName
  };
}

/**
 * Compara si un CSR .csr y una llave privada .key corresponden al mismo par
 * comparando el módulo de la clave pública de ambos.
 */
function validateCsrAndKey(csrPem, keyPem) {
  const csrInfo = parseCsrPem(csrPem);
  const keyInfo = parsePrivateKeyPem(keyPem);

  const coincide =
    !!csrInfo.modulus && !!keyInfo.modulus && csrInfo.modulus === keyInfo.modulus;

  return {
    coincide,
    csrModulusPreview: csrInfo.modulus ? csrInfo.modulus.slice(0, 16) + '...' : null,
    keyModulusPreview: keyInfo.modulus ? keyInfo.modulus.slice(0, 16) + '...' : null,
    csrCommonName: csrInfo.commonName
  };
}

module.exports = { validateCertAndKey, validateCsrAndCert, validateCsrAndKey };
