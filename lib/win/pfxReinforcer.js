const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Reproduce en Windows el flujo manual de "reforzar" un PFX:
 *
 *  1) Instala el .pfx en el almacén "Equipo local > Personal" marcando
 *     la clave privada como EXPORTABLE (equivale a tildar la casilla
 *     "Marcar esta clave como exportable" del asistente de Windows).
 *  2) Vuelve a exportar ese certificado ya instalado a un .pfx nuevo,
 *     incluyendo toda la cadena de certificación (equivale a "Exportar
 *     la clave privada" + incluir la ruta de certificación).
 *  3) Borra el .pfx original y deja solo el nuevo, con sufijo "_1"
 *     en el nombre (tal como se hace a mano).
 *
 * Usa los cmdlets oficiales de PowerShell (módulo PKI, incluido en
 * Windows 10 / Server 2012 R2 en adelante): Import-PfxCertificate y
 * Export-PfxCertificate. Requiere privilegios de administrador, por lo
 * que se solicitará una ventana de UAC.
 *
 * LIMITACIÓN CONOCIDA: el asistente gráfico de Windows tiene dos
 * casillas extra ("Exportar todas las propiedades extendidas" y
 * "Habilitar privacidad del certificado") que no tienen un parámetro
 * equivalente expuesto en estos cmdlets de PowerShell. Este proceso
 * automatiza la parte funcionalmente relevante (clave exportable +
 * cadena completa incluida), pero si en tu caso específico necesitas
 * esas dos opciones exactas, ese paso final tocaría seguir haciéndolo
 * a mano desde "certlm.msc" tal como lo hacías antes.
 */
function reinforcePfxWindows({ pfxPath, password }) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('Esta función solo está disponible en Windows.'));
      return;
    }

    const parsed = path.parse(pfxPath);
    const outputPath = path.join(parsed.dir, `${parsed.name}_1${parsed.ext}`);
    const stamp = Date.now();
    const scriptPath = path.join(os.tmpdir(), `bmtcert_reinforce_${stamp}.ps1`);
    const logPath = path.join(os.tmpdir(), `bmtcert_reinforce_${stamp}.log`);

    const psScript = [
      'param(',
      '  [string]$PfxPath,',
      '  [string]$Password,',
      '  [string]$OutputPath,',
      '  [string]$LogPath',
      ')',
      'try {',
      '  $securePwd = ConvertTo-SecureString -String $Password -Force -AsPlainText',
      '  $cert = Import-PfxCertificate -FilePath $PfxPath -CertStoreLocation Cert:\\LocalMachine\\My -Password $securePwd -Exportable',
      '  Export-PfxCertificate -Cert $cert -FilePath $OutputPath -Password $securePwd -ChainOption BuildChain | Out-Null',
      '  Remove-Item -Path ("Cert:\\LocalMachine\\My\\" + $cert.Thumbprint) -Force',
      '  "OK" | Out-File -FilePath $LogPath -Encoding utf8',
      '} catch {',
      '  ("ERROR: " + $_.Exception.Message) | Out-File -FilePath $LogPath -Encoding utf8',
      '}'
    ].join('\r\n');

    fs.writeFileSync(scriptPath, psScript, 'utf8');

    const innerArgs =
      `-NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" ` +
      `-PfxPath "${pfxPath}" -Password "${password}" -OutputPath "${outputPath}" -LogPath "${logPath}"`;

    // Se lanza un segundo powershell elevado (UAC) porque instalar en
    // "Equipo local" requiere privilegios de administrador.
    const outerCommand =
      `Start-Process -FilePath powershell.exe -Verb RunAs -Wait -ArgumentList '${innerArgs.replace(/'/g, "''")}'`;

    execFile('powershell.exe', ['-NoProfile', '-Command', outerCommand], () => {
      let logContent = '';
      try {
        logContent = fs.readFileSync(logPath, 'utf8').trim();
      } catch (e) {
        // No se generó log: probablemente se canceló la ventana de UAC.
      }

      try { fs.unlinkSync(scriptPath); } catch (e) { /* noop */ }
      try { fs.unlinkSync(logPath); } catch (e) { /* noop */ }

      if (!logContent) {
        reject(new Error('No se completó el proceso (¿se canceló la ventana de permisos de administrador?).'));
        return;
      }
      if (logContent.startsWith('ERROR')) {
        reject(new Error(logContent));
        return;
      }
      if (!fs.existsSync(outputPath)) {
        reject(new Error('El proceso terminó pero no se encontró el archivo reexportado.'));
        return;
      }

      try {
        fs.unlinkSync(pfxPath); // se elimina el pfx original, solo queda el nuevo
      } catch (e) {
        // no es crítico si no se pudo borrar
      }

      resolve(outputPath);
    });
  });
}

module.exports = { reinforcePfxWindows };
