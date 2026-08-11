// Mirror the Rust side in src-tauri/src/commands/docker.rs.

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string[];
  created_unix: number;
}

export interface ImageInfo {
  id: string;
  repo_tags: string[];
  size_bytes: number;
  created_unix: number;
}

export interface PullProgress {
  image: string;
  status: string;
  progress: string | null;
  done: boolean;
}
