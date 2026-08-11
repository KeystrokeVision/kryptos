// Mirror the Rust side in src-tauri/src/commands/chat.rs.

export interface ChatMessage {
  nick: string;
  text: string;
  timestampUnix: number;
  kind: "chat" | "system" | "status";
}
