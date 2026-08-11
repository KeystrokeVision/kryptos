// Mirror the Rust side in src-tauri/src/commands/recon.rs and
// src-tauri/src/commands/password_tools.rs.

export interface DnsRecord {
  record_type: string;
  value: string;
}

export interface SecurityHeaderCheck {
  name: string;
  present: boolean;
  value: string | null;
  recommendation: string;
}

export interface SecurityHeadersReport {
  url: string;
  status_code: number;
  checks: SecurityHeaderCheck[];
}

export interface PasswordStrength {
  score: number;
  label: string;
  entropy_bits: number;
  feedback: string[];
}
