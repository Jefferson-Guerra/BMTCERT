const { execFile } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { generatePfx } = require('./pfxBuilder');

/**
 * Verifica si "keytool" está disponible en el PATH del sistema.
 */
function checkKeytoolAvailable() {
  return new Promise(resolve => {
    execFile('keytool', ['-help'], error => {
      resolve(!error);
    });
  });
}

/**
 * Genera un archivo .jks a partir del certificado + llave + cadena.
 * Estrategia: se genera primero un .p12/.pfx temporal (con node-forge, sin
 * dependencias externas) y luego se usa "keytool -importkeystore" para
 * convertirlo a formato JKS, ya que no existe una librería JS estable y
 * mantenida para escribir JKS de forma nativa.
 *
 * Requiere tener el JDK instalado (keytool disponible en el PATH).
 */
async function generateJks({ certPem, keyPem, chainCerts, alias, password, outputPath }) {
  const available = await checkKeytoolAvailable();
  if (!available) {
    throw new Error(
      'No se encontró "keytool" en el sistema. Instala el JDK (Java Development Kit) ' +
      'y asegúrate de que "keytool" esté disponible en el PATH para poder generar archivos .jks.'
    );
  }

  const tmpPfx = path.join(os.tmpdir(), `tmp_${Date.now()}.p12`);
  const tmpPassword = password; // usamos la misma contraseña para el p12 temporal

  generatePfx({
    certPem,
    keyPem,
    chainCerts,
    alias,
    password: tmpPassword,
    outputPath: tmpPfx
  });

  // Si ya existe un destino, keytool -importkeystore falla; lo eliminamos primero
  if (fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
  }

  await new Promise((resolve, reject) => {
    execFile(
      'keytool',
      [
        '-importkeystore',
        '-srckeystore', tmpPfx,
        '-srcstoretype', 'PKCS12',
        '-srcstorepass', tmpPassword,
        '-srcalias', alias,
        '-destkeystore', outputPath,
        '-deststoretype', 'JKS',
        '-deststorepass', password,
        '-destalias', alias,
        '-noprompt'
      ],
      (error, stdout, stderr) => {
        // Limpieza del pfx temporal sin importar el resultado
        try { fs.unlinkSync(tmpPfx); } catch (e) { /* noop */ }

        if (error) {
          reject(new Error(`Error al generar JKS con keytool: ${stderr || error.message}`));
        } else {
          resolve();
        }
      }
    );
  });

  return outputPath;
}

module.exports = { generateJks, checkKeytoolAvailable };
