const forge = require('node-forge');
const fs = require('fs');

/**
 * Genera un archivo .pfx (PKCS#12) a partir del certificado, la llave privada
 * y la cadena de confianza YA RESUELTA (ver main.js: resolveChainCerts()),
 * la cual puede venir de los intermediarios/root que el usuario agregó en
 * "Intermediarios", o de las cadenas DV/OV/EV de Sectigo integradas de fábrica.
 *
 * @param {Object} opts
 * @param {string} opts.certPem
 * @param {string} opts.keyPem
 * @param {Array<{pem: string, fileName: string|null}>} opts.chainCerts - en orden: intermedio(s), luego root
 * @param {string} opts.alias - friendlyName / alias del certificado dentro del pfx
 * @param {string} opts.password - contraseña de protección del pfx
 * @param {string} opts.outputPath - ruta completa donde se guardará el .pfx
 */
function generatePfx({ certPem, keyPem, chainCerts, alias, password, outputPath }) {
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);

  const certChain = [cert, ...(chainCerts || []).map(entry => forge.pki.certificateFromPem(entry.pem))];

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(key, certChain, password, {
    friendlyName: alias,
    algorithm: '3des'
  });

  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  const buffer = Buffer.from(p12Der, 'binary');
  fs.writeFileSync(outputPath, buffer);

  return outputPath;
}

module.exports = { generatePfx };
