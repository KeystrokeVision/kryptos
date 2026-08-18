import { create } from "zustand";

export type ModuleId =
  | "dashboard"
  | "terminal"
  | "explorer"
  | "apps"
  | "processes"
  | "services"
  | "network"
  | "ssh"
  | "chat"
  | "security"
  | "opscenter"
  | "hackertoolkit"
  | "git"
  | "docker"
  | "editor"
  | "scripts"
  | "database"
  | "logs"
  | "settings"
  | "users"
  | "plugins";

export interface Tab {
  id: string;
  moduleId: ModuleId;
  title: string;
  pinned: boolean;
  // Extra per-tab state, e.g. { path: "/etc" } for the explorer,
  // or { profileId: "..." } for an SSH session.
  params?: Record<string, string>;
}

interface TabState {
  tabs: Tab[];
  activeTabId: string | null;
  openTab: (moduleId: ModuleId, title: string, params?: Record<string, string>) => string;
  closeTab: (id: string) => void;
  duplicateTab: (id: string) => void;
  togglePin: (id: string) => void;
  setActive: (id: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
}

let tabCounter = 0;
const nextId = () => `tab-${Date.now()}-${tabCounter++}`;

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [
    { id: "tab-dashboard", moduleId: "dashboard", title: "Dashboard", pinned: true },
  ],
  activeTabId: "tab-dashboard",

  openTab: (moduleId, title, params) => {
    // Reuse an existing non-pinned tab of the same module+title instead of stacking duplicates,
    // mirroring how VSCode / Windows Terminal handle single-click module launches.
    const existing = get().tabs.find((t) => t.moduleId === moduleId && t.title === title);
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }
    const id = nextId();
    set((state) => ({
      tabs: [...state.tabs, { id, moduleId, title, pinned: false, params }],
      activeTabId: id,
    }));
    return id;
  },

  closeTab: (id) => {
    set((state) => {
      const tabs = state.tabs.filter((t) => t.id !== id);
      let activeTabId = state.activeTabId;
      if (activeTabId === id) {
        const closedIndex = state.tabs.findIndex((t) => t.id === id);
        activeTabId = tabs[closedIndex]?.id ?? tabs[closedIndex - 1]?.id ?? tabs[0]?.id ?? null;
      }
      return { tabs, activeTabId };
    });
  },

  duplicateTab: (id) => {
    set((state) => {
      const source = state.tabs.find((t) => t.id === id);
      if (!source) return state;
      const newTab: Tab = { ...source, id: nextId(), pinned: false };
      const index = state.tabs.findIndex((t) => t.id === id);
      const tabs = [...state.tabs];
      tabs.splice(index + 1, 0, newTab);
      return { tabs, activeTabId: newTab.id };
    });
  },

  togglePin: (id) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t)),
    }));
  },

  setActive: (id) => set({ activeTabId: id }),

  reorderTabs: (fromIndex, toIndex) => {
    set((state) => {
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(fromIndex, 1);
      tabs.splice(toIndex, 0, moved);
      return { tabs };
    });
  },
}));
