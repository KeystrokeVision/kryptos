// Mirror the Rust side in src-tauri/src/commands/baseline.rs.

export interface BaselineCheck {
  name: string;
  status: "ok" | "warning" | "unknown";
  detail: string;
}

export interface SecurityBaseline {
  checks: BaselineCheck[];
  score_percent: number;
  generated_at_unix: number;
  ran_elevated: boolean;
}
