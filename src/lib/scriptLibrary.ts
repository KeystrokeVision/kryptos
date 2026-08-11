export type ScriptCategory = "git" | "entorno" | "sistema" | "redes" | "hacking" | "hardening";

export interface ScriptSnippet {
  id: string;
  title: string;
  description: string;
  category: ScriptCategory;
  language: string;
  extension: string;
  os: "windows" | "linux" | "any";
  code: string;
}

export const SCRIPT_CATEGORIES: Record<ScriptCategory, string> = {
  git: "Git / GitHub",
  entorno: "Entorno de desarrollo",
  sistema: "Sistema (estilo Termux/Linux)",
  redes: "Red",
  hacking: "Recon y auditoria propia",
  hardening: "Hardening y auditoria",
};

// Biblioteca de scripts reales, listos para abrir en una pestana del Editor
// y correr con "Ejecutar" — el mismo botón que ya detecta entornos virtuales
// de Python. La idea es que el Editor se sienta como una terminal Termux con
// memoria: no solo edita texto, tiene a mano el comando que ibas a buscar en
// Google de todas formas.
export const SCRIPT_LIBRARY: ScriptSnippet[] = [
  // ------------------------------------------------------------------
  // Git / GitHub
  // ------------------------------------------------------------------
  {
    id: "git-quick-commit-push",
    title: "Commit rapido + push",
    description: "Agrega todo, commitea con el mensaje que le pases, y empuja a la rama actual.",
    category: "git",
    language: "shell",
    extension: "sh",
    os: "any",
    code: `#!/bin/bash
# Uso: ./quick-commit.sh "mensaje del commit"
set -e
MSG="\${1:-actualizacion}"
git add -A
git commit -m "$MSG"
git push origin "$(git branch --show-current)"
echo "Listo: pusheado a $(git branch --show-current)"
`,
  },
  {
    id: "git-ssh-key-github",
    title: "Generar llave SSH y prepararla para GitHub",
    description: "Crea un par de llaves ed25519, la agrega al ssh-agent, y te muestra la clave publica para pegar en GitHub > Settings > SSH keys.",
    category: "git",
    language: "shell",
    extension: "sh",
    os: "any",
    code: `#!/bin/bash
# Genera una llave SSH nueva para usar con GitHub.
set -e
read -p "Email para la llave: " EMAIL
KEY_PATH="$HOME/.ssh/id_ed25519_github"
ssh-keygen -t ed25519 -C "$EMAIL" -f "$KEY_PATH"
eval "$(ssh-agent -s)"
ssh-add "$KEY_PATH"
echo
echo "=== Copia esta clave publica a GitHub > Settings > SSH and GPG keys ==="
cat "$KEY_PATH.pub"
`,
  },
  {
    id: "git-fork-upstream",
    title: "Configurar upstream de un fork",
    description: "Despues de clonar tu fork, agrega el repo original como 'upstream' para poder traer sus cambios.",
    category: "git",
    language: "shell",
    extension: "sh",
    os: "any",
    code: `#!/bin/bash
# Uso: ./setup-upstream.sh https://github.com/owner/repo.git
set -e
UPSTREAM_URL="$1"
if [ -z "$UPSTREAM_URL" ]; then
  echo "Uso: $0 <url-del-repo-original>"
  exit 1
fi
git remote add upstream "$UPSTREAM_URL"
git fetch upstream
echo "Upstream configurado. Para traer cambios: git merge upstream/main"
`,
  },
  {
    id: "git-gh-pr-create",
    title: "Crear Pull Request con GitHub CLI",
    description: "Empuja la rama actual y abre un PR contra main usando 'gh' (GitHub CLI). Requiere tener gh instalado y autenticado (gh auth login).",
    category: "git",
    language: "shell",
    extension: "sh",
    os: "any",
    code: `#!/bin/bash
set -e
BRANCH="$(git branch --show-current)"
git push -u origin "$BRANCH"
gh pr create --fill --base main --head "$BRANCH"
`,
  },
  {
    id: "git-clean-merged-branches",
    title: "Limpiar ramas locales ya mergeadas",
    description: "Borra las ramas locales que ya fueron mergeadas a main, sin tocar main ni las que siguen abiertas.",
    category: "git",
    language: "shell",
    extension: "sh",
    os: "any",
    code: `#!/bin/bash
set -e
git fetch -p
git branch --merged main | grep -v "^\\*\\|main" | xargs -r git branch -d
echo "Ramas mergeadas eliminadas."
`,
  },
  {
    id: "git-undo-last-commit",
    title: "Deshacer el ultimo commit (sin perder cambios)",
    description: "Soft reset: el commit desaparece pero los cambios quedan en el area de staging, listos para corregir.",
    category: "git",
    language: "shell",
    extension: "sh",
    os: "any",
    code: `#!/bin/bash
git reset --soft HEAD~1
echo "Ultimo commit deshecho. Los cambios siguen en staging (git status)."
`,
  },
  {
    id: "git-search-history",
    title: "Buscar cuando se agrego/borro una linea de codigo",
    description: "Busca en todo el historial de commits los que agregaron o quitaron una cadena de texto especifica.",
    category: "git",
    language: "shell",
    extension: "sh",
    os: "any",
    code: `#!/bin/bash
# Uso: ./search-history.sh "texto a buscar"
git log -S"$1" --oneline --all
`,
  },
  {
    id: "git-clone-all-org",
    title: "Clonar todos los repos de una organizacion",
    description: "Usa GitHub CLI para listar y clonar de una todos los repos publicos de un usuario u organizacion.",
    category: "git",
    language: "shell",
    extension: "sh",
    os: "any",
    code: `#!/bin/bash
# Uso: ./clone-all.sh nombre-org
set -e
ORG="$1"
mkdir -p "$ORG" && cd "$ORG"
gh repo list "$ORG" --limit 200 --json nameWithOwner -q '.[].nameWithOwner' | \\
  xargs -n1 -I{} gh repo clone {}
`,
  },

  // ------------------------------------------------------------------
  // Entorno de desarrollo (estilo package manager de Termux)
  // ------------------------------------------------------------------
  {
    id: "env-nvm-node-lts",
    title: "Instalar Node.js LTS via nvm",
    description: "Instala nvm si no esta presente, y con el instala y activa la ultima version LTS de Node.",
    category: "entorno",
    language: "shell",
    extension: "sh",
    os: "linux",
    code: `#!/bin/bash
set -e
if [ ! -d "$HOME/.nvm" ]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \\. "$NVM_DIR/nvm.sh"
nvm install --lts
nvm use --lts
node -v
`,
  },
  {
    id: "env-winget-devtools",
    title: "Instalar herramientas de dev basicas (Windows)",
    description: "Instala Git, Node LTS, Python y VS Code de una via winget. Cada uno se salta solo si ya esta instalado.",
    category: "entorno",
    language: "powershell",
    extension: "ps1",
    os: "windows",
    code: `# Instala herramientas de desarrollo basicas via winget
$paquetes = @("Git.Git", "OpenJS.NodeJS.LTS", "Python.Python.3.12", "Microsoft.VisualStudioCode")
foreach ($p in $paquetes) {
    Write-Host "Instalando $p..."
    winget install --id $p --silent --accept-package-agreements --accept-source-agreements
}
`,
  },
  {
    id: "env-python-venv",
    title: "Crear y activar un entorno virtual de Python",
    description: "Crea .venv en la carpeta actual, lo activa, y actualiza pip. El boton Ejecutar de KRYPTOS ya detecta estos entornos despues.",
    category: "entorno",
    language: "shell",
    extension: "sh",
    os: "any",
    code: `#!/bin/bash
set -e
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
echo "Entorno virtual listo en .venv — activalo con: source .venv/bin/activate"
`,
  },
  {
    id: "env-rustup-install",
    title: "Instalar Rust via rustup",
    description: "Instalador oficial de Rust, no interactivo, mas la toolchain estable.",
    category: "entorno",
    language: "shell",
    extension: "sh",
    os: "linux",
    code: `#!/bin/bash
set -e
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustc --version
cargo --version
`,
  },
  {
    id: "env-dotfiles-symlinks",
    title: "Symlinkear dotfiles a un repo",
    description: "Crea symlinks desde un repo de dotfiles a $HOME — la forma clasica de mantener config versionada sin copiar archivos.",
    category: "entorno",
    language: "shell",
    extension: "sh",
    os: "linux",
    code: `#!/bin/bash
# Uso: ./link-dotfiles.sh ~/proyectos/dotfiles
set -e
DOTFILES="$1"
for archivo in "$DOTFILES"/.*; do
  nombre=$(basename "$archivo")
  [ "$nombre" = "." ] || [ "$nombre" = ".." ] || [ "$nombre" = ".git" ] && continue
  ln -sfv "$archivo" "$HOME/$nombre"
done
`,
  },

  // ------------------------------------------------------------------
  // Sistema (estilo Termux/Linux)
  // ------------------------------------------------------------------
  {
    id: "sys-quick-backup",
    title: "Backup rapido de una carpeta con timestamp",
    description: "Comprime una carpeta a .tar.gz con la fecha en el nombre — un backup manual de un segundo.",
    category: "sistema",
    language: "shell",
    extension: "sh",
    os: "any",
    code: `#!/bin/bash
# Uso: ./backup.sh ~/proyectos/mi-app
set -e
ORIGEN="$1"
NOMBRE="$(basename "$ORIGEN")-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$NOMBRE" "$ORIGEN"
echo "Backup creado: $NOMBRE ($(du -h "$NOMBRE" | cut -f1))"
`,
  },
  {
    id: "sys-kill-by-name",
    title: "Buscar y terminar procesos por nombre",
    description: "Lista los procesos que matchean un nombre y pide confirmacion antes de matarlos.",
    category: "sistema",
    language: "shell",
    extension: "sh",
    os: "linux",
    code: `#!/bin/bash
# Uso: ./kill-by-name.sh nombre-proceso
NOMBRE="$1"
PIDS=$(pgrep -f "$NOMBRE")
if [ -z "$PIDS" ]; then
  echo "No hay procesos corriendo que matcheen '$NOMBRE'."
  exit 0
fi
echo "Procesos encontrados:"
ps -fp $PIDS
read -p "¿Terminarlos? (s/N) " CONFIRM
[ "$CONFIRM" = "s" ] && kill $PIDS && echo "Listo." || echo "Cancelado."
`,
  },
  {
    id: "sys-disk-usage-top",
    title: "Que carpetas ocupan mas espacio",
    description: "Las 15 carpetas mas pesadas dentro de la actual, ordenadas de mayor a menor.",
    category: "sistema",
    language: "shell",
    extension: "sh",
    os: "linux",
    code: `#!/bin/bash
du -h --max-depth=1 . 2>/dev/null | sort -rh | head -n 15
`,
  },
  {
    id: "sys-http-server",
    title: "Servidor HTTP local rapido",
    description: "Comparte la carpeta actual por HTTP en la red local — util para pasar un archivo a otro equipo sin USB.",
    category: "sistema",
    language: "shell",
    extension: "sh",
    os: "any",
    code: `#!/bin/bash
PUERTO="\${1:-8000}"
echo "Sirviendo $(pwd) en http://0.0.0.0:$PUERTO — Ctrl+C para cortar"
python3 -m http.server "$PUERTO"
`,
  },
  {
    id: "sys-clean-temp",
    title: "Limpiar temporales y cache de paquetes (Windows)",
    description: "Vacia %TEMP% y limpia la cache de winget — el equivalente a 'apt clean' de Termux.",
    category: "sistema",
    language: "powershell",
    extension: "ps1",
    os: "windows",
    code: `# Limpia archivos temporales del usuario actual
Get-ChildItem -Path $env:TEMP -Recurse -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Temporales limpiados."
`,
  },

  // ------------------------------------------------------------------
  // Red
  // ------------------------------------------------------------------
  {
    id: "net-ping-sweep",
    title: "Ping sweep de tu propia red local",
    description: "Barrido de ping a los 254 hosts de una subred /24 propia, mostrando cuales responden. Solo ICMP, nada intrusivo.",
    category: "redes",
    language: "shell",
    extension: "sh",
    os: "linux",
    code: `#!/bin/bash
# Uso: ./ping-sweep.sh 192.168.1
BASE="\${1:-192.168.1}"
for i in $(seq 1 254); do
  (ping -c1 -W1 "$BASE.$i" &>/dev/null && echo "$BASE.$i esta activo") &
done
wait
`,
  },
  {
    id: "net-port-check",
    title: "Verificar puertos comunes en un host propio",
    description: "Chequea rapido si los puertos mas comunes (22, 80, 443, 3306, 5432...) estan abiertos en un host que administras.",
    category: "redes",
    language: "shell",
    extension: "sh",
    os: "linux",
    code: `#!/bin/bash
# Uso: ./port-check.sh mi-servidor.com
HOST="$1"
for PUERTO in 21 22 80 443 3306 5432 6379 8080; do
  timeout 1 bash -c "echo > /dev/tcp/$HOST/$PUERTO" 2>/dev/null && echo "Puerto $PUERTO: abierto" || echo "Puerto $PUERTO: cerrado"
done
`,
  },
  {
    id: "net-export-firewall-rules",
    title: "Exportar reglas de firewall actuales (Windows)",
    description: "Guarda todas las reglas del Firewall de Windows en un archivo — util antes de hacer cambios grandes.",
    category: "redes",
    language: "powershell",
    extension: "ps1",
    os: "windows",
    code: `$destino = "firewall-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss').wfw"
netsh advfirewall export $destino
Write-Host "Reglas exportadas a $destino"
`,
  },

  // ------------------------------------------------------------------
  // Recon y auditoria propia (mismo espiritu que el modulo Modo Hacker)
  // ------------------------------------------------------------------
  {
    id: "hack-domain-footprint-report",
    title: "Reporte de huella de un dominio propio",
    description: "DNS + WHOIS + cabeceras de seguridad de un dominio, todo en un solo archivo de texto — version portable del panel 'Huella propia'.",
    category: "hacking",
    language: "shell",
    extension: "sh",
    os: "linux",
    code: `#!/bin/bash
# Uso: ./footprint.sh midominio.com
set -e
DOMINIO="$1"
SALIDA="footprint-$DOMINIO-$(date +%Y%m%d).txt"

{
  echo "=== Reporte de huella para $DOMINIO ==="
  echo
  echo "--- DNS ---"
  dig "$DOMINIO" ANY +noall +answer
  echo
  echo "--- WHOIS ---"
  whois "$DOMINIO"
  echo
  echo "--- Cabeceras HTTP ---"
  curl -sI "https://$DOMINIO"
} > "$SALIDA"

echo "Reporte guardado en $SALIDA"
`,
  },
  {
    id: "hack-tls-cert-check",
    title: "Verificar certificado TLS y fecha de expiracion",
    description: "Muestra el certificado que sirve tu dominio y cuantos dias faltan para que expire.",
    category: "hacking",
    language: "shell",
    extension: "sh",
    os: "linux",
    code: `#!/bin/bash
# Uso: ./cert-check.sh midominio.com
DOMINIO="$1"
echo | openssl s_client -connect "$DOMINIO:443" -servername "$DOMINIO" 2>/dev/null | \\
  openssl x509 -noout -dates -subject -issuer
`,
  },
  {
    id: "hack-quick-hardening-report",
    title: "Reporte rapido de hardening (Linux)",
    description: "Junta varios chequeos de solo lectura (SUID, SSH config, puertos abiertos) en un solo reporte.",
    category: "hacking",
    language: "shell",
    extension: "sh",
    os: "linux",
    code: `#!/bin/bash
SALIDA="hardening-report-$(date +%Y%m%d).txt"
{
  echo "=== Puertos en escucha ==="
  ss -tulpn
  echo
  echo "=== Binarios con SUID ==="
  find / -perm -4000 -type f 2>/dev/null
  echo
  echo "=== Config SSH relevante ==="
  grep -Ei '^\\s*(PermitRootLogin|PasswordAuthentication)\\b' /etc/ssh/sshd_config 2>/dev/null
} > "$SALIDA"
echo "Reporte guardado en $SALIDA"
`,
  },

  // ------------------------------------------------------------------
  // Hardening (los originales de KRYPTOS)
  // ------------------------------------------------------------------
  {
    id: "win-audit-open-ports",
    title: "Windows: puertos abiertos y su proceso",
    description: "Lista cada puerto en escucha junto con el proceso que lo tiene abierto. Solo lectura.",
    category: "hardening",
    language: "powershell",
    extension: "ps1",
    os: "windows",
    code: `# Puertos en escucha + proceso propietario
Get-NetTCPConnection -State Listen | ForEach-Object {
    $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    [PSCustomObject]@{
        LocalPort = $_.LocalPort
        Proceso   = $proc.ProcessName
        PID       = $_.OwningProcess
    }
} | Sort-Object LocalPort | Format-Table -AutoSize
`,
  },
  {
    id: "win-audit-password-policy",
    title: "Windows: auditar politica de contrasenas local",
    description: "Muestra la politica de contrasenas y bloqueo de cuenta configurada localmente. Solo lectura.",
    category: "hardening",
    language: "powershell",
    extension: "ps1",
    os: "windows",
    code: `# Politica de contrasenas y bloqueo de cuenta (solo lectura)
net accounts

Write-Host "\`n--- Politica detallada (secedit) ---"
$tmp = "$env:TEMP\\secpol.cfg"
secedit /export /cfg $tmp /quiet
Get-Content $tmp | Select-String "Password|Lockout"
Remove-Item $tmp -ErrorAction SilentlyContinue
`,
  },
  {
    id: "win-disable-smbv1",
    title: "Windows: deshabilitar SMBv1",
    description: "SMBv1 es un protocolo obsoleto y vulnerable (el que exploto WannaCry). Deshabilitarlo es una recomendacion estandar de hardening. Requiere Administrador.",
    category: "hardening",
    language: "powershell",
    extension: "ps1",
    os: "windows",
    code: `# Deshabilitar SMBv1 (protocolo obsoleto, vulnerable a EternalBlue/WannaCry)
# Requiere ejecutar como Administrador.
Disable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -NoRestart
Write-Host "SMBv1 deshabilitado. Puede requerir reiniciar el equipo."
`,
  },
  {
    id: "win-enable-ps-logging",
    title: "Windows: habilitar registro de PowerShell",
    description: "Activa Module Logging y Script Block Logging — util para detectar actividad sospechosa despues. Requiere Administrador.",
    category: "hardening",
    language: "powershell",
    extension: "ps1",
    os: "windows",
    code: `# Habilita registro detallado de PowerShell (Module + ScriptBlock logging)
# Requiere ejecutar como Administrador.
$base = "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell"
New-Item -Path "$base\\ScriptBlockLogging" -Force | Out-Null
Set-ItemProperty -Path "$base\\ScriptBlockLogging" -Name "EnableScriptBlockLogging" -Value 1

New-Item -Path "$base\\ModuleLogging" -Force | Out-Null
Set-ItemProperty -Path "$base\\ModuleLogging" -Name "EnableModuleLogging" -Value 1

Write-Host "Registro de PowerShell habilitado. Revisa el Visor de eventos > Microsoft-Windows-PowerShell/Operational."
`,
  },
  {
    id: "linux-audit-ssh-config",
    title: "Linux: auditar configuracion de sshd",
    description: "Revisa sshd_config buscando ajustes riesgosos comunes (root login, auth por password, protocolo viejo). Solo lectura.",
    category: "hardening",
    language: "shell",
    extension: "sh",
    os: "linux",
    code: `#!/bin/bash
# Auditoria de sshd_config — solo lectura, no cambia nada.
CONFIG="/etc/ssh/sshd_config"

echo "=== Ajustes relevantes de $CONFIG ==="
grep -Ei '^\\s*(PermitRootLogin|PasswordAuthentication|PermitEmptyPasswords|X11Forwarding|Protocol)\\b' "$CONFIG"

echo
echo "=== Recomendaciones estandar ==="
echo "- PermitRootLogin deberia ser 'no' o 'prohibit-password'"
echo "- PasswordAuthentication 'no' si usas llaves (mas seguro)"
echo "- PermitEmptyPasswords siempre deberia ser 'no'"
`,
  },
  {
    id: "linux-audit-world-writable",
    title: "Linux: archivos con permisos inseguros",
    description: "Busca archivos con permiso de escritura para cualquier usuario en rutas del sistema. Solo lectura.",
    category: "hardening",
    language: "shell",
    extension: "sh",
    os: "linux",
    code: `#!/bin/bash
# Busca archivos world-writable en rutas criticas del sistema (solo lectura)
echo "Buscando archivos con permiso de escritura para 'otros' (puede tardar)..."
find /etc /usr /opt -xdev -type f -perm -0002 2>/dev/null

echo
echo "Buscando directorios world-writable sin sticky bit (mas riesgoso que /tmp normal)..."
find /etc /usr /opt -xdev -type d -perm -0002 ! -perm -1000 2>/dev/null
`,
  },
];
