// Mirror the Rust side in src-tauri/src/commands/git.rs.

export interface RepoInfo {
  path: string;
  current_branch: string | null;
  is_clean: boolean;
  head_commit: string | null;
}

export interface FileStatus {
  path: string;
  staged: boolean;
  kind: string;
}

export interface CommitInfo {
  hash: string;
  short_hash: string;
  author_name: string;
  author_email: string;
  timestamp_unix: number;
  summary: string;
}

export interface BranchInfo {
  name: string;
  is_head: boolean;
}
