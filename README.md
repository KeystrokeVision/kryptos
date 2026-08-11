# KRYPTOS

Suite de administración de sistemas y seguridad para escritorio, construida con
**Tauri v2 (Rust)** en el backend y **React 19 + TypeScript + Vite + TailwindCSS**
en el frontend. Pensada principalmente para Windows; el código en sí es
multiplataforma y compila también en Linux/macOS.

La idea: en vez de abrir Terminal + Administrador de tareas + PowerShell +
Wireshark + un cliente SSH + Docker Desktop + VS Code + una docena de webs
sueltas para decodificar un JWT o mirar cabeceras HTTP, todo vive en una sola
app, con datos reales de tu propio equipo.

**KRYPTOS no incluye ni incluirá herramientas de explotación, fuerza bruta,
inyección o intrusión.** Es una herramienta de administración y seguridad
defensiva/educativa — piensa Sysinternals + un panel de control + una caja de
herramientas de CTF, no Metasploit. Todo lo que toca una red lo hace de forma
pasiva (consulta fuentes públicas) o sobre infraestructura propia; todo lo que
"ataca" algo lo hace contra un contenedor Docker que vos mismo levantaste.

18 módulos, ~37 archivos de comandos de backend en Rust, una base de datos
SQLite local para auditoría e historial, cero telemetría.

## Módulos

### Núcleo

- **Dashboard** — CPU, RAM, disco, red en tiempo real, actividad reciente (conectada al historial de auditoría) y estado de Sentinel de un vistazo
- **Terminal** — shell real (PowerShell/CMD/bash) con pestañas ilimitadas y split de paneles, PTY real vía `portable-pty`, búsqueda en el buffer, un buscador de comandos rápidos que junta el catálogo propio con el cheatsheet de Modo Hacker, y **6 temas de color** (KRYPTOS, Matrix, Dracula, Nord, Gruvbox, Ámbar CRT) elegibles desde Configuración — tildes y "ñ" se ven bien gracias a forzar UTF-8 en la consola al arrancar
- **Explorador** — navegar, crear, buscar, favoritos, editar archivos de texto; **selección múltiple** (Ctrl/Shift+clic) y **arrastrar y soltar** real entre carpetas, breadcrumbs y favoritos (mantené Ctrl mientras soltás para copiar en vez de mover); vista de **tamaños** estilo ncdu para encontrar qué ocupa espacio, y **buscador de duplicados** por hash con borrado asistido
- **Aplicaciones** — lanzador con tus programas favoritos y sus íconos, más detección automática de instalados

### Sistema

- **Procesos** — tabla completa, ordenar, buscar, finalizar con confirmación, y un **dossier por proceso** con un clic: hash SHA-256, firma digital (Authenticode en Windows), **linaje completo** (toda la cadena de quién-lanzó-a-quién, no solo el padre directo), sus conexiones activas, y cualquier evento de Sentinel relacionado — todo junto, sin saltar de módulo en módulo
- **Servicios** — iniciar/detener/reiniciar servicios de Windows/Linux
- **Red** — tráfico en tiempo real, conexiones activas con PID, gateway/DNS, tabla ARP de dispositivos ya vistos en la LAN, diagnóstico de ping estilo `mtr`
- **SSH** — terminal remota interactiva real + transferencia de archivos SFTP, con verificación de huella del host (TOFU)
- **Chat** — mensajería peer-to-peer directa entre instancias de KRYPTOS en la misma red local (hospedar o unirse por IP:puerto), sin servidor intermedio — y mientras esa pestaña siga abierta, dobla como el canal de **Modo Flota** (ver Centro de Operaciones)
- **Centro de Operaciones** — todo lo que Sentinel sabe del equipo en una sola pantalla: puntaje de seguridad, mapa de red en vivo, un pulso continuo de alertas/eventos, y una sección de **Flota** que muestra el mismo resumen de cualquier otra instancia de KRYPTOS conectada al Chat — pensada para dejar proyectada o mirar de reojo
- **Seguridad** — 17 herramientas en un módulo, ver abajo
- **Modo Hacker** — 9 herramientas de recon/cripto/estética, ver abajo

### Seguridad (17 herramientas en un módulo)

- **Sentinel** — vigilancia continua en segundo plano (intervalo configurable): compara el equipo contra una línea base y genera alertas por severidad. Incluye **Time Machine**: reconstruye cómo estaba el equipo en cualquier momento del historial, no solo el estado actual, con un **modo comparar** que muestra el diff exacto entre dos instantes (qué puerto se abrió, qué arranque automático apareció, cómo cambió la línea base). Una alerta de severidad **crítica** toma toda la pantalla (no solo una notificación) hasta que la reconocés o descartás — las de severidad alta siguen yendo por notificación nativa nomás
- **Honeytokens** — archivos/credenciales señuelo que avisan apenas alguien los toca
- **Línea base de seguridad** — firewall, antivirus, BitLocker, UAC, y más ajustes del sistema en un solo chequeo
- **Integridad de archivos** — hash de una carpeta completa, para detectar cambios después
- **Vigilante de archivos** — notificación en tiempo real ante cambios en una ruta que elijas
- **Verificador SSL/TLS** — certificado, cadena de confianza, fecha de expiración de cualquier host
- **Consulta de CVE** — búsqueda directa contra la base de datos pública del NVD
- **Escaneo de red avanzado** — integración con `nmap` para tu propia red
- **Análisis de logs** — lectura y filtrado de logs de seguridad del sistema
- **Firewall local** — ver, crear y eliminar reglas del firewall de Windows
- **Tareas programadas / persistencia** — qué se ejecuta solo al iniciar sesión
- **DNS / WHOIS** — resolución de registros y datos de registro de un dominio
- **Cabeceras de seguridad HTTP** — HSTS, CSP, X-Frame-Options y similares de cualquier sitio
- **Contraseñas** — generador criptográficamente seguro, verificador de fortaleza 100% offline, y chequeo **opcional** contra Have I Been Pwned por k-anonimato (la contraseña completa nunca sale del equipo)
- **Historial de auditoría** — cada acción destructiva de la app, exportable con hash SHA-256 para verificar integridad después
- **Modo pánico** — bloquear la sesión o aislar la red con un clic
- **Cifrado de archivos** — cifrar/descifrar archivos localmente

### Modo Hacker (OSINT pasivo, cripto, y estética de terminal — todo legal)

12 herramientas con espíritu Linux/hacker real, filtradas por una sola regla:
nada de esto toca un sistema que no sea tuyo. Todo es pasivo (consulta fuentes
públicas), corre localmente, o actúa sobre un contenedor Docker que vos mismo
levantás.

- **Huella propia** — junta DNS, WHOIS y cabeceras de seguridad de un dominio en un solo reporte
- **Caja de cripto** — identificador de formato (hash/JWT/base64/hex...), calculadora de hash (MD5/SHA-1/256/384/512), codificadores base64/hex/URL, decodificador de JWT, y cifrados clásicos (César con fuerza bruta de los 25 corrimientos, Vigenère, XOR repetido)
- **Esteganografía** — ocultar y revelar texto en imágenes PNG (LSB), todo en el navegador embebido
- **Dorking (recon)** — generador de sintaxis de búsqueda para auditar qué tiene indexado un buscador de tu propio dominio; arma el texto, no ejecuta ninguna búsqueda
- **Cheatsheet Linux** — referencia de ~45 comandos reales (archivos, permisos, red, texto, git, reconocimiento autorizado) buscable y sin conexión, tipo `cheat.sh` local
- **neofetch** — pantalla de info del sistema con ASCII art, usando los mismos datos reales que el Dashboard
- **Laboratorio de práctica (Docker)** — descarga y levanta con un clic apps intencionalmente vulnerables (OWASP Juice Shop, DVWA, WebGoat, bWAPP) en tu propio Docker local, con botón de detener/eliminar y progreso de descarga en vivo
- **Wi-Fi y Bluetooth** — redes Wi-Fi visibles para tu adaptador y dispositivos Bluetooth ya conocidos por Windows, ambos de solo lectura
- **Monitor de USB** — notificación nativa si aparece un dispositivo USB nuevo mientras el panel está abierto (defensa básica contra BadUSB)
- **Escaneo de CVEs sobre software instalado** — cruza tu lista de programas instalados contra la NVD, uno por uno, en vez de buscar CVE por CVE a mano
- **Analizador de binarios (PE/ELF)** — cabeceras, arquitectura, secciones con su entropía individual (para detectar packers), y tabla de importaciones — el punto de partida clásico de ingeniería inversa
- **Cracker de hashes (wordlist local)** — diccionario curado + reglas de mutación tipo hashcat, para hashes de un CTF o una contraseña propia olvidada — nunca contra credenciales ajenas ni sistemas en vivo

### Desarrollo

- **Editor** (Monaco, el motor de VS Code) — pestañas, ~30 lenguajes, explorador de proyecto integrado, botón "Ejecutar" para scripts (detecta entornos virtuales de Python automáticamente), y una **biblioteca de ~30 scripts** reales listos para abrir y correr, buscable por categoría: Git/GitHub, entorno de desarrollo, sistema (estilo Termux/Linux), red, recon/auditoría propia, y hardening
- **Git** — status, diff, stage/unstage, commit, ramas, historial, y push/pull/fetch por SSH
- **Docker** — contenedores, imágenes, logs, ciclo de vida completo (además de lo que ya usa el Laboratorio de práctica de Modo Hacker)

### Administración

- **Usuarios** — cuentas del sistema, solo lectura
- **Logs** — registro de eventos general del sistema, exportable a CSV
- **Configuración** — inicio automático (opcional), notificaciones, shell y tema de terminal por defecto, autostart de Sentinel

### Todo el sistema

- Pantalla de bienvenida animada al abrir: secuencia de arranque estilo terminal (lluvia de caracteres en rojo + log de "boot" tipeándose en vivo), no solo un logo con fade
- **Modo demo** (botón en la barra superior) — efecto visual de "película de hackers" con ventanas falsas escribiendo solas de fondo, pensado para mostrar/grabar; no ejecuta nada real, lo dice en pantalla
- Una alerta **crítica** de Sentinel corta la pantalla entera hasta que la atendés — pensado para que no haya forma de no verla
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

- Toda acción destructiva (borrar, finalizar proceso, eliminar regla de
  firewall) pide confirmación explícita antes de ejecutarse
- Todo lo destructivo queda registrado en un historial de auditoría local
  (SQLite), exportable con hash SHA-256 para verificar integridad después
- Ningún módulo se auto-eleva: si necesita Administrador, te lo pide con UAC
- Inicio automático y notificaciones están apagados por defecto
- Contraseñas y frases de contraseña de llaves SSH **nunca se guardan** — se
  piden de nuevo cada vez que se necesitan
- Ninguna herramienta que contacte un servicio externo (Have I Been Pwned,
  NVD, Shodan/Censys si se agregan más adelante) lo hace automáticamente: es
  siempre un botón aparte que tenés que presionar vos
- El arrastrar y soltar del Explorador es interno a la app (mover/copiar
  entre tus propias carpetas) — no importa archivos sueltos desde el
  Explorador de Windows todavía

## Requisitos

- Node.js 20+
- Rust estable (vía [rustup](https://rustup.rs))
- En Windows: Visual Studio C++ Build Tools (workload "Desktop development
  with C++") y el runtime de WebView2 (viene preinstalado en Windows 10/11
  actualizados)
- Para el módulo Docker y el Laboratorio de práctica: Docker Desktop corriendo
  (opcional — el módulo detecta si no está disponible y te lo dice)
- Para escaneo de red avanzado: `nmap` instalado (opcional, mismo caso)

## Ejecutar en desarrollo

```bash
npm install
npm run tauri dev
```

La primera vez tarda varios minutos: Cargo compila desde cero un árbol de
dependencias grande (`russh`, `git2`, `bollard`, `rusqlite`, `notify`, `reqwest`,
entre otras). Las siguientes veces es mucho más rápido.

## Compilar el instalador

```bash
npm run tauri build
```

El instalable queda en `src-tauri/target/release/bundle/`.

## Estructura

```
kryptos/
├── src/                       # Frontend React
│   ├── components/
│   │   ├── layout/            # TopBar, Sidebar, TabBar, StatusBar, ModuleView, CommandPalette
│   │   ├── security/          # Un componente por herramienta de Seguridad
│   │   ├── hacker/            # Un componente por herramienta de Modo Hacker
│   │   ├── explorer/ git/ ssh/ apps/ terminal/  # Componentes especificos de cada modulo
│   │   └── ui/                # Card, Modal, ConfirmDialog, primitivas reutilizables
│   ├── pages/                 # Un archivo por modulo
│   ├── store/                 # Zustand: useTabStore, useFleetStore
│   ├── lib/                   # utils, formato, registro de modulos, cliente Tauri, bibliotecas de scripts/cheatsheet/temas
│   └── types/                 # Tipos que reflejan los structs Serde del backend
├── public/                    # splashscreen.html + logo (fuera del bundle de React)
└── src-tauri/                 # Backend Rust
    └── src/
        ├── commands/          # Un modulo por dominio (~37 archivos)
        ├── db.rs              # Conexion y esquema de SQLite
        ├── tray.rs             # Icono de bandeja y comportamiento de la ventana
        └── main.rs
```

## Pendiente conocido

- **Captura de paquetes (Wireshark-lite)**: evaluado y descartado por ahora
  — requeriría que el usuario tenga **Npcap** instalado por separado, una
  dependencia Rust nativa nueva (`pnet`/`pcap`) que no se puede verificar
  sin poder correr la app de verdad, y probablemente permisos de
  Administrador. Queda como el candidato más grande de Modo Hacker si se
  retoma más adelante
- **Auto-actualizador**: todavía sin `tauri-plugin-updater` — cada corrección
  hoy requiere reinstalar a mano. Necesita además firma de código e
  infraestructura de releases (GitHub Releases o similar) para funcionar de
  verdad, no solo el plugin
- **Base de datos** y **Plugins**: aparecen en el menú pero siguen siendo
  placeholder ("módulo en construcción"). Plugins en particular es una
  decisión de arquitectura (sandboxing, distribución) que conviene diseñar
  con cuidado antes de programar, no solo código pendiente
- **Git**: solo push/pull/fetch por SSH (HTTPS se dejó fuera a propósito —
  requeriría una compilación vendorizada de OpenSSL que necesita Perl)
- **GeoIP** en el módulo de Red: requiere una license key gratuita de MaxMind
  que cada usuario debe conseguir por su cuenta (no se puede redistribuir la
  base de datos sin ese acuerdo de licencia)
- **Autocompletado real (Tab) en la Terminal**: evaluado y descartado a
  propósito — PowerShell/cmd ya hacen su propio tab-completion nativo dentro
  del PTY, e interceptar Tab para una versión propia más limitada rompería
  eso. Lo que sí se hizo es un buscador rápido de comandos (ver arriba)
- Internacionalización (hoy todo está en español) y un tema claro real
- **Modo Flota** comparte el estado de Sentinel entre instancias, pero no
  hay forma todavía de actuar a distancia (ej. iniciar Sentinel en otro
  equipo desde el Centro de Operaciones) — es solo lectura por ahora
- Nadie confirmó todavía que lo construido hoy se vea bien en una pantalla
  real — no logré que la ventana renderice desde este entorno de ejecución
  en toda la sesión (ver sección de abajo)
