// Mirror the Rust side in src-tauri/src/commands/chat.rs.

export interface ChatMessage {
  nick: string;
  text: string;
  timestampUnix: number;
  kind: "chat" | "system" | "status" | "action_request" | "action_result";
}

// El campo "text" de un ChatMessage con kind "action_request" / "action_result"
// trae uno de estos, serializado como JSON string.
export interface FleetActionRequestPayload {
  targetNick: string;
  action: string;
  requestId: string;
}

export interface FleetActionResultPayload {
  requestId: string;
  requesterNick: string;
  ok: boolean;
  message: string;
}
