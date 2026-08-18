import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { api } from "@/lib/tauri";
import { applyTheme, THEME_SETTING_KEY, type AppTheme } from "@/lib/theme";
import { TopBar } from "@/components/layout/TopBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { TabBar } from "@/components/layout/TabBar";
import { StatusBar } from "@/components/layout/StatusBar";
import { ModuleView } from "@/components/layout/ModuleView";
import { MonitorPanel } from "@/components/layout/MonitorPanel";
import { QuickToolsBar } from "@/components/layout/QuickToolsBar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { SentinelWatcher } from "@/components/layout/SentinelWatcher";
import { TrayBridge } from "@/components/layout/TrayBridge";
import { FleetWatcher } from "@/components/layout/FleetWatcher";
import { BreachOverlay } from "@/components/layout/BreachOverlay";
import { FleetActionListener } from "@/components/layout/FleetActionListener";
import { useTabStore } from "@/store/useTabStore";

export default function App() {
  const { tabs, activeTabId } = useTabStore();
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  useEffect(() => {
    // Wait for the splash's own boot sequence + fade-out (~4.4s, see
    // public/splashscreen.html + public/splashscreen.js) to actually finish
    // before swapping windows — otherwise a fast machine would cut the
    // matrix-rain/typing effect short.
    const timer = setTimeout(() => {
      invoke("close_splashscreen").catch(() => {});
    }, 4400);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // El tema cacheado en localStorage (aplicado sincronicamente en
    // main.tsx) ya evito el flash inicial — esto reconcilia contra la
    // preferencia real guardada en la base de datos, por si difieren (ej.
    // primer arranque sin cache local, o se reinstalo la app).
    api
      .getSetting(THEME_SETTING_KEY)
      .then((v) => {
        if (v === "light" || v === "dark") applyTheme(v as AppTheme);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-base text-text">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <TabBar />
              <main className="relative min-h-0 flex-1 overflow-hidden">
                {/* Every open tab stays mounted (hidden, not unmounted) so
                    switching tabs never kills what's running inside one —
                    a live shell in the Terminal module, an in-progress SSH
                    session, unsaved editor state, and so on. Only closing a
                    tab actually unmounts it (and, e.g., ends its PTY). */}
                {tabs.map((tab) => (
                  <div key={tab.id} className={tab.id === activeTab?.id ? "absolute inset-0" : "hidden"}>
                    <ModuleView tab={tab} />
                  </div>
                ))}
              </main>
            </div>
            <MonitorPanel />
          </div>
          <QuickToolsBar />
        </div>
      </div>
      <StatusBar />
      <CommandPalette />
      <SentinelWatcher />
      <TrayBridge />
      <FleetWatcher />
      <FleetActionListener />
      <BreachOverlay />
    </div>
  );
}
