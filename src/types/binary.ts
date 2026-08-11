// Mirror the Rust side in src-tauri/src/commands/binary_analysis.rs.

export interface SectionInfo {
  name: string;
  virtual_size: number;
  raw_size: number;
  entropy: number;
  flags: string[];
}

export interface ImportGroup {
  library: string;
  functions: string[];
  truncated: boolean;
}

export interface BinaryAnalysis {
  format: string;
  architecture: string;
  is_64_bit: boolean;
  is_library: boolean;
  entry_point: string | null;
  timestamp_unix: number | null;
  file_entropy: number;
  sections: SectionInfo[];
  imports: ImportGroup[];
  warnings: string[];
}
