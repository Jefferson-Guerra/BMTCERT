// ============ Navegación entre vistas ============
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.view).classList.add('active');
  });
});

// ============ Utilidad genérica de drag & drop ============
function setupDropzone(el, onFile) {
  el.addEventListener('dragover', e => {
    e.preventDefault();
    el.classList.add('dragover');
  });
  el.addEventListener('dragleave', () => el.classList.remove('dragover'));
  el.addEventListener('drop', async e => {
    e.preventDefault();
    el.classList.remove('dragover');
    if (!e.dataTransfer.files.length) return;
    const file = e.dataTransfer.files[0];
    await onFile(file, el);
  });
  el.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async () => {
      if (input.files.length) await onFile(input.files[0], el);
    };
    input.click();
  });
}

function extOf(filename) {
  const parts = filename.toLowerCase().split('.');
  return '.' + parts[parts.length - 1];
}

function showStatus(el, message, ok) {
  el.textContent = message;
  el.className = 'status-msg ' + (ok ? 'ok' : 'error');
}

// =====================================================================
// VISTA 1: CARGAR CERTIFICADO
// =====================================================================

const state = {
  certPem: null,
  keyPem: null,
  certInfo: null,
  keyMatch: null, // null = aún no verificado, true = coinciden, false = no coinciden
  lastPfxPath: null,
  lastPfxPassword: null
};

function refreshExportButtons() {
  const ready = !!(state.certPem && state.keyPem && state.certInfo && state.keyMatch === true);
  document.getElementById('btnExportServer').disabled = !ready;
  document.getElementById('btnExportPfx').disabled = !ready || !document.getElementById('chkPfx').checked;
  document.getElementById('btnExportJks').disabled = !ready || !document.getElementById('chkJks').checked;
}

async function checkCertKeyMatch() {
  const statusEl = document.getElementById('certKeyMatchStatus');

  if (!state.certPem || !state.keyPem) {
    state.keyMatch = null;
    statusEl.textContent = '';
    statusEl.className = 'result-badge';
    refreshExportButtons();
    return;
  }

  statusEl.textContent = 'Verificando que el certificado y la llave coincidan...';
  statusEl.className = 'result-badge';

  const result = await window.api.validateKeyMatchesCert(state.certPem, state.keyPem);

  if (!result.ok) {
    state.keyMatch = false;
    statusEl.className = 'result-badge error';
    statusEl.textContent = '❌ El certificado y la llave no coinciden.';
  } else if (result.data.coincide) {
    state.keyMatch = true;
    statusEl.className = 'result-badge ok';
    statusEl.textContent = '✅ El certificado y la llave coinciden.';
  } else {
    state.keyMatch = false;
    statusEl.className = 'result-badge error';
    statusEl.textContent = '❌ El certificado y la llave NO coinciden. Verifica que sean del mismo par antes de exportar.';
  }

  refreshExportButtons();
}

setupDropzone(document.getElementById('dropCrt'), async (file, el) => {
  const pem = await window.api.readTextFile(file.path);
  state.certPem = pem;
  state.keyMatch = null;
  document.getElementById('dropCrtName').textContent = file.name;
  el.classList.add('loaded');

  const result = await window.api.parseCertificate(pem);
  if (result.ok) {
    state.certInfo = result.data;
    document.getElementById('certInfoBox').style.display = 'block';
    document.getElementById('infoCN').textContent = result.data.commonName || '-';
    document.getElementById('infoTipo').textContent = result.data.tipoValidacion || '-';
    document.getElementById('infoCA').textContent =
      (result.data.issuerCN || '') + (result.data.issuerO ? ', ' + result.data.issuerO : '');
    document.getElementById('infoDesde').textContent = result.data.validFromStr || '-';
    document.getElementById('infoHasta').textContent = result.data.validToStr || '-';
    document.getElementById('infoEstado').textContent = result.data.estado || '-';

    // "Nombre de Organización" solo aplica a certificados OV y EV (los DV no la incluyen)
    const rowOrganizacion = document.getElementById('rowOrganizacion');
    const tipo = (result.data.tipoValidacion || '').toUpperCase();
    if ((tipo === 'OV' || tipo === 'EV') && result.data.organization) {
      document.getElementById('infoOrganizacion').textContent = result.data.organization;
      rowOrganizacion.style.display = '';
    } else {
      rowOrganizacion.style.display = 'none';
    }

    // Prellenar alias PFX/JKS con el dominio si está en modo predeterminado editable
    const domainSafe = (result.data.commonName || 'dominio').replace(/\*\./g, '').replace(/[^a-zA-Z0-9.-]/g, '_');
    document.getElementById('pfxAlias').value = `${domainSafe}_2026`;
  } else {
    alert('Error al leer el certificado: ' + result.error);
  }
  await checkCertKeyMatch();
});

setupDropzone(document.getElementById('dropKey'), async (file, el) => {
  const pem = await window.api.readTextFile(file.path);
  state.keyPem = pem;
  state.keyMatch = null;
  document.getElementById('dropKeyName').textContent = file.name;
  el.classList.add('loaded');
  await checkCertKeyMatch();
});

// ---- Exportar Nginx / Apache ----
document.getElementById('btnExportServer').addEventListener('click', async () => {
  const includeApache = document.getElementById('chkApache').checked;
  const includeNginx = document.getElementById('chkNginx').checked;
  const statusEl = document.getElementById('serverExportStatus');

  if (!includeApache && !includeNginx) {
    showStatus(statusEl, 'Selecciona al menos Apache o Nginx.', false);
    return;
  }

  const targetDir = await window.api.selectExportDirectory();
  if (!targetDir) return;

  const domain = (state.certInfo.commonName || 'certificado').replace(/\*/g, 'wildcard');

  const result = await window.api.exportServerFolders({
    targetDir,
    leafCertPem: state.certPem,
    keyPem: state.keyPem,
    tipoValidacion: state.certInfo.tipoValidacion,
    domain,
    includeApache,
    includeNginx
  });

  if (result.ok) {
    showStatus(statusEl, 'Exportado correctamente en: ' + result.created.join(', '), true);
  } else {
    showStatus(statusEl, 'Error: ' + result.error, false);
  }
});

// ---- PFX ----
document.getElementById('chkPfx').addEventListener('change', refreshExportButtons);
document.getElementById('chkPfxDefault').addEventListener('change', e => {
  const disabled = e.target.checked;
  document.getElementById('pfxAlias').disabled = disabled;
  document.getElementById('pfxPassword').disabled = disabled;
  if (disabled) {
    const domainSafe = state.certInfo
      ? (state.certInfo.commonName || 'dominio').replace(/\*\./g, '').replace(/[^a-zA-Z0-9.-]/g, '_')
      : 'dominio';
    document.getElementById('pfxAlias').value = `${domainSafe}_2026`;
    document.getElementById('pfxPassword').value = '123456';
  }
});

document.getElementById('btnExportPfx').addEventListener('click', async () => {
  const alias = document.getElementById('pfxAlias').value.trim() || 'dominio_2026';
  const password = document.getElementById('pfxPassword').value || '123456';
  const statusEl = document.getElementById('pfxExportStatus');
  const reinforceBtn = document.getElementById('btnReinforcePfx');
  const reinforceStatusEl = document.getElementById('pfxReinforceStatus');

  const targetDir = await window.api.selectExportDirectory();
  if (!targetDir) return;

  reinforceBtn.style.display = 'none';
  reinforceStatusEl.textContent = '';

  const result = await window.api.exportPfx({
    certPem: state.certPem,
    keyPem: state.keyPem,
    tipoValidacion: state.certInfo.tipoValidacion,
    alias,
    password,
    targetDir
  });

  if (result.ok) {
    showStatus(statusEl, 'PFX generado en: ' + result.path, true);
    state.lastPfxPath = result.path;
    state.lastPfxPassword = password;
    if (window.api.platform === 'win32') {
      reinforceBtn.style.display = 'inline-block';
    }
  } else {
    showStatus(statusEl, 'Error: ' + result.error, false);
  }
});

document.getElementById('btnReinforcePfx').addEventListener('click', async () => {
  const statusEl = document.getElementById('pfxReinforceStatus');
  if (!state.lastPfxPath || !state.lastPfxPassword) return;

  showStatus(statusEl, 'Instalando y reexportando (revisa la ventana de permisos de administrador)...', true);

  const result = await window.api.reinforcePfxWindows(state.lastPfxPath, state.lastPfxPassword);

  if (result.ok) {
    showStatus(statusEl, 'PFX reforzado correctamente en: ' + result.path, true);
    state.lastPfxPath = result.path;
  } else {
    showStatus(statusEl, 'Error: ' + result.error, false);
  }
});

// ---- JKS ----
document.getElementById('chkJks').addEventListener('change', refreshExportButtons);
document.getElementById('chkJksDefault').addEventListener('change', e => {
  const disabled = e.target.checked;
  document.getElementById('jksAlias').disabled = disabled;
  document.getElementById('jksPassword').disabled = disabled;
  if (disabled) {
    document.getElementById('jksAlias').value = 'server';
    document.getElementById('jksPassword').value = '123456';
  }
});

document.getElementById('btnExportJks').addEventListener('click', async () => {
  const alias = document.getElementById('jksAlias').value.trim() || 'server';
  const password = document.getElementById('jksPassword').value || '123456';
  const statusEl = document.getElementById('jksExportStatus');

  const targetDir = await window.api.selectExportDirectory();
  if (!targetDir) return;

  showStatus(statusEl, 'Generando .jks (requiere keytool/JDK)...', true);

  const result = await window.api.exportJks({
    certPem: state.certPem,
    keyPem: state.keyPem,
    tipoValidacion: state.certInfo.tipoValidacion,
    alias,
    password,
    targetDir
  });

  if (result.ok) showStatus(statusEl, 'JKS generado en: ' + result.path, true);
  else showStatus(statusEl, 'Error: ' + result.error, false);
});

// =====================================================================
// VISTA 2: DECODIFICAR
// =====================================================================

let pendingDecodeFile = null; // { path, name, ext } para reintentar con password

async function runDecode(file, password) {
  const ext = extOf(file.name);
  const outputBox = document.getElementById('decodeOutputBox');
  const output = document.getElementById('decodeOutput');
  const passwordBox = document.getElementById('decodePasswordBox');

  let result;
  try {
    if (ext === '.crt' || ext === '.cer' || ext === '.pem') {
      const pem = await window.api.readTextFile(file.path);
      result = await window.api.decodeCrt(pem);
    } else if (ext === '.csr') {
      const pem = await window.api.readTextFile(file.path);
      result = await window.api.decodeCsr(pem);
    } else if (ext === '.pfx' || ext === '.p12') {
      const base64 = await window.api.readBinaryFileBase64(file.path);
      result = await window.api.decodePfx(base64, password || '');
      if (!result.ok) {
        passwordBox.style.display = 'block';
        pendingDecodeFile = file;
      }
    } else if (ext === '.jks') {
      result = await window.api.decodeJks(file.path, password || '');
      if (!result.ok) {
        passwordBox.style.display = 'block';
        pendingDecodeFile = file;
      }
    } else {
      result = { ok: false, error: 'Formato no soportado: ' + ext };
    }
  } catch (e) {
    result = { ok: false, error: e.message };
  }

  if (result.ok) {
    outputBox.style.display = 'block';
    output.textContent = result.text;
    if (ext !== '.pfx' && ext !== '.p12' && ext !== '.jks') passwordBox.style.display = 'none';
  } else {
    outputBox.style.display = 'none';
    if (ext === '.pfx' || ext === '.p12' || ext === '.jks') {
      // ya se mostró el cuadro de contraseña
    } else {
      alert('Error al decodificar: ' + result.error);
    }
  }
}

setupDropzone(document.getElementById('dropDecode'), async (file, el) => {
  document.getElementById('dropDecodeName').textContent = file.name;
  el.classList.add('loaded');
  document.getElementById('decodePasswordBox').style.display = 'none';
  document.getElementById('decodePassword').value = '';
  await runDecode(file, null);
});

document.getElementById('btnDecodeRetry').addEventListener('click', async () => {
  if (!pendingDecodeFile) return;
  const password = document.getElementById('decodePassword').value;
  await runDecode(pendingDecodeFile, password);
});

document.getElementById('btnCopyDecode').addEventListener('click', () => {
  const text = document.getElementById('decodeOutput').textContent;
  navigator.clipboard.writeText(text);
});

// =====================================================================
// VISTA 3: VALIDACIÓN IGUALDAD
// =====================================================================

const valState = { crt: null, key: null, csr: null, crt2: null, csr2: null, key2: null };

async function checkCertKeyPair() {
  if (!valState.crt || !valState.key) return;
  const badge = document.getElementById('resultCertKey');
  const result = await window.api.validateCertKeyPair(valState.crt, valState.key);
  if (!result.ok) {
    badge.className = 'result-badge error';
    badge.textContent = 'Error: ' + result.error;
    return;
  }
  if (result.data.coincide) {
    badge.className = 'result-badge ok';
    badge.textContent = '✅ El certificado y la llave SÍ coinciden.';
  } else {
    badge.className = 'result-badge error';
    badge.textContent = '❌ El certificado y la llave NO coinciden.';
  }
}

async function checkCsrCertPair() {
  if (!valState.csr || !valState.crt2) return;
  const badge = document.getElementById('resultCsrCert');
  const result = await window.api.validateCsrCertPair(valState.csr, valState.crt2);
  if (!result.ok) {
    badge.className = 'result-badge error';
    badge.textContent = 'Error: ' + result.error;
    return;
  }
  if (result.data.coincide) {
    badge.className = 'result-badge ok';
    badge.textContent = '✅ El CSR y el certificado SÍ coinciden.';
  } else {
    badge.className = 'result-badge error';
    badge.textContent = '❌ El CSR y el certificado NO coinciden.';
  }
}

async function checkCsrKeyPair() {
  if (!valState.csr2 || !valState.key2) return;
  const badge = document.getElementById('resultCsrKey');
  const result = await window.api.validateCsrKeyPair(valState.csr2, valState.key2);
  if (!result.ok) {
    badge.className = 'result-badge error';
    badge.textContent = 'Error: ' + result.error;
    return;
  }
  if (result.data.coincide) {
    badge.className = 'result-badge ok';
    badge.textContent = '✅ El CSR y la llave SÍ coinciden.';
  } else {
    badge.className = 'result-badge error';
    badge.textContent = '❌ El CSR y la llave NO coinciden.';
  }
}

setupDropzone(document.getElementById('dropValCrt'), async (file, el) => {
  valState.crt = await window.api.readTextFile(file.path);
  document.getElementById('dropValCrtName').textContent = file.name;
  el.classList.add('loaded');
  checkCertKeyPair();
});

setupDropzone(document.getElementById('dropValKey'), async (file, el) => {
  valState.key = await window.api.readTextFile(file.path);
  document.getElementById('dropValKeyName').textContent = file.name;
  el.classList.add('loaded');
  checkCertKeyPair();
});

setupDropzone(document.getElementById('dropValCsr'), async (file, el) => {
  valState.csr = await window.api.readTextFile(file.path);
  document.getElementById('dropValCsrName').textContent = file.name;
  el.classList.add('loaded');
  checkCsrCertPair();
});

setupDropzone(document.getElementById('dropValCrt2'), async (file, el) => {
  valState.crt2 = await window.api.readTextFile(file.path);
  document.getElementById('dropValCrt2Name').textContent = file.name;
  el.classList.add('loaded');
  checkCsrCertPair();
});

setupDropzone(document.getElementById('dropValCsr2'), async (file, el) => {
  valState.csr2 = await window.api.readTextFile(file.path);
  document.getElementById('dropValCsr2Name').textContent = file.name;
  el.classList.add('loaded');
  checkCsrKeyPair();
});

setupDropzone(document.getElementById('dropValKey2'), async (file, el) => {
  valState.key2 = await window.api.readTextFile(file.path);
  document.getElementById('dropValKey2Name').textContent = file.name;
  el.classList.add('loaded');
  checkCsrKeyPair();
});

// Estado inicial de botones
refreshExportButtons();

// =====================================================================
// VISTA 4: REGISTRO DNS
// =====================================================================

document.getElementById('btnProcessDns').addEventListener('click', () => {
  const input = document.getElementById('dnsInput').value.trim();
  const outputBox = document.getElementById('dnsOutputBox');
  const output = document.getElementById('dnsOutput');

  if (!input) {
    alert('Por favor, ingresa el registro DNS.');
    return;
  }

  // Separamos el input usando 'CNAME' (insensible a mayúsculas/minúsculas)
  const parts = input.split(/CNAME/i);
  if (parts.length < 2) {
    alert("Formato no reconocido. Asegúrate de incluir 'CNAME'.");
    return;
  }

  // Quitamos espacios y el punto final de zona DNS (ej: "...sectigo.com.")
  const nombre = parts[0].trim().replace(/\.$/, '');
  const valor = parts[1].trim().replace(/\.$/, '');

  // El "Dominio" es el "Nombre" quitando solo la primera etiqueta (el hash
  // de validación), NO los últimos dos segmentos (eso rompe dominios con
  // TLD compuesto como .com.pe, .com.ar, etc.)
  // Ej: "_B23DAB....lacalera.com.pe" -> quitamos "_B23DAB..." -> "lacalera.com.pe"
  const segments = nombre.split('.').filter(p => p.length > 0);
  let dominio = 'dominio.com';
  if (segments.length >= 2) {
    dominio = segments.slice(1).join('.');
  }

  const emailText = `Buenos días,

Según lo coordinado, se remite el registro DNS tipo CNAME correspondiente al Certificado SSL CN: *.${dominio}, el cual es necesario crear para continuar con el proceso de validación del dominio.

Dominio: ${dominio}
Nombre: ${nombre}
Valor: ${valor}`;

  output.textContent = emailText;
  outputBox.style.display = 'block';
});

document.getElementById('btnCopyDns').addEventListener('click', e => {
  const text = document.getElementById('dnsOutput').textContent;
  const btn = e.target;

  navigator.clipboard.writeText(text).then(() => {
    const originalText = btn.textContent;
    btn.textContent = '✅ Copiado';
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
    }, 1200);
  }).catch(err => {
    console.error('Error al copiar: ', err);
  });
});


// =====================================================================
// VISTA 5: INTERMEDIARIOS
// =====================================================================

const interState = {
  list: [],              // lista completa cargada desde el almacén
  selectedIds: new Set(),// ids marcados con el checkbox (para eliminar)
  pendingCandidate: null // datos parseados del .crt recién elegido, pendientes de guardar
};

async function loadIntermediarios() {
  const result = await window.api.listIntermediarios();
  interState.list = result.ok ? result.list : [];
  renderInterTable();
}

function renderInterTable() {
  const filterText = document.getElementById('interSearchInput').value.trim().toLowerCase();
  const tbody = document.getElementById('interTableBody');
  const emptyHint = document.getElementById('interEmptyHint');

  const filtered = interState.list.filter(item => {
    if (!filterText) return true;
    return (
      (item.emitidoPor || '').toLowerCase().includes(filterText) ||
      (item.emitidoPara || '').toLowerCase().includes(filterText)
    );
  });

  tbody.innerHTML = '';

  if (filtered.length === 0) {
    emptyHint.style.display = 'block';
    emptyHint.textContent = interState.list.length === 0
      ? 'No hay intermediarios guardados todavía. Usa "+ Agregar" para importar un .crt.'
      : 'No se encontraron resultados para la búsqueda.';
    return;
  }
  emptyHint.style.display = 'none';

  filtered.forEach((item, index) => {
    const tr = document.createElement('tr');
    tr.dataset.id = item.id;
    if (interState.selectedIds.has(item.id)) tr.classList.add('selected');

    tr.innerHTML = `
      <td><input type="checkbox" class="inter-row-check" ${interState.selectedIds.has(item.id) ? 'checked' : ''}></td>
      <td>${index + 1}</td>
      <td>${item.emitidoPor || '-'}</td>
      <td>${item.emitidoPara || '-'}</td>
      <td>${item.fechaInicio || '-'}</td>
      <td>${item.fechaFin || '-'}</td>
      <td>${item.tipo || '-'}</td>
      <td>${item.nota || '-'}</td>
    `;

    const checkbox = tr.querySelector('.inter-row-check');
    checkbox.addEventListener('click', e => {
      e.stopPropagation();
      if (checkbox.checked) interState.selectedIds.add(item.id);
      else interState.selectedIds.delete(item.id);
      tr.classList.toggle('selected', checkbox.checked);
    });

    tr.addEventListener('click', () => showInterDetail(item));

    tbody.appendChild(tr);
  });
}

function showInterDetail(item) {
  document.getElementById('interDetailT1').textContent = item.emitidoPor || '-';
  document.getElementById('interDetailT2').textContent = item.emitidoPara || '-';
  document.getElementById('interDetailT3').textContent = item.fechaInicio || '-';
  document.getElementById('interDetailT4').textContent = item.fechaFin || '-';
  document.getElementById('interDetailT5').textContent = item.nota || '-';
  document.getElementById('interDetailTipo').textContent = item.tipo || '-';
  document.getElementById('interDetailBox').style.display = 'block';
}

document.getElementById('btnSearchInter').addEventListener('click', () => renderInterTable());
document.getElementById('interSearchInput').addEventListener('keyup', e => {
  if (e.key === 'Enter') renderInterTable();
});

document.getElementById('btnAddInter').addEventListener('click', async () => {
  const filePath = await window.api.selectCrtFileForInter();
  if (!filePath) return;

  const result = await window.api.parseIntermediarioFile(filePath);
  if (!result.ok) {
    alert('No se pudo leer el certificado: ' + result.error);
    return;
  }

  interState.pendingCandidate = result.data;

  document.getElementById('interFormEmitidoPor').textContent = result.data.emitidoPor;
  document.getElementById('interFormEmitidoPara').textContent = result.data.emitidoPara;
  document.getElementById('interFormFechaInicio').textContent = result.data.fechaInicio || '-';
  document.getElementById('interFormFechaFin').textContent = result.data.fechaFin || '-';
  document.getElementById('interFormTitulo5').value = '';
  document.getElementById('interFormTipo').value = result.data.tipoSugerido || 'Intermediario';

  document.getElementById('interAddFormBox').style.display = 'block';
});

document.getElementById('btnCancelInter').addEventListener('click', () => {
  interState.pendingCandidate = null;
  document.getElementById('interAddFormBox').style.display = 'none';
});

document.getElementById('btnSaveInter').addEventListener('click', async () => {
  if (!interState.pendingCandidate) return;

  const record = {
    emitidoPor: interState.pendingCandidate.emitidoPor,
    emitidoPara: interState.pendingCandidate.emitidoPara,
    fechaInicio: interState.pendingCandidate.fechaInicio,
    fechaFin: interState.pendingCandidate.fechaFin,
    nota: document.getElementById('interFormTitulo5').value.trim(),
    tipo: document.getElementById('interFormTipo').value,
    pem: interState.pendingCandidate.pem
  };

  const result = await window.api.saveIntermediario(record);
  if (result.ok) {
    interState.list = result.list;
    interState.pendingCandidate = null;
    document.getElementById('interAddFormBox').style.display = 'none';
    renderInterTable();
  } else {
    alert('Error al guardar: ' + result.error);
  }
});

document.getElementById('btnDeleteInter').addEventListener('click', async () => {
  if (interState.selectedIds.size === 0) {
    alert('Selecciona al menos un intermediario (con el checkbox) para eliminar.');
    return;
  }

  const confirmado = confirm(`¿Eliminar ${interState.selectedIds.size} intermediario(s) seleccionado(s)?`);
  if (!confirmado) return;

  const result = await window.api.deleteIntermediarios(Array.from(interState.selectedIds));
  if (result.ok) {
    interState.list = result.list;
    interState.selectedIds.clear();
    document.getElementById('interDetailBox').style.display = 'none';
    renderInterTable();
  } else {
    alert('Error al eliminar: ' + result.error);
  }
});

// Carga inicial del almacén de intermediarios al abrir la app
loadIntermediarios();

function resetView(viewId) {
  switch (viewId) {
    case 'view-cargar':
      state.certPem = null;
      state.keyPem = null;
      state.certInfo = null;
      state.keyMatch = null;
      state.lastPfxPath = null;
      state.lastPfxPassword = null;
      document.getElementById('dropCrtName').textContent = '';
      document.getElementById('dropKeyName').textContent = '';
      document.getElementById('dropCrt').classList.remove('loaded');
      document.getElementById('dropKey').classList.remove('loaded');
      document.getElementById('certInfoBox').style.display = 'none';
      document.getElementById('rowOrganizacion').style.display = 'none';
      document.getElementById('certKeyMatchStatus').textContent = '';
      document.getElementById('certKeyMatchStatus').className = 'result-badge';
      document.getElementById('serverExportStatus').textContent = '';
      document.getElementById('pfxExportStatus').textContent = '';
      document.getElementById('jksExportStatus').textContent = '';
      document.getElementById('btnReinforcePfx').style.display = 'none';
      document.getElementById('pfxReinforceStatus').textContent = '';
      refreshExportButtons();
      break;

    case 'view-decodificar':
      document.getElementById('dropDecodeName').textContent = '';
      document.getElementById('dropDecode').classList.remove('loaded');
      document.getElementById('decodePasswordBox').style.display = 'none';
      document.getElementById('decodeOutputBox').style.display = 'none';
      document.getElementById('decodePassword').value = '';
      pendingDecodeFile = null;
      break;

    case 'view-validar':
      valState.crt = null;
      valState.key = null;
      valState.csr = null;
      valState.crt2 = null;
      valState.csr2 = null;
      valState.key2 = null;
      document.querySelectorAll('.dropzone.small').forEach(dz => dz.classList.remove('loaded'));
      document.querySelectorAll('.dz-filename').forEach(el => {
        if (el.id.startsWith('dropVal')) el.textContent = '';
      });
      document.getElementById('resultCertKey').textContent = '';
      document.getElementById('resultCsrCert').textContent = '';
      document.getElementById('resultCsrKey').textContent = '';
      break;

    case 'view-dns': {
      document.getElementById('dnsInput').value = '';
      document.getElementById('dnsOutputBox').style.display = 'none';
      const btn = document.getElementById('btnCopyDns');
      btn.textContent = 'Copiar';
      btn.disabled = false;
      break;
    }

    case 'view-intermediarios':
      document.getElementById('interSearchInput').value = '';
      document.getElementById('interAddFormBox').style.display = 'none';
      document.getElementById('interDetailBox').style.display = 'none';
      interState.selectedIds.clear();
      interState.pendingCandidate = null;
      renderInterTable();
      break;
  }
}