const forge = require('node-forge');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { parseCertificatePem, parseCsrPem } = require('./certParser');

function formatDateLong(d) {
  if (!d) return null;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/** Formatea el resultado de un certificado ya parseado al formato de salida solicitado */
function formatCertOutput(info) {
  const lines = [];
  lines.push('Certificate Information:');
  lines.push(`Common Name: ${info.commonName || '-'}`);
  lines.push(`Subject Alternative Names: ${(info.sanList || []).join(', ') || '-'}`);
  lines.push(`Organization: ${info.organization || ''}`);
  lines.push(`Organization Unit: ${info.organizationUnit || ''}`);
  lines.push(`Locality: ${info.locality || ''}`);
  lines.push(`State: ${info.state || ''}`);
  lines.push(`Country: ${info.country || ''}`);
  lines.push(`Valid From: ${formatDateLong(info.validFrom)}`);
  lines.push(`Valid To: ${formatDateLong(info.validTo)}`);
  lines.push(`Issuer: ${info.issuerCN || ''}${info.issuerO ? ', ' + info.issuerO : ''}`);
  lines.push(`Serial Number: ${info.serialNumber || ''}`);
  return lines.join('\n');
}

function decodeCrt(pem) {
  const info = parseCertificatePem(pem);
  return formatCertOutput(info);
}

function decodeCsr(pem) {
  const csrInfo = parseCsrPem(pem);
  const csr = csrInfo.raw;
  const attrs = csr.subject.attributes;
  const get = shortName => {
    const a = attrs.find(x => x.shortName === shortName);
    return a ? a.value : '';
  };

  let sanList = [];
  const sanAttr = (csr.attributes || []).find(a => a.name === 'extensionRequest');
  if (sanAttr) {
    const sanExt = (sanAttr.extensions || []).find(e => e.name === 'subjectAltName');
    if (sanExt && sanExt.altNames) {
      sanList = sanExt.altNames.filter(a => a.type === 2).map(a => a.value);
    }
  }

  const lines = [];
  lines.push('CSR Information:');
  lines.push(`Common Name: ${get('CN') || '-'}`);
  lines.push(`Subject Alternative Names: ${sanList.join(', ') || '-'}`);
  lines.push(`Organization: ${get('O')}`);
  lines.push(`Organization Unit: ${get('OU')}`);
  lines.push(`Locality: ${get('L')}`);
  lines.push(`State: ${get('ST')}`);
  lines.push(`Country: ${get('C')}`);
  return lines.join('\n');
}

/** Decodifica un .pfx dado su buffer binario y contraseña */
function decodePfx(buffer, password) {
  const der = forge.util.createBuffer(buffer.toString('binary'));
  const asn1 = forge.asn1.fromDer(der);
  let p12;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch (e) {
    throw new Error('No se pudo abrir el .pfx. Verifica que la contraseña sea correcta.');
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const bagArray = certBags[forge.pki.oids.certBag] || [];
  if (bagArray.length === 0) {
    throw new Error('El archivo .pfx no contiene certificados.');
  }

  // El primer certificado suele ser el certificado hoja (con clave privada asociada)
  const leafBag = bagArray.find(b => {
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    return keyBags && Object.keys(keyBags).length > 0;
  }) || bagArray[0];

  const certPem = forge.pki.certificateToPem(leafBag.cert);
  return decodeCrt(certPem);
}

/** Decodifica un .jks usando keytool (requiere JDK) */
function decodeJks(filePath, password) {
  return new Promise((resolve, reject) => {
    // Primero listamos los alias disponibles
    execFile(
      'keytool',
      ['-list', '-v', '-keystore', filePath, '-storepass', password],
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              'No se pudo leer el .jks. Verifica la contraseña y que "keytool" (JDK) esté instalado. ' +
                (stderr || error.message)
            )
          );
          return;
        }

        const aliasMatch = stdout.match(/Alias name:\s*(.+)/);
        if (!aliasMatch) {
          reject(new Error('No se encontraron alias en el keystore .jks.'));
          return;
        }
        const alias = aliasMatch[1].trim();

        const tmpPem = path.join(os.tmpdir(), `tmp_${Date.now()}.pem`);
        execFile(
          'keytool',
          [
            '-exportcert',
            '-alias', alias,
            '-keystore', filePath,
            '-storepass', password,
            '-rfc',
            '-file', tmpPem
          ],
          (err2, stdout2, stderr2) => {
            if (err2) {
              reject(new Error(`No se pudo exportar el certificado del .jks: ${stderr2 || err2.message}`));
              return;
            }
            try {
              const pem = fs.readFileSync(tmpPem, 'utf8');
              fs.unlinkSync(tmpPem);
              resolve(decodeCrt(pem));
            } catch (e) {
              reject(e);
            }
          }
        );
      }
    );
  });
}

module.exports = { decodeCrt, decodeCsr, decodePfx, decodeJks };
