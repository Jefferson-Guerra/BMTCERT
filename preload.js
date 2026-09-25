const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,

  readTextFile: filePath => ipcRenderer.invoke('read-text-file', filePath),
  readBinaryFileBase64: filePath => ipcRenderer.invoke('read-binary-file-base64', filePath),

  parseCertificate: certPem => ipcRenderer.invoke('parse-certificate', certPem),
  validateKeyMatchesCert: (certPem, keyPem) =>
    ipcRenderer.invoke('validate-key-matches-cert', { certPem, keyPem }),

  selectExportDirectory: () => ipcRenderer.invoke('select-export-directory'),
  exportServerFolders: params => ipcRenderer.invoke('export-server-folders', params),

  selectSavePath: (defaultName, filters) =>
    ipcRenderer.invoke('select-save-path', { defaultName, filters }),
  exportPfx: params => ipcRenderer.invoke('export-pfx', params),
  exportJks: params => ipcRenderer.invoke('export-jks', params),
  reinforcePfxWindows: (pfxPath, password) =>
    ipcRenderer.invoke('reinforce-pfx-windows', { pfxPath, password }),

  decodeCrt: pem => ipcRenderer.invoke('decode-crt', pem),
  decodeCsr: pem => ipcRenderer.invoke('decode-csr', pem),
  decodePfx: (base64, password) => ipcRenderer.invoke('decode-pfx', { base64, password }),
  decodeJks: (filePath, password) => ipcRenderer.invoke('decode-jks', { filePath, password }),

  validateCertKeyPair: (certPem, keyPem) =>
    ipcRenderer.invoke('validate-cert-key-pair', { certPem, keyPem }),
  validateCsrCertPair: (csrPem, certPem) =>
    ipcRenderer.invoke('validate-csr-cert-pair', { csrPem, certPem }),
  validateCsrKeyPair: (csrPem, keyPem) =>
    ipcRenderer.invoke('validate-csr-key-pair', { csrPem, keyPem }),

  listIntermediarios: () => ipcRenderer.invoke('intermediarios-list'),
  selectCrtFileForInter: () => ipcRenderer.invoke('select-crt-file-for-inter'),
  parseIntermediarioFile: filePath => ipcRenderer.invoke('parse-intermediario-file', filePath),
  saveIntermediario: record => ipcRenderer.invoke('save-intermediario', record),
  deleteIntermediarios: ids => ipcRenderer.invoke('delete-intermediarios', ids)
});
