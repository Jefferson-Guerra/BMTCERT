# SSL Manager

Aplicación de escritorio (Electron + Node.js) para gestionar certificados SSL:
carga y extracción de información, exportación para Apache/Nginx, generación
de PFX y JKS, decodificación de certificados/CSR/PFX/JKS, y validación de
igualdad entre certificado↔llave y CSR↔certificado.

## Requisitos previos

1. **Node.js** (v18 o superior) — https://nodejs.org
2. **Java JDK** — SOLO necesario si vas a generar o decodificar archivos `.jks`
   (la app usa el comando `keytool`, que viene incluido con cualquier JDK).
   Puedes verificar que está disponible abriendo una terminal y ejecutando:
   ```
   keytool -help
   ```
   Si no lo tienes, descarga el JDK de Adoptium: https://adoptium.net

## Instalación

Abre este proyecto en Visual Studio Code, abre una terminal integrada
(``Ctrl+ñ`` o Terminal → New Terminal) y ejecuta:

```bash
npm install
```

Esto instalará Electron y `node-forge` (librería que hace todo el trabajo
criptográfico: parseo de certificados, armado de PKCS#12, etc., sin necesitar
OpenSSL instalado en el sistema).

## Ejecutar la aplicación

```bash
npm start
```

Esto abrirá la ventana de la aplicación.

## Empaquetar como .exe (opcional)

Si luego quieres distribuir la app como un ejecutable portable de Windows:

```bash
npm run dist
```

El instalador/ejecutable quedará en la carpeta `dist/`.

## Estructura del proyecto

```
ssl-manager/
├── main.js              → Proceso principal de Electron (ventanas, diálogos, IPC)
├── preload.js            → Puente seguro entre la interfaz y Node.js
├── package.json
├── renderer/
│   ├── index.html        → Interfaz: panel lateral + 3 vistas
│   ├── styles.css
│   └── app.js             → Lógica de la interfaz (drag&drop, llamadas a la API)
└── lib/
    ├── chains/index.js    → Intermedios y root embebidos para DV / OV / EV
    ├── certParser.js       → Extrae CN, SAN, fechas, emisor, tipo, etc.
    ├── chainBuilder.js     → Arma chain.crt y certificado_completo.crt
    ├── pfxBuilder.js        → Genera .pfx (PKCS#12) con node-forge
    ├── jksBuilder.js        → Genera .jks usando keytool (requiere JDK)
    ├── decoder.js            → Decodifica .crt / .csr / .pfx / .jks
    └── validator.js          → Compara cert↔key y csr↔cert
```

## Cómo funciona la detección de tipo (DV/OV/EV) y el armado de cadenas

Cuando cargas un `.crt`, la app lee el campo **Issuer (CN)** del certificado.
Sectigo emite ese campo como, por ejemplo:
`Sectigo Public Server Authentication CA DV R36` (o `OV` / `EV`).

A partir de esa palabra (DV/OV/EV) la app selecciona automáticamente los
intermedios y el root correctos (ya embebidos en el código, en
`lib/chains/index.js`) y arma:

- **certificado_completo.crt** = certificado hoja + intermedio 1 + intermedio 2 + root
- **chain.crt** = intermedio 1 + intermedio 2 + root

Cada uno concatenado directamente uno tras otro, sin líneas en blanco extra,
igual que se haría copiando y pegando en el Bloc de Notas.

> Si en el futuro Sectigo cambia sus intermedios, o quieres soportar otra CA,
> solo hay que añadir el nuevo juego de certificados en `lib/chains/index.js`.

## Notas sobre JKS

No existe ninguna librería de Node.js confiable y mantenida para *escribir*
archivos JKS de forma nativa. Por eso la app usa el enfoque estándar de la
industria: genera un `.p12` temporal con `node-forge` y lo convierte a `.jks`
usando `keytool -importkeystore`. Esto requiere tener el JDK instalado, tal
como se indica arriba. La decodificación de `.jks` también usa `keytool`.
