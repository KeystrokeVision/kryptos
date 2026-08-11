<div align="center">
  <img src="public/logo-mark-red.png" alt="KRYPTOS" width="140" />

  # KRYPTOS

  **The Ultimate System Terminal**

  Suite de administración de sistemas y seguridad para escritorio.
  Todo lo que hoy resolvés abriendo Terminal + Administrador de tareas +
  PowerShell + Wireshark + un cliente SSH + Docker Desktop + VS Code + una
  docena de webs sueltas, en una sola app — con datos reales de tu propio
  equipo.

  [![Tauri](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)
  [![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
  [![Rust](https://img.shields.io/badge/Rust-stable-DE4A34?logo=rust&logoColor=white)](https://www.rust-lang.org)
  [![Platform](https://img.shields.io/badge/plataforma-Windows%20%7C%20Linux%20%7C%20macOS-0B0B0B)](#requisitos)
  [![Status](https://img.shields.io/badge/estado-en%20desarrollo%20activo-orange)](#pendiente-conocido)
  [![License](https://img.shields.io/badge/uso-privado-lightgrey)](#licencia)

</div>

<br/>

> [!IMPORTANT]
> **KRYPTOS no incluye ni incluirá herramientas de explotación, fuerza bruta,
> inyección o intrusión.** Es una herramienta de administración y seguridad
> defensiva/educativa — piensa *Sysinternals + un panel de control + una caja
> de herramientas de CTF*, no Metasploit. Todo lo que toca una red lo hace de
> forma pasiva (consulta fuentes públicas) o sobre infraestructura propia;
> todo lo que "ataca" algo lo hace contra un contenedor Docker que vos mismo
> levantaste.

Construida con **Tauri v2 (Rust)** en el backend y **React 19 + TypeScript +
Vite + TailwindCSS** en el frontend. Pensada principalmente para Windows; el
código en sí es multiplataforma y compila también en Linux/macOS.

**18 módulos** · **~37 archivos de comandos de backend en Rust** · base de
datos **SQLite** local para auditoría e historial · **cero telemetría**.

## Índice

- [Módulos](#módulos)
  - [Núcleo](#núcleo)
  - [Sistema](#sistema)
  - [Seguridad](#seguridad-17-herramientas-en-un-módulo)
  - [Modo Hacker](#modo-hacker-osint-pasivo-cripto-y-estética-de-terminal--todo-legal)
  - [Desarrollo](#desarrollo)
  - [Administración](#administración)
  - [Todo el sistema](#todo-el-sistema)
- [Filosofía de datos](#filosofía-de-datos)
- [Seguridad y consentimiento](#seguridad-y-consentimiento)
- [Requisitos](#requisitos)
- [Ejecutar en desarrollo](#ejecutar-en-desarrollo)
- [Compilar el instalador](#compilar-el-instalador)
- [Estructura](#estructura)
- [Pendiente conocido](#pendiente-conocido)
- [Licencia](#licencia)

## Módulos

### Núcleo

| Módulo | Qué hace |
|---|---|
| **Dashboard** | CPU, RAM, disco, red en tiempo real, actividad reciente (conectada al historial de auditoría) y estado de Sentinel de un vistazo |
| **Terminal** | Shell real (PowerShell/CMD/bash) con pestañas ilimitadas y split de paneles, PTY real vía `portable-pty`, búsqueda en el buffer, buscador de comandos rápidos, y **6 temas de color** (KRYPTOS, Matrix, Dracula, Nord, Gruvbox, Ámbar CRT) — tildes y "ñ" se ven bien gracias a forzar UTF-8 en la consola al arrancar |
| **Explorador** | Navegar, crear, buscar, favoritos, editar archivos de texto; **selección múltiple** (Ctrl/Shift+clic) y **arrastrar y soltar** real entre carpetas, breadcrumbs y favoritos (Ctrl al soltar = copiar); vista de **tamaños** estilo `ncdu`, y **buscador de duplicados** por hash con borrado asistido |
| **Aplicaciones** | Lanzador con tus programas favoritos y sus íconos, más detección automática de instalados |

### Sistema

| Módulo | Qué hace |
|---|---|
| **Procesos** | Tabla completa, ordenar, buscar, finalizar con confirmación, y un **dossier por proceso** con un clic: hash SHA-256, firma digital (Authenticode en Windows), **linaje completo**, conexiones activas y eventos de Sentinel relacionados — todo junto |
| **Servicios** | Iniciar/detener/reiniciar servicios de Windows/Linux |
| **Red** | Tráfico en tiempo real, conexiones activas con PID, gateway/DNS, tabla ARP de la LAN, diagnóstico de ping estilo `mtr` |
| **SSH** | Terminal remota interactiva real + transferencia de archivos SFTP, con verificación de huella del host (TOFU) |
| **Chat** | Mensajería peer-to-peer entre instancias de KRYPTOS en la misma red local (hospedar o unirse por IP:puerto), sin servidor intermedio — y dobla como canal de **Modo Flota** |
| **Centro de Operaciones** | Todo lo que Sentinel sabe del equipo en una pantalla: puntaje de seguridad, mapa de red en vivo, pulso de alertas/eventos, y **Flota** con el resumen de otras instancias conectadas por Chat |
| **Seguridad** | 17 herramientas — [ver detalle](#seguridad-17-herramientas-en-un-módulo) |
| **Modo Hacker** | 12 herramientas — [ver detalle](#modo-hacker-osint-pasivo-cripto-y-estética-de-terminal--todo-legal) |

### Seguridad (17 herramientas en un módulo)

<details>
<summary><strong>Ver las 17 herramientas</strong></summary>

- **Sentinel** — vigilancia continua en segundo plano (intervalo configurable): compara el equipo contra una línea base y genera alertas por severidad. Incluye **Time Machine**: reconstruye cómo estaba el equipo en cualquier momento del historial, con **modo comparar** entre dos instantes. Una alerta **crítica** toma toda la pantalla hasta que la reconocés o descartás
- **Honeytokens** — archivos/credenciales señuelo que avisan apenas alguien los toca
- **Línea base de seguridad** — firewall, antivirus, BitLocker, UAC, y más en un solo chequeo
- **Integridad de archivos** — hash de una carpeta completa, para detectar cambios después
- **Vigilante de archivos** — notificación en tiempo real ante cambios en una ruta elegida
- **Verificador SSL/TLS** — certificado, cadena de confianza, fecha de expiración de cualquier host
- **Consulta de CVE** — búsqueda directa contra la base de datos pública del NVD
- **Escaneo de red avanzado** — integración con `nmap` para tu propia red
- **Análisis de logs** — lectura y filtrado de logs de seguridad del sistema
- **Firewall local** — ver, crear y eliminar reglas del firewall de Windows
- **Tareas programadas / persistencia** — qué se ejecuta solo al iniciar sesión
- **DNS / WHOIS** — resolución de registros y datos de registro de un dominio
- **Cabeceras de seguridad HTTP** — HSTS, CSP, X-Frame-Options y similares de cualquier sitio
- **Contraseñas** — generador criptográficamente seguro, verificador de fortaleza 100% offline, y chequeo **opcional** contra Have I Been Pwned por k-anonimato (la contraseña completa nunca sale del equipo)
- **Historial de auditoría** — cada acción destructiva de la app, exportable con hash SHA-256
- **Modo pánico** — bloquear la sesión o aislar la red con un clic
- **Cifrado de archivos** — cifrar/descifrar archivos localmente

</details>

### Modo Hacker (OSINT pasivo, cripto, y estética de terminal — todo legal)

<details>
<summary><strong>Ver las 12 herramientas</strong></summary>

12 herramientas con espíritu Linux/hacker real, filtradas por una sola regla:
**nada de esto toca un sistema que no sea tuyo.** Todo es pasivo (consulta
fuentes públicas), corre localmente, o actúa sobre un contenedor Docker que
vos mismo levantás.

- **Huella propia** — junta DNS, WHOIS y cabeceras de seguridad de un dominio en un solo reporte
- **Caja de cripto** — identificador de formato (hash/JWT/base64/hex...), calculadora de hash (MD5/SHA-1/256/384/512), codificadores base64/hex/URL, decodificador de JWT, y cifrados clásicos (César con fuerza bruta, Vigenère, XOR repetido)
- **Esteganografía** — ocultar y revelar texto en imágenes PNG (LSB)
- **Dorking (recon)** — generador de sintaxis de búsqueda para auditar tu propio dominio; arma el texto, no ejecuta ninguna búsqueda
- **Cheatsheet Linux** — referencia de ~45 comandos reales, buscable y sin conexión, tipo `cheat.sh` local
- **neofetch** — pantalla de info del sistema con ASCII art, con los mismos datos reales que el Dashboard
- **Laboratorio de práctica (Docker)** — descarga y levanta con un clic apps intencionalmente vulnerables (OWASP Juice Shop, DVWA, WebGoat, bWAPP) en tu propio Docker local
- **Wi-Fi y Bluetooth** — redes Wi-Fi visibles y dispositivos Bluetooth ya conocidos por Windows, ambos de solo lectura
- **Monitor de USB** — notificación nativa si aparece un dispositivo USB nuevo (defensa básica contra BadUSB)
- **Escaneo de CVEs sobre software instalado** — cruza tu lista de programas instalados contra la NVD
- **Analizador de binarios (PE/ELF)** — cabeceras, arquitectura, secciones con entropía individual, tabla de importaciones
- **Cracker de hashes (wordlist local)** — diccionario curado + reglas de mutación tipo hashcat, para hashes de un CTF o una contraseña propia olvidada — nunca contra credenciales ajenas ni sistemas en vivo

</details>

### Desarrollo

- **Editor** (Monaco, el motor de VS Code) — pestañas, ~30 lenguajes, explorador de proyecto integrado, botón "Ejecutar" (detecta entornos virtuales de Python), y una **biblioteca de ~30 scripts** listos para abrir y correr
- **Git** — status, diff, stage/unstage, commit, ramas, historial, y push/pull/fetch por SSH
- **Docker** — contenedores, imágenes, logs, ciclo de vida completo

### Administración

- **Usuarios** — cuentas del sistema, solo lectura
- **Logs** — registro de eventos general del sistema, exportable a CSV
- **Configuración** — inicio automático (opcional), notificaciones, shell y tema de terminal por defecto, autostart de Sentinel

### Todo el sistema

- Pantalla de bienvenida animada: secuencia de arranque estilo terminal (lluvia de caracteres en rojo + log de "boot" tipeándose en vivo)
- **Modo demo** — efecto visual de "película de hackers" para mostrar/grabar; no ejecuta nada real, lo dice en pantalla
- Alerta **crítica** de Sentinel corta la pantalla entera hasta que la atendés
- Ícono en la bandeja del sistema (cerrar minimiza, no cierra la app)
- Inicio automático con Windows — **apagado por defecto**, opt-in
- Notificaciones nativas del sistema operativo
- Paleta de comandos (**Ctrl+K**) para saltar a cualquier módulo al instante
- Elevación de privilegios bajo demanda (UAC), nunca en silencio

## Filosofía de datos

Todo en KRYPTOS usa datos reales del sistema — sin mocks, sin placeholders
disfrazados de datos reales. Cada comando de backend habla directo con el
sistema operativo (`sysinfo`, PowerShell, `/proc`, APIs nativas) o con
protocolos y servicios reales (SSH real vía `russh`, Git real vía `git2`,
Docker real vía `bollard`, NVD/Have I Been Pwned/Certificate Transparency vía
`reqwest`, solo cuando el módulo en cuestión lo pide explícitamente).

## Seguridad y consentimiento

- Toda acción destructiva (borrar, finalizar proceso, eliminar regla de firewall) pide confirmación explícita antes de ejecutarse
- Todo lo destructivo queda registrado en un historial de auditoría local (SQLite), exportable con hash SHA-256
- Ningún módulo se auto-eleva: si necesita Administrador, te lo pide con UAC
- Inicio automático y notificaciones están apagados por defecto
- Contraseñas y frases de contraseña de llaves SSH **nunca se guardan** — se piden de nuevo cada vez que se necesitan
- Ninguna herramienta que contacte un servicio externo (Have I Been Pwned, NVD, Shodan/Censys si se agregan más adelante) lo hace automáticamente: siempre es un botón aparte que tenés que presionar vos
- El arrastrar y soltar del Explorador es interno a la app — no importa archivos sueltos desde el Explorador de Windows todavía

## Requisitos

- Node.js 20+
- Rust estable (vía [rustup](https://rustup.rs))
- En Windows: Visual Studio C++ Build Tools (workload "Desktop development with C++") y el runtime de WebView2 (viene preinstalado en Windows 10/11 actualizados)
- Para el módulo Docker y el Laboratorio de práctica: Docker Desktop corriendo (opcional — el módulo detecta si no está disponible y te lo dice)
- Para escaneo de red avanzado: `nmap` instalado (opcional, mismo caso)

## Ejecutar en desarrollo

```bash
npm install
npm run tauri dev
```

La primera vez tarda varios minutos: Cargo compila desde cero un árbol de
dependencias grande (`russh`, `git2`, `bollard`, `rusqlite`, `notify`,
`reqwest`, entre otras). Las siguientes veces es mucho más rápido.

## Compilar el instalador

```bash
npm run tauri build
```

El instalable queda en `src-tauri/target/release/bundle/`.

## Estructura

```text
kryptos/
├── src/                       # Frontend React
│   ├── components/
│   │   ├── layout/            # TopBar, Sidebar, TabBar, StatusBar, ModuleView, CommandPalette
│   │   ├── security/          # Un componente por herramienta de Seguridad
│   │   ├── hacker/            # Un componente por herramienta de Modo Hacker
│   │   ├── explorer/ git/ ssh/ apps/ terminal/  # Componentes específicos de cada módulo
│   │   └── ui/                # Card, Modal, ConfirmDialog, primitivas reutilizables
│   ├── pages/                 # Un archivo por módulo
│   ├── store/                 # Zustand: useTabStore, useFleetStore
│   ├── lib/                   # utils, formato, registro de módulos, cliente Tauri, bibliotecas de scripts/cheatsheet/temas
│   └── types/                 # Tipos que reflejan los structs Serde del backend
├── public/                    # splashscreen.html + logo (fuera del bundle de React)
└── src-tauri/                 # Backend Rust
    └── src/
        ├── commands/           # Un módulo por dominio (~37 archivos)
        ├── db.rs               # Conexión y esquema de SQLite
        ├── tray.rs             # Ícono de bandeja y comportamiento de la ventana
        └── main.rs
```

## Pendiente conocido

- **Captura de paquetes (Wireshark-lite)**: evaluado y descartado por ahora — requeriría **Npcap** instalado por separado, una dependencia Rust nativa nueva (`pnet`/`pcap`) y probablemente permisos de Administrador. Queda como el candidato más grande de Modo Hacker si se retoma más adelante
- **Auto-actualizador**: todavía sin `tauri-plugin-updater` — cada corrección hoy requiere reinstalar a mano. Necesita además firma de código e infraestructura de releases
- **Base de datos** y **Plugins**: aparecen en el menú pero siguen siendo placeholder ("módulo en construcción")
- **Git**: solo push/pull/fetch por SSH (HTTPS se dejó fuera a propósito — requeriría una compilación vendorizada de OpenSSL que necesita Perl)
- **GeoIP** en el módulo de Red: requiere una license key gratuita de MaxMind que cada usuario debe conseguir por su cuenta
- **Autocompletado real (Tab) en la Terminal**: evaluado y descartado a propósito — PowerShell/cmd ya hacen su propio tab-completion nativo dentro del PTY
- Internacionalización (hoy todo está en español) y un tema claro real
- **Modo Flota** comparte el estado de Sentinel entre instancias, pero no hay forma todavía de actuar a distancia — es solo lectura por ahora

## Licencia

Proyecto privado — todos los derechos reservados. Sin licencia de uso público
por el momento.

---

<div align="center">
  <sub>Construido con Tauri, Rust y React · sin telemetría, sin mocks.</sub>
</div>
