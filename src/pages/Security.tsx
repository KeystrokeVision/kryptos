import { useState } from "react";
import { FileCheck2, Lock, Network, ScrollText, Flame, ScanSearch, History, Globe, ShieldHalf, KeyRound, CalendarClock, Eye, ShieldCheck, Siren, FileLock2, Radar, Fish, type LucideIcon } from "lucide-react";
import { SentinelPanel } from "@/components/security/SentinelPanel";
import { HoneytokenPanel } from "@/components/security/HoneytokenPanel";
import { FileIntegrityPanel } from "@/components/security/FileIntegrityPanel";
import { TlsPanel } from "@/components/security/TlsPanel";
import { CvePanel } from "@/components/security/CvePanel";
import { NetworkScanPanel } from "@/components/security/NetworkScanPanel";
import { SecurityLogsPanel } from "@/components/security/SecurityLogsPanel";
import { FirewallPanel } from "@/components/security/FirewallPanel";
import { AuditLogPanel } from "@/components/security/AuditLogPanel";
import { DnsWhoisPanel } from "@/components/security/DnsWhoisPanel";
import { SecurityHeadersPanel } from "@/components/security/SecurityHeadersPanel";
import { PasswordToolsPanel } from "@/components/security/PasswordToolsPanel";
import { PersistencePanel } from "@/components/security/PersistencePanel";
import { FileWatcherPanel } from "@/components/security/FileWatcherPanel";
import { BaselinePanel } from "@/components/security/BaselinePanel";
import { PanicPanel } from "@/components/security/PanicPanel";
import { FileCryptoPanel } from "@/components/security/FileCryptoPanel";
import { cn } from "@/lib/utils";

interface SecurityTool {
  id: string;
  label: string;
  icon: LucideIcon;
  status: "ready" | "soon";
}

const TOOLS: SecurityTool[] = [
  { id: "sentinel", label: "Sentinel — vigilancia", icon: Radar, status: "ready" },
  { id: "honeytoken", label: "Honeytokens", icon: Fish, status: "ready" },
  { id: "baseline", label: "Linea base de seguridad", icon: ShieldCheck, status: "ready" },
  { id: "integrity", label: "Integridad de archivos", icon: FileCheck2, status: "ready" },
  { id: "tls", label: "Verificador SSL/TLS", icon: Lock, status: "ready" },
  { id: "cve", label: "Consulta de CVE", icon: ScanSearch, status: "ready" },
  { id: "nmap", label: "Escaneo de red avanzado", icon: Network, status: "ready" },
  { id: "logs", label: "Analisis de logs", icon: ScrollText, status: "ready" },
  { id: "firewall", label: "Firewall local", icon: Flame, status: "ready" },
  { id: "audit", label: "Historial de auditoria", icon: History, status: "ready" },
  { id: "dnswhois", label: "DNS / WHOIS", icon: Globe, status: "ready" },
  { id: "headers", label: "Cabeceras HTTP", icon: ShieldHalf, status: "ready" },
  { id: "passwords", label: "Contrasenas", icon: KeyRound, status: "ready" },
  { id: "persistence", label: "Tareas programadas", icon: CalendarClock, status: "ready" },
  { id: "filewatch", label: "Vigilante de archivos", icon: Eye, status: "ready" },
  { id: "panic", label: "Modo panico", icon: Siren, status: "ready" },
  { id: "filecrypto", label: "Cifrado de archivos", icon: FileLock2, status: "ready" },
];

/**
 * The Security module: blue-team / admin-focused tools (own-infrastructure
 * recon, integrity checks, TLS hygiene) — never offensive tooling. Grows
 * one tool at a time, same pattern as the Terminal module's internal tabs.
 */
export default function Security() {
  const [activeId, setActiveId] = useState("sentinel");
  const active = TOOLS.find((t) => t.id === activeId)!;

  return (
    <div className="flex h-full">
      <div className="flex w-52 shrink-0 flex-col border-r border-borderMuted bg-panelAlt py-2">
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          const isActive = tool.id === activeId;
          return (
            <button
              key={tool.id}
              onClick={() => tool.status === "ready" && setActiveId(tool.id)}
              disabled={tool.status === "soon"}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors",
                isActive ? "border-r-2 border-accent-bright bg-overlay/[0.04] text-text" : "text-text-muted hover:bg-overlay/[0.03]",
                tool.status === "soon" && "cursor-not-allowed opacity-40"
              )}
            >
              <Icon size={14} className={isActive ? "text-accent-bright" : "text-text-dim"} />
              <span className="flex-1">{tool.label}</span>
              {tool.status === "soon" && <span className="text-[9px] uppercase tracking-wide text-text-dim">pronto</span>}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1">
        {active.id === "sentinel" && <SentinelPanel />}
        {active.id === "honeytoken" && <HoneytokenPanel />}
        {active.id === "integrity" && <FileIntegrityPanel />}
        {active.id === "tls" && <TlsPanel />}
        {active.id === "cve" && <CvePanel />}
        {active.id === "nmap" && <NetworkScanPanel />}
        {active.id === "logs" && <SecurityLogsPanel />}
        {active.id === "firewall" && <FirewallPanel />}
        {active.id === "audit" && <AuditLogPanel />}
        {active.id === "dnswhois" && <DnsWhoisPanel />}
        {active.id === "headers" && <SecurityHeadersPanel />}
        {active.id === "passwords" && <PasswordToolsPanel />}
        {active.id === "persistence" && <PersistencePanel />}
        {active.id === "filewatch" && <FileWatcherPanel />}
        {active.id === "baseline" && <BaselinePanel />}
        {active.id === "panic" && <PanicPanel />}
        {active.id === "filecrypto" && <FileCryptoPanel />}
      </div>
    </div>
  );
}
