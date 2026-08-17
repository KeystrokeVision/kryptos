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
  // El nick con el que ESTE equipo esta host/unido al chat ahora mismo, o
  // null si no hay sesion activa. FleetActionListener lo usa para saber si
  // un fleet_request_action que llego es para mi; el Centro de Operaciones
  // lo usa para no ofrecer "aislar red remota" contra uno mismo.
  myNick: string | null;
  setMyNick: (nick: string | null) => void;
}

/**
 * Estado en memoria de "Modo Flota" — que sabe cada instancia conectada al
 * mismo chat de si misma. Vive fuera de cualquier pagina especifica
 * (Chat, OperationsCenter) porque FleetWatcher lo actualiza en segundo
 * plano independientemente de cual pestana este a la vista.
 */
export const useFleetStore = create<FleetState>((set) => ({
  members: {},
  myNick: null,
  setMyNick: (nick) => set({ myNick: nick }),
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
