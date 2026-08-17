import type { Tab } from "@/store/useTabStore";
import { MODULES } from "@/lib/modules";
import Dashboard from "@/pages/Dashboard";
import Terminal from "@/pages/Terminal";
import Security from "@/pages/Security";
import OperationsCenter from "@/pages/OperationsCenter";
import HackerToolkit from "@/pages/HackerToolkit";
import Apps from "@/pages/Apps";
import Explorer from "@/pages/Explorer";
import Processes from "@/pages/Processes";
import Services from "@/pages/Services";
import NetworkModule from "@/pages/Network";
import Settings from "@/pages/Settings";
import UsersPage from "@/pages/Users";
import Logs from "@/pages/Logs";
import CodeEditor from "@/pages/Editor";
import Git from "@/pages/Git";
import Docker from "@/pages/Docker";
import Ssh from "@/pages/Ssh";
import Chat from "@/pages/Chat";
import Database from "@/pages/Database";
import ModulePlaceholder from "@/pages/ModulePlaceholder";

/**
 * Every tab renders through here. Every module in the original roadmap —
 * Dashboard, Terminal, Security, Apps, Explorer, Processes, Services,
 * Network, Settings, Users, Logs, Editor, Git, Docker, SSH, and Base de
 * datos — is now wired to live data. Only Plugins is still a placeholder.
 */
export function ModuleView({ tab }: { tab: Tab }) {
  const mod = MODULES.find((m) => m.id === tab.moduleId)!;

  switch (tab.moduleId) {
    case "dashboard":
      return <Dashboard />;
    case "terminal":
      return <Terminal />;
    case "security":
      return <Security />;
    case "opscenter":
      return <OperationsCenter />;
    case "hackertoolkit":
      return <HackerToolkit />;
    case "apps":
      return <Apps />;
    case "explorer":
      return <Explorer />;
    case "processes":
      return <Processes />;
    case "services":
      return <Services />;
    case "network":
      return <NetworkModule />;
    case "settings":
      return <Settings />;
    case "users":
      return <UsersPage />;
    case "logs":
      return <Logs />;
    case "editor":
      return <CodeEditor />;
    case "git":
      return <Git />;
    case "docker":
      return <Docker />;
    case "ssh":
      return <Ssh />;
    case "chat":
      return <Chat />;
    case "database":
      return <Database />;
    default:
      return <ModulePlaceholder icon={mod.icon} title={mod.label} description={mod.description} />;
  }
}
