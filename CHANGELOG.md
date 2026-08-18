# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y
el proyecto usa [Versionado Semántico](https://semver.org/lang/es/)
(`MAJOR.MINOR.PATCH`): `MAJOR` cuando hay cambios incompatibles (formato de
base de datos, config de usuario, etc.), `MINOR` cuando se agrega
funcionalidad nueva sin romper lo existente, `PATCH` para correcciones. Cada
versión publicada tiene un tag `vX.Y.Z` en el repositorio.

## [Sin publicar]

### Agregado

- **Auto-actualizador**: nueva sección "Actualizaciones" en Configuración —
  buscar versión nueva, ver notas, descargar e instalar con un botón, y
  reiniciar para terminar. Cada paquete se verifica con firma Ed25519
  contra la clave pública embebida (`tauri-plugin-updater`) antes de
  instalarse
- `.github/workflows/release.yml`: al pushear un tag `vX.Y.Z`, compila el
  instalador de Windows, lo firma y publica un GitHub Release en borrador
  con el `latest.json` que consume el auto-actualizador
- Sección "Capturas" en el README con pantallazos reales de Dashboard,
  Terminal, Explorador, Modo Hacker, Base de datos, Configuración y
  Configuración > Actualizaciones

### Corregido

- La versión junto al logo en la barra superior venía hardcodeada en
  "v0.1.0"; ahora se lee en runtime con `getVersion()`, igual que en
  Configuración > Acerca de

## [0.2.0] — 2026-08-17

### Agregado

- **Módulo Scripts** (Desarrollo): biblioteca de scripts propios con alta
  manual o **importación desde un repositorio Git** (clona, detecta el
  script principal por convención y deja elegir ícono), tarjetas con botón
  "Ejecutar" directo y edición/borrado con confirmación
- **Arsenal** (Modo Hacker): panel con ~25 herramientas externas de
  seguridad (Nmap, Amass, Burp Suite, OWASP ZAP, Wireshark, Metasploit,
  Semgrep, Gitleaks, Trivy, testssl.sh, y más) agrupadas por categoría
  (Recon, Web, Red, Auditoría, Vulnerabilidades, Código, Pentest), con
  detección real de instalación, instalación con un clic vía `winget`/`pip`
  cuando hay instalador desatendido disponible, y ejecución con el comando
  exacto visible antes de correr
- **Importar programa portable** (Aplicaciones): apuntar a una carpeta o un
  `.zip`, KRYPTOS lo copia a su almacenamiento propio, detecta los `.exe`
  adentro, y en un segundo paso el usuario confirma cuál es el ejecutable
  principal, le pone nombre e ícono; cancelar a mitad de camino descarta la
  copia sin dejar nada huérfano
- **Puente de bandeja del sistema** (`TrayBridge`): el menú de la bandeja
  ahora abre/enfoca la pestaña real del módulo elegido, el mismo camino que
  un clic en la barra lateral
- **VerdictPanel** en el Dashboard: un solo botón "¿Estoy comprometido
  ahora?" que corre de una Sentinel, la línea base de seguridad del sistema
  operativo y el estado de honeytokens, y devuelve un único veredicto
  (limpio / a revisar / señales fuertes de compromiso) con la evidencia
  mínima necesaria, en vez de tener que revisar cuatro pestañas distintas
- **Modo Flota — primera acción remota real**: una instancia puede pedirle a
  otra, conectada por Chat, que aísle su propia red. La instancia que
  recibe el pedido nunca la ejecuta sola: siempre muestra una confirmación
  explícita antes de correrla, y quien la pidió ve el resultado real
  (aprobado / rechazado / error)
- **Módulo Base de datos** (Desarrollo): cliente real para SQLite,
  PostgreSQL y MySQL (drivers Rust puros), con conexiones guardadas sin
  persistir contraseña, explorador de tablas/columnas, editor SQL (Monaco)
  con Ctrl+Enter para ejecutar, grilla de resultados y confirmación
  explícita antes de sentencias destructivas
- **Tema claro real**: los tokens de color pasan de valores fijos a
  variables CSS con paleta clara nueva, seleccionable en Configuración >
  Apariencia y persistida igual que el tema de Terminal

### Corregido

- Dos bugs encontrados en la auditoría de QA del módulo de Base de datos

## [0.1.0] — 2026-08-11

Primera versión etiquetada. 18 módulos (Dashboard, Terminal, Explorador,
Aplicaciones, Procesos, Servicios, Red, SSH, Chat, Seguridad —17
herramientas—, Centro de Operaciones, Modo Hacker —12 herramientas—, Git,
Docker, Editor, Logs, Usuarios, Configuración), base de datos SQLite local
para auditoría, y pipelines de CI/CD (GitHub Actions, Azure DevOps, Jenkins,
CircleCI, Harness) con seguimiento de métricas DORA.

[Sin publicar]: https://github.com/KeystrokeVision/kryptos/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/KeystrokeVision/kryptos/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/KeystrokeVision/kryptos/releases/tag/v0.1.0
