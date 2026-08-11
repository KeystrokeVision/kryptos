import { create } from "zustand";

// Lo que cada instancia de KRYPTOS difunde de si misma por el chat P2P —
// ver chat_broadcast_status en src-tauri/src/commands/chat.rs. Es el mismo
// tipo de dato que ya usa el Centro de Operaciones para esta maquina, solo
// que ahora tambien puede llegar de otras.
export interface FleetMemberStatus {
  nick: string;
  hostname: string;
  running: boolean;
  postureScore: number | null;
  unacknowledgedCount: number;
  watchedPorts: number;
  watchedPersistence: number;
  receivedAtUnix: number;
}

interface FleetState {
  members: Record<string, FleetMemberStatus>;
  upsert: (status: FleetMemberStatus) => void;
  prune: (olderThanUnix: number) => void;
}

/**
 * Estado en memoria de "Modo Flota" — que sabe cada instancia conectada al
 * mismo chat de si misma. Vive fuera de cualquier pagina especifica
 * (Chat, OperationsCenter) porque FleetWatcher lo actualiza en segundo
 * plano independientemente de cual pestana este a la vista.
 */
export const useFleetStore = create<FleetState>((set) => ({
  members: {},
  upsert: (status) =>
    set((state) => ({
      members: { ...state.members, [status.nick]: status },
    })),
  prune: (olderThanUnix) =>
    set((state) => {
      const next: Record<string, FleetMemberStatus> = {};
      for (const [nick, member] of Object.entries(state.members)) {
        if (member.receivedAtUnix >= olderThanUnix) next[nick] = member;
      }
      return { members: next };
    }),
}));
