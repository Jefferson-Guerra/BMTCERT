const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const { parseCertificatePem, parsePrivateKeyPem, parseCsrPem } = require('./lib/certParser');
const { exportServerFolders } = require('./lib/chainBuilder');
const { generatePfx } = require('./lib/pfxBuilder');
const { generateJks } = require('./lib/jksBuilder');
const { validateCertAndKey, validateCsrAndCert, validateCsrAndKey } = require('./lib/validator');
const { decodeCrt, decodeCsr, decodePfx, decodeJks } = require('./lib/decoder');
const { reinforcePfxWindows } = require('./lib/win/pfxReinforcer');
const intermediariosStore = require('./lib/intermediariosStore');
const { CHAINS } = require('./lib/chains');

/**
 * Decide qué cadena de intermedios/root usar para un certificado, en este orden:
 *
 *  1) Busca en "Intermediarios" (lo que el usuario agregó manualmente),
 *     siguiendo el emisor del certificado hasta llegar a una Raíz. Esto
 *     funciona para CUALQUIER CA (DigiCert, RapidSSL, Sectigo, etc.),
 *     siempre que el usuario haya subido esos intermedios/root ahí.
 *  2) Si no encuentra nada (o el usuario todavía no cargó esos
 *     intermediarios), y el certificado es DV/OV/EV de Sectigo, usa las
 *     cadenas que vienen integradas de fábrica en la app.
 *  3) Si la búsqueda en "Intermediarios" encontró ALGO pero está
 *     incompleta (no llegó hasta la Raíz), se devuelve igual esa cadena
 *     parcial con una advertencia, en vez de fallar directamente.
 */
function resolveChainCerts({ issuerCN, tipoValidacion }) {
  const store = intermediariosStore.readStore(getIntermediariosStorePath());
  const resolved = intermediariosStore.resolveChain(issuerCN, store);

  if (resolved.completa) {
    return { chainCerts: resolved.chain, source: 'intermediarios' };
  }

  const tipo = (tipoValidacion || '').toUpperCase();
  const chainData = CHAINS[tipo];
  if (chainData) {
    return {
      chainCerts: [
        { pem: chainData.inter1, fileName: 'intermediate1.crt' },
        { pem: chainData.inter2, fileName: 'intermediate2.crt' },
        { pem: chainData.root, fileName: 'root.crt' }
      ],
      source: 'sectigo-integrada'
    };
  }

  if (resolved.chain.length > 0) {
    return { chainCerts: resolved.chain, source: 'intermediarios-incompleta' };
  }

  return { chainCerts: [], source: 'ninguna' };
}

/**
 * Calcula la ruta del archivo intermediarios.json.
 *
 * - En desarrollo (npm start): usa la carpeta "data" DENTRO del proyecto,
 *   para que lo que agregues quede en el código fuente y viaje cuando
 *   generes el instalador con "npm run dist".
 * - Ya empaquetada (el .exe que reciben tus compañeros): usa la copia de
 *   "data" que quedó incluida en los recursos de la app (fuera del .asar,
 *   ver "asarUnpack" en package.json), así que sigue siendo editable en
 *   cada máquina pero YA viene con lo que tú agregaste al compartirla.
 */
function getIntermediariosStorePath() {
  const dataDir = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'data')
    : path.join(__dirname, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, 'intermediarios.json');
}

/** Escribe un Clave.txt junto al archivo generado (pfx o jks) con la contraseña usada */
function writeClaveTxt(outputPath, password) {
  const dir = path.dirname(outputPath);
  fs.writeFileSync(path.join(dir, 'Clave.txt'), `Clave: ${password}\n`, 'utf8');
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------- Lectura de archivos ----------

ipcMain.handle('read-text-file', async (event, filePath) => {
  return fs.readFileSync(filePath, 'utf8');
});

ipcMain.handle('read-binary-file-base64', async (event, filePath) => {
  const buf = fs.readFileSync(filePath);
  return buf.toString('base64');
});

// ---------- Parseo / info principal ----------

ipcMain.handle('parse-certificate', async (event, certPem) => {
  try {
    const info = parseCertificatePem(certPem);
    return {
      ok: true,
      data: {
        commonName: info.commonName,
        tipoValidacion: info.tipoValidacion,
        issuerCN: info.issuerCN,
        issuerO: info.issuerO,
        validFromStr: info.validFromStr,
        validToStr: info.validToStr,
        estado: info.estado,
        sanList: info.sanList,
        organization: info.organization
      }
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('validate-key-matches-cert', async (event, { certPem, keyPem }) => {
  try {
    parsePrivateKeyPem(keyPem); // valida que la llave sea legible
    const result = validateCertAndKey(certPem, keyPem);
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---------- Exportar Nginx / Apache ----------

ipcMain.handle('select-export-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('export-server-folders', async (event, params) => {
  try {
    const { chainCerts, source } = resolveChainCerts(params);
    if (chainCerts.length === 0) {
      return {
        ok: false,
        error: `No se encontró la cadena de intermedios/root para el emisor "${params.issuerCN || '-'}". ` +
          'Agrega el intermediario y root correspondientes en la sección "Intermediarios" y vuelve a intentar.'
      };
    }
    const created = exportServerFolders({ ...params, chainCerts });
    const warning = source === 'intermediarios-incompleta'
      ? ' ⚠️ La cadena está incompleta: agrega el eslabón que falta hasta llegar a la Raíz en "Intermediarios".'
      : '';
    return { ok: true, created, chainSource: source, warning };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---------- Exportar PFX ----------

ipcMain.handle('select-save-path', async (event, { defaultName, filters }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

ipcMain.handle('export-pfx', async (event, params) => {
  try {
    const { chainCerts, source } = resolveChainCerts(params);
    if (chainCerts.length === 0) {
      return {
        ok: false,
        error: `No se encontró la cadena de intermedios/root para el emisor "${params.issuerCN || '-'}". ` +
          'Agrega el intermediario y root correspondientes en la sección "Intermediarios" y vuelve a intentar.'
      };
    }

    const { targetDir, alias } = params;
    const pfxDir = path.join(targetDir, 'PFX');
    fs.mkdirSync(pfxDir, { recursive: true });
    const outputPath = path.join(pfxDir, `${alias}.pfx`);

    generatePfx({ ...params, chainCerts, outputPath });
    writeClaveTxt(outputPath, params.password);

    const warning = source === 'intermediarios-incompleta'
      ? ' ⚠️ La cadena está incompleta: agrega el eslabón que falta hasta llegar a la Raíz en "Intermediarios".'
      : '';
    return { ok: true, path: outputPath, chainSource: source, warning };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---------- Exportar JKS ----------

ipcMain.handle('export-jks', async (event, params) => {
  try {
    const { chainCerts, source } = resolveChainCerts(params);
    if (chainCerts.length === 0) {
      return {
        ok: false,
        error: `No se encontró la cadena de intermedios/root para el emisor "${params.issuerCN || '-'}". ` +
          'Agrega el intermediario y root correspondientes en la sección "Intermediarios" y vuelve a intentar.'
      };
    }

    const { targetDir, alias } = params;
    const jksDir = path.join(targetDir, 'JKS');
    fs.mkdirSync(jksDir, { recursive: true });
    const outputPath = path.join(jksDir, `${alias}.jks`);

    await generateJks({ ...params, chainCerts, outputPath });
    writeClaveTxt(outputPath, params.password);

    const warning = source === 'intermediarios-incompleta'
      ? ' ⚠️ La cadena está incompleta: agrega el eslabón que falta hasta llegar a la Raíz en "Intermediarios".'
      : '';
    return { ok: true, path: outputPath, chainSource: source, warning };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---------- Reforzar PFX en Windows (instalar en el almacén + reexportar) ----------

ipcMain.handle('reinforce-pfx-windows', async (event, { pfxPath, password }) => {
  try {
    const newPath = await reinforcePfxWindows({ pfxPath, password });
    return { ok: true, path: newPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---------- Decodificador ----------

ipcMain.handle('decode-crt', async (event, pem) => {
  try {
    return { ok: true, text: decodeCrt(pem) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('decode-csr', async (event, pem) => {
  try {
    return { ok: true, text: decodeCsr(pem) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('decode-pfx', async (event, { base64, password }) => {
  try {
    const buf = Buffer.from(base64, 'base64');
    return { ok: true, text: decodePfx(buf, password) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('decode-jks', async (event, { filePath, password }) => {
  try {
    const text = await decodeJks(filePath, password);
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---------- Validacion de igualdad ----------

ipcMain.handle('validate-cert-key-pair', async (event, { certPem, keyPem }) => {
  try {
    const result = validateCertAndKey(certPem, keyPem);
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('validate-csr-cert-pair', async (event, { csrPem, certPem }) => {
  try {
    const result = validateCsrAndCert(csrPem, certPem);
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('validate-csr-key-pair', async (event, { csrPem, keyPem }) => {
  try {
    const result = validateCsrAndKey(csrPem, keyPem);
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---------- Intermediarios / Raíces (almacén propio de la app) ----------

ipcMain.handle('intermediarios-list', async () => {
  try {
    const list = intermediariosStore.readStore(getIntermediariosStorePath());
    return { ok: true, list };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('select-crt-file-for-inter', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Certificados', extensions: ['crt', 'cer', 'pem'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('parse-intermediario-file', async (event, filePath) => {
  try {
    const pem = fs.readFileSync(filePath, 'utf8');
    const info = parseCertificatePem(pem);

    const emitidoPor = info.issuerCN || info.issuerO || '-';
    const emitidoPara = info.commonName || info.organization || '-';
    // Si el emisor y el titular son el mismo, es un certificado autofirmado -> Raíz
    const tipoSugerido = emitidoPor === emitidoPara ? 'Raíz' : 'Intermediario';

    return {
      ok: true,
      data: {
        emitidoPor,
        emitidoPara,
        fechaInicio: info.validFromStr,
        fechaFin: info.validToStr,
        tipoSugerido,
        nombreArchivo: path.basename(filePath),
        pem
      }
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('save-intermediario', async (event, record) => {
  try {
    const list = intermediariosStore.addRecord(getIntermediariosStorePath(), record);
    return { ok: true, list };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('delete-intermediarios', async (event, ids) => {
  try {
    const list = intermediariosStore.deleteRecords(getIntermediariosStorePath(), ids);
    return { ok: true, list };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});