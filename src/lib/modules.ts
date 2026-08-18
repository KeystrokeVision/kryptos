import {
  LayoutDashboard,
  TerminalSquare,
  FolderTree,
  LayoutGrid,
  Cpu,
  Cog,
  Network,
  ServerCog,
  GitBranch,
  Container,
  FileCode2,
  Database,
  ScrollText,
  Settings,
  Users,
  Blocks,
  ShieldCheck,
  MessageSquare,
  Radar,
  Skull,
  PlaySquare,
  type LucideIcon,
} from "lucide-react";
import type { ModuleId } from "@/store/useTabStore";

export interface ModuleDef {
  id: ModuleId;
  label: string;
  description: string;
  icon: LucideIcon;
  group: "core" | "systems" | "dev" | "config";
}

export const MODULES: ModuleDef[] = [
  { id: "dashboard", label: "Dashboard", description: "Vision general del sistema", icon: LayoutDashboard, group: "core" },
  { id: "terminal", label: "Terminal", description: "Shell integrada", icon: TerminalSquare, group: "core" },
  { id: "explorer", label: "Explorador", description: "Administrador de archivos", icon: FolderTree, group: "core" },
  { id: "apps", label: "Aplicaciones", description: "Tus programas, a un clic", icon: LayoutGrid, group: "core" },

  { id: "processes", label: "Procesos", description: "Procesos en ejecucion", icon: Cpu, group: "systems" },
  { id: "services", label: "Servicios", description: "Servicios del sistema", icon: Cog, group: "systems" },
  { id: "network", label: "Red", description: "Interfaces y conexiones", icon: Network, group: "systems" },
  { id: "ssh", label: "SSH", description: "Conexiones remotas", icon: ServerCog, group: "systems" },
  { id: "chat", label: "Chat", description: "Mensajeria interna en tu red local", icon: MessageSquare, group: "systems" },
  { id: "security", label: "Seguridad", description: "Integridad de archivos, TLS y mas", icon: ShieldCheck, group: "systems" },
  { id: "opscenter", label: "Centro de Operaciones", description: "Vista general de seguridad en vivo", icon: Radar, group: "systems" },
  { id: "hackertoolkit", label: "Modo Hacker", description: "OSINT pasivo, cripto, estego y mas — todo legal", icon: Skull, group: "systems" },

  { id: "git", label: "Git", description: "Repositorios", icon: GitBranch, group: "dev" },
  { id: "docker", label: "Docker", description: "Contenedores e imagenes", icon: Container, group: "dev" },
  { id: "editor", label: "Editor", description: "Editor de codigo", icon: FileCode2, group: "dev" },
  { id: "scripts", label: "Scripts", description: "Tus scripts guardados, listos para correr", icon: PlaySquare, group: "dev" },
  { id: "database", label: "Base de datos", description: "SQLite / PostgreSQL / MySQL", icon: Database, group: "dev" },
  { id: "logs", label: "Logs", description: "Registros del sistema", icon: ScrollText, group: "dev" },

  { id: "users", label: "Usuarios", description: "Cuentas del sistema", icon: Users, group: "config" },
  { id: "plugins", label: "Plugins", description: "Extensiones de KRYPTOS", icon: Blocks, group: "config" },
  { id: "settings", label: "Configuracion", description: "Preferencias de la app", icon: Settings, group: "config" },
];

export const GROUP_LABELS: Record<ModuleDef["group"], string> = {
  core: "Principal",
  systems: "Sistema",
  dev: "Desarrollo",
  config: "Configuracion",
};
