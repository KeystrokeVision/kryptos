export interface TerminalSnippet {
  id: string;
  label: string;
  description: string;
  os: "windows" | "linux" | "any";
  command: string;
}

export const TERMINAL_SNIPPETS: TerminalSnippet[] = [
  { id: "win-ports", label: "Puertos en escucha", description: "Que proceso tiene abierto cada puerto", os: "windows", command: "netstat -ano | findstr LISTENING" },
  { id: "win-ipconfig", label: "Configuracion de red", description: "IP, gateway, DNS de todos los adaptadores", os: "windows", command: "ipconfig /all" },
  { id: "win-services", label: "Servicios corriendo", description: "Servicios activos del sistema", os: "windows", command: "Get-Service | Where-Object {$_.Status -eq 'Running'}" },
  { id: "win-top-cpu", label: "Procesos por CPU", description: "Los 10 procesos que mas CPU usan", os: "windows", command: "Get-Process | Sort-Object CPU -Descending | Select-Object -First 10" },
  { id: "win-disk", label: "Espacio en disco", description: "Uso de espacio por unidad", os: "windows", command: "Get-PSDrive -PSProvider FileSystem" },
  { id: "win-flush-dns", label: "Limpiar cache DNS", description: "Util cuando un sitio no resuelve bien", os: "windows", command: "ipconfig /flushdns" },
  { id: "win-firewall-status", label: "Estado del firewall", description: "Los tres perfiles de Windows Firewall", os: "windows", command: "Get-NetFirewallProfile | Select-Object Name, Enabled" },
  { id: "linux-ports", label: "Puertos en escucha", description: "Que proceso tiene abierto cada puerto", os: "linux", command: "ss -tulpn" },
  { id: "linux-ip", label: "Configuracion de red", description: "Direcciones IP de todas las interfaces", os: "linux", command: "ip addr show" },
  { id: "linux-top-cpu", label: "Procesos por CPU", description: "Los 10 procesos que mas CPU usan", os: "linux", command: "ps aux --sort=-%cpu | head -n 11" },
  { id: "linux-disk", label: "Espacio en disco", description: "Uso de espacio por particion", os: "linux", command: "df -h" },
  { id: "linux-services", label: "Servicios activos", description: "Servicios systemd corriendo", os: "linux", command: "systemctl list-units --type=service --state=running" },
  { id: "any-ping-google", label: "Probar conectividad", description: "Ping rapido a un DNS publico conocido", os: "any", command: "ping 8.8.8.8" },
  { id: "any-whoami", label: "Usuario y permisos actuales", description: "Quien sos y con que permisos corres", os: "any", command: "whoami" },
];
