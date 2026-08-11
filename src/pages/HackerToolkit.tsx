import { useState } from "react";
import { Fingerprint, Binary, ImageIcon, Search, BookOpen, TerminalSquare, FlaskConical, Wifi, Usb, ShieldAlert, FileSearch, KeyRound, type LucideIcon } from "lucide-react";
import { FootprintPanel } from "@/components/hacker/FootprintPanel";
import { CryptoToolboxPanel } from "@/components/hacker/CryptoToolboxPanel";
import { SteganographyPanel } from "@/components/hacker/SteganographyPanel";
import { DorkGeneratorPanel } from "@/components/hacker/DorkGeneratorPanel";
import { CheatsheetPanel } from "@/components/hacker/CheatsheetPanel";
import { NeofetchPanel } from "@/components/hacker/NeofetchPanel";
import { LabPanel } from "@/components/hacker/LabPanel";
import { WirelessPanel } from "@/components/hacker/WirelessPanel";
import { UsbMonitorPanel } from "@/components/hacker/UsbMonitorPanel";
import { VulnScanPanel } from "@/components/hacker/VulnScanPanel";
import { BinaryAnalyzerPanel } from "@/components/hacker/BinaryAnalyzerPanel";
import { HashCrackerPanel } from "@/components/hacker/HashCrackerPanel";
import { cn } from "@/lib/utils";

interface HackerTool {
  id: string;
  label: string;
  icon: LucideIcon;
}

const TOOLS: HackerTool[] = [
  { id: "footprint", label: "Huella propia", icon: Fingerprint },
  { id: "crypto", label: "Caja de cripto", icon: Binary },
  { id: "stego", label: "Esteganografia", icon: ImageIcon },
  { id: "dorks", label: "Dorking (recon)", icon: Search },
  { id: "cheatsheet", label: "Cheatsheet Linux", icon: BookOpen },
  { id: "neofetch", label: "neofetch", icon: TerminalSquare },
  { id: "lab", label: "Laboratorio (Docker)", icon: FlaskConical },
  { id: "wireless", label: "Wi-Fi y Bluetooth", icon: Wifi },
  { id: "usb", label: "Monitor USB", icon: Usb },
  { id: "vulnscan", label: "Escaneo de CVEs instaladas", icon: ShieldAlert },
  { id: "binary", label: "Analizador de binarios", icon: FileSearch },
  { id: "cracker", label: "Cracker de hashes", icon: KeyRound },
];

/**
 * Modo Hacker: OSINT pasivo, cripto/estego estilo CTF, y estetica de
 * terminal — todo local o sobre fuentes publicas, mismo limite que el
 * modulo de Seguridad. Sigue el patron de tabs internas de Security.tsx.
 */
export default function HackerToolkit() {
  const [activeId, setActiveId] = useState("footprint");
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
              onClick={() => setActiveId(tool.id)}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors",
                isActive ? "border-r-2 border-accent-bright bg-white/[0.04] text-text" : "text-text-muted hover:bg-white/[0.03]"
              )}
            >
              <Icon size={14} className={isActive ? "text-accent-bright" : "text-text-dim"} />
              <span className="flex-1">{tool.label}</span>
            </button>
          );
        })}
        <p className="mt-auto px-3 pt-3 text-[10px] leading-relaxed text-text-dim">
          Solo pasivo, local, o sobre tus propios activos — nada de esto toca sistemas de terceros.
        </p>
      </div>

      <div className="min-h-0 flex-1">
        {active.id === "footprint" && <FootprintPanel />}
        {active.id === "crypto" && <CryptoToolboxPanel />}
        {active.id === "stego" && <SteganographyPanel />}
        {active.id === "dorks" && <DorkGeneratorPanel />}
        {active.id === "cheatsheet" && <CheatsheetPanel />}
        {active.id === "neofetch" && <NeofetchPanel />}
        {active.id === "lab" && <LabPanel />}
        {active.id === "wireless" && <WirelessPanel />}
        {active.id === "usb" && <UsbMonitorPanel />}
        {active.id === "vulnscan" && <VulnScanPanel />}
        {active.id === "binary" && <BinaryAnalyzerPanel />}
        {active.id === "cracker" && <HashCrackerPanel />}
      </div>
    </div>
  );
}
