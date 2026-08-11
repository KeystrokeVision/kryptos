export interface CheatsheetEntry {
  id: string;
  category: "archivos" | "permisos" | "procesos" | "red" | "texto" | "compresion" | "git" | "recon";
  command: string;
  description: string;
}

export const CHEATSHEET_CATEGORIES: Record<CheatsheetEntry["category"], string> = {
  archivos: "Archivos y busqueda",
  permisos: "Permisos y usuarios",
  procesos: "Procesos y jobs",
  red: "Red",
  texto: "Procesamiento de texto",
  compresion: "Compresion y backups",
  git: "Git",
  recon: "Reconocimiento (uso propio/autorizado)",
};

// Referencia rapida tipo "cheat.sh" pero local y sin red — los comandos de
// Linux/CLI que cualquiera con espiritu hacker termina buscando en Google
// cada dos semanas. Sintaxis de herramientas reales; ejecutarlas contra un
// sistema que no es tuyo sigue estando fuera de la politica de KRYPTOS.
export const CHEATSHEET: CheatsheetEntry[] = [
  { id: "find-name", category: "archivos", command: "find . -name '*.log' -mtime -1", description: "Archivos .log modificados en el ultimo dia." },
  { id: "find-size", category: "archivos", command: "find / -size +100M -type f 2>/dev/null", description: "Archivos de mas de 100MB en todo el disco." },
  { id: "locate", category: "archivos", command: "locate -i nombre", description: "Busqueda rapida por indice (requiere updatedb)." },
  { id: "grep-r", category: "archivos", command: "grep -rn \"patron\" .", description: "Busca texto recursivamente mostrando numero de linea." },
  { id: "diff", category: "archivos", command: "diff -u archivo1 archivo2", description: "Diferencias entre dos archivos en formato unificado." },
  { id: "ln-s", category: "archivos", command: "ln -s /ruta/origen enlace", description: "Crea un symlink." },

  { id: "chmod-num", category: "permisos", command: "chmod 750 script.sh", description: "rwx para el dueno, r-x para el grupo, nada para otros." },
  { id: "chown", category: "permisos", command: "chown usuario:grupo archivo", description: "Cambia dueno y grupo de un archivo." },
  { id: "sudo-l", category: "permisos", command: "sudo -l", description: "Que comandos puede correr el usuario actual con sudo." },
  { id: "id", category: "permisos", command: "id", description: "UID, GID y grupos del usuario actual." },
  { id: "suid-find", category: "permisos", command: "find / -perm -4000 -type f 2>/dev/null", description: "Binarios con el bit SUID activo — clasico chequeo de hardening." },
  { id: "last", category: "permisos", command: "last -a", description: "Historial de inicios de sesion recientes." },

  { id: "ps-aux", category: "procesos", command: "ps aux --sort=-%mem | head", description: "Procesos ordenados por uso de memoria." },
  { id: "kill", category: "procesos", command: "kill -9 PID", description: "Termina un proceso a la fuerza por su PID." },
  { id: "nohup", category: "procesos", command: "nohup ./script.sh &", description: "Corre un proceso en segundo plano, inmune a que cierres la terminal." },
  { id: "jobs", category: "procesos", command: "jobs -l", description: "Lista los procesos en segundo plano de la sesion actual." },
  { id: "strace", category: "procesos", command: "strace -f -p PID", description: "Rastrea las llamadas al sistema de un proceso en vivo." },
  { id: "lsof-p", category: "procesos", command: "lsof -p PID", description: "Que archivos y sockets tiene abiertos un proceso." },

  { id: "ss", category: "red", command: "ss -tulpn", description: "Puertos en escucha y el proceso duenio de cada uno." },
  { id: "curl-i", category: "red", command: "curl -I https://midominio.com", description: "Solo las cabeceras de la respuesta HTTP." },
  { id: "curl-verbose", category: "red", command: "curl -v https://midominio.com", description: "Ver el handshake completo (TLS incluido) de una request." },
  { id: "dig", category: "red", command: "dig midominio.com ANY +noall +answer", description: "Todos los registros DNS de un dominio." },
  { id: "traceroute", category: "red", command: "traceroute midominio.com", description: "Ruta de saltos hasta el destino." },
  { id: "nc-listen", category: "red", command: "nc -lvnp 4444", description: "Abre un listener TCP local — util para probar conectividad de tu propia red." },
  { id: "scp", category: "red", command: "scp archivo usuario@host:/ruta/", description: "Copia un archivo a un host remoto por SSH." },
  { id: "ssh-key", category: "red", command: "ssh-keygen -t ed25519 -C \"tu@email\"", description: "Genera un par de llaves SSH modernas." },

  { id: "awk-col", category: "texto", command: "awk '{print $1, $3}' archivo", description: "Extrae columnas 1 y 3 de un archivo delimitado por espacios." },
  { id: "sed-replace", category: "texto", command: "sed -i 's/viejo/nuevo/g' archivo", description: "Reemplaza texto en el archivo, en el lugar." },
  { id: "sort-uniq", category: "texto", command: "sort archivo | uniq -c | sort -rn", description: "Cuenta lineas repetidas y ordena por frecuencia." },
  { id: "jq", category: "texto", command: "curl -s api.com/datos | jq '.campo'", description: "Extrae un campo de una respuesta JSON." },
  { id: "cut", category: "texto", command: "cut -d: -f1 /etc/passwd", description: "Primer campo de un archivo delimitado por ':'." },
  { id: "xargs", category: "texto", command: "find . -name '*.tmp' | xargs rm", description: "Aplica un comando a cada linea de la entrada." },

  { id: "tar-czf", category: "compresion", command: "tar -czf backup.tar.gz carpeta/", description: "Comprime una carpeta a .tar.gz." },
  { id: "tar-xzf", category: "compresion", command: "tar -xzf backup.tar.gz", description: "Extrae un .tar.gz." },
  { id: "zip", category: "compresion", command: "zip -r salida.zip carpeta/", description: "Comprime una carpeta a .zip." },
  { id: "rsync", category: "compresion", command: "rsync -avz --progress origen/ destino/", description: "Sincroniza carpetas mostrando progreso, solo copia lo que cambio." },

  { id: "git-log-graph", category: "git", command: "git log --oneline --graph --all", description: "Historial de commits como grafo, todas las ramas." },
  { id: "git-stash", category: "git", command: "git stash && git stash pop", description: "Guarda cambios sin commitear y los recupera despues." },
  { id: "git-bisect", category: "git", command: "git bisect start", description: "Busqueda binaria del commit que introdujo un bug." },
  { id: "git-blame", category: "git", command: "git blame -L 10,20 archivo", description: "Quien toco cada linea en un rango." },
  { id: "git-reflog", category: "git", command: "git reflog", description: "Historial de a donde apunto HEAD — salva commits 'perdidos'." },

  { id: "nmap-basic", category: "recon", command: "nmap -sV -T4 192.168.1.0/24", description: "Escaneo de servicios en tu propia red local (autorizado)." },
  { id: "nmap-ports", category: "recon", command: "nmap -p- --min-rate 1000 host", description: "Todos los puertos TCP de un host que administras." },
  { id: "whois", category: "recon", command: "whois midominio.com", description: "Datos de registro publico de un dominio." },
  { id: "curl-headers-sec", category: "recon", command: "curl -sI https://midominio.com | grep -i strict", description: "Chequea si tu propio sitio manda HSTS." },
  { id: "openssl-cert", category: "recon", command: "openssl s_client -connect midominio.com:443 -servername midominio.com", description: "Inspecciona el certificado TLS que sirve tu dominio." },
];
