import { invoke } from "@tauri-apps/api/core";
import type { SystemSnapshot, ProcessInfo, NetworkInfo } from "@/types/system";
import type { ShellOption } from "@/types/terminal";
import type {
  FileHashEntry,
  DirectoryHashResult,
  BaselineSummary,
  DriftReport,
  TlsCertificateInfo,
  CveSearchResult,
  CommandOutput as SecurityCommandOutput,
  SecurityLogResult,
  FirewallRule,
} from "@/types/security";
import type { AppEntry, DiscoveredApp } from "@/types/apps";
import type { WingetPackage } from "@/types/winget";
import type { AuditEntry } from "@/types/audit";
import type { ScheduledTaskInfo } from "@/types/persistence";
import type { DirEntryInfo, DriveInfo, FavoriteEntry } from "@/types/explorer";
import type { ServiceInfo } from "@/types/services";
import type { ConnectionInfo, NetworkConfig, ArpEntry, PingStats } from "@/types/network";
import type { SettingEntry } from "@/types/settings";
import type { DnsRecord, SecurityHeadersReport, PasswordStrength } from "@/types/recon";
import type { UserAccount } from "@/types/users";
import type { LogEntry } from "@/types/logs";
import type { RepoInfo, FileStatus, CommitInfo, BranchInfo } from "@/types/git";
import type { ContainerInfo, ImageInfo } from "@/types/docker";
import type { SshProfile, SshConnectParams, SftpEntry } from "@/types/ssh";
import type { SecurityBaseline } from "@/types/baseline";
import type { WifiNetwork, BluetoothDevice, UsbDevice } from "@/types/wireless";
import type { BinaryAnalysis } from "@/types/binary";
import type { DirSizeEntry, DuplicateScanResult } from "@/types/diskUsage";
import type { CryptoResult } from "@/types/crypto";
import type { SentinelAlert, SentinelEvent, SentinelStatus, ScanOutcome, SentinelExport, ReconstructedState, SentinelTimeBounds } from "@/types/sentinel";
import type { HoneytokenInfo } from "@/types/honeytoken";
import type { ProcessDossier } from "@/types/dossier";
import type { DbConnectionProfile, DbConnectParams, DbTableInfo, DbColumnInfo, DbQueryResult } from "@/types/database";

export interface CommandOutput {
  success: boolean;
  output: string;
}

export interface PortCheckResult {
  port: number;
  service: string;
  open: boolean;
}

/**
 * Thin typed wrapper around Tauri's `invoke`. Every function here maps 1:1
 * to a `#[tauri::command]` in src-tauri/src/commands, which is the only
 * place allowed to touch the OS. The frontend never shells out directly.
 */
export const api = {
  getSystemSnapshot: () => invoke<SystemSnapshot>("get_system_snapshot"),
  listProcesses: () => invoke<ProcessInfo[]>("list_processes"),
  killProcess: (pid: number) => invoke<void>("kill_process", { pid }),
  getNetworkInfo: () => invoke<NetworkInfo>("get_network_info"),

  runPing: (host: string) => invoke<CommandOutput>("run_ping", { host }),
  runTraceroute: (host: string) => invoke<CommandOutput>("run_traceroute", { host }),
  runNetstat: () => invoke<CommandOutput>("run_netstat"),
  runIpconfig: () => invoke<CommandOutput>("run_ipconfig"),
  runPortCheck: (host: string) => invoke<PortCheckResult[]>("run_port_check", { host }),

  // Terminal — see src-tauri/src/commands/terminal.rs. Output arrives via
  // the "terminal://output" and "terminal://exit" events, not a return
  // value, since a shell is a long-lived stream, not a single response.
  listAvailableShells: () => invoke<ShellOption[]>("list_available_shells"),
  createTerminalSession: (sessionId: string, cols: number, rows: number, shell?: string, cwd?: string) =>
    invoke<void>("create_terminal_session", { sessionId, cols, rows, shell, cwd }),
  writeToTerminal: (sessionId: string, data: string) => invoke<void>("write_to_terminal", { sessionId, data }),
  resizeTerminal: (sessionId: string, cols: number, rows: number) =>
    invoke<void>("resize_terminal", { sessionId, cols, rows }),
  closeTerminalSession: (sessionId: string) => invoke<void>("close_terminal_session", { sessionId }),

  // Seguridad — ver src-tauri/src/commands/security.rs
  hashFile: (path: string) => invoke<FileHashEntry>("hash_file", { path }),
  hashDirectory: (path: string) => invoke<DirectoryHashResult>("hash_directory", { path }),
  saveBaseline: (name: string, rootPath: string, entries: FileHashEntry[]) =>
    invoke<void>("save_baseline", { name, rootPath, entries }),
  listBaselines: () => invoke<BaselineSummary[]>("list_baselines"),
  deleteBaseline: (name: string) => invoke<void>("delete_baseline", { name }),
  compareBaseline: (name: string) => invoke<DriftReport>("compare_baseline", { name }),
  checkTlsCertificate: (host: string, port?: number) => invoke<TlsCertificateInfo>("check_tls_certificate", { host, port }),
  searchCve: (query: string) => invoke<CveSearchResult>("search_cve", { query }),
  runAdvancedScan: (target: string, scanType: string) => invoke<SecurityCommandOutput>("run_advanced_scan", { target, scanType }),
  readSecurityEvents: (preset: string, maxEvents?: number) =>
    invoke<SecurityLogResult>("read_security_events", { preset, maxEvents }),
  listFirewallRules: () => invoke<FirewallRule[]>("list_firewall_rules"),
  addFirewallRule: (name: string, direction: string, action: string, protocol: string, port: string) =>
    invoke<SecurityCommandOutput>("add_firewall_rule", { name, direction, action, protocol, port }),
  deleteFirewallRule: (id: string) => invoke<SecurityCommandOutput>("delete_firewall_rule", { id }),

  // Aplicaciones — ver src-tauri/src/commands/apps.rs
  listApplications: () => invoke<AppEntry[]>("list_applications"),
  isWingetAvailable: () => invoke<boolean>("is_winget_available"),
  searchWingetPackages: (query: string) => invoke<WingetPackage[]>("search_winget_packages", { query }),
  installWingetPackage: (id: string) => invoke<string>("install_winget_package", { id }),
  listInstalledApplications: () => invoke<DiscoveredApp[]>("list_installed_applications"),
  addApplication: (name: string, exePath: string, iconSourcePath?: string) =>
    invoke<AppEntry>("add_application", { name, exePath, iconSourcePath }),
  updateApplication: (id: string, name: string, exePath: string, iconSourcePath?: string) =>
    invoke<AppEntry>("update_application", { id, name, exePath, iconSourcePath }),
  deleteApplication: (id: string) => invoke<void>("delete_application", { id }),
  getAppIconDataUrl: (iconFile: string) => invoke<string>("get_app_icon_data_url", { iconFile }),
  launchApplication: (id: string) => invoke<void>("launch_application", { id }),

  // Historial de auditoria — ver src-tauri/src/commands/audit.rs
  listAuditLog: (limit?: number) => invoke<AuditEntry[]>("list_audit_log", { limit }),
  clearAuditLog: () => invoke<void>("clear_audit_log"),
  exportAuditLog: () => invoke<{ json: string; sha256: string; entry_count: number; exported_at_unix: number }>("export_audit_log"),
  listScheduledTasks: () => invoke<ScheduledTaskInfo[]>("list_scheduled_tasks"),

  // Vigilante de archivos — ver src-tauri/src/commands/file_watch.rs
  startFileWatch: (watchId: string, path: string) => invoke<void>("start_file_watch", { watchId, path }),
  stopFileWatch: (watchId: string) => invoke<void>("stop_file_watch", { watchId }),
  listActiveWatches: () => invoke<string[]>("list_active_watches"),
  runSecurityBaseline: () => invoke<SecurityBaseline>("run_security_baseline"),
  encryptFile: (path: string, password: string, outputPath?: string) => invoke<CryptoResult>("encrypt_file", { path, password, outputPath }),
  decryptFile: (path: string, password: string, outputPath?: string) => invoke<CryptoResult>("decrypt_file", { path, password, outputPath }),
  chatStartServer: (port: number, nick: string) => invoke<void>("chat_start_server", { port, nick }),
  chatConnect: (host: string, port: number, nick: string) => invoke<void>("chat_connect", { host, port, nick }),
  chatSendMessage: (nick: string, text: string, system: boolean) => invoke<void>("chat_send_message", { nick, text, system }),
  chatDisconnect: () => invoke<void>("chat_disconnect"),
  chatIsActive: () => invoke<boolean>("chat_is_active"),
  chatBroadcastStatus: (statusJson: string) => invoke<void>("chat_broadcast_status", { statusJson }),
  fleetRequestAction: (targetNick: string, action: string, requestId: string) => invoke<void>("fleet_request_action", { targetNick, action, requestId }),
  fleetSendActionResult: (requestId: string, requesterNick: string, ok: boolean, message: string) =>
    invoke<void>("fleet_send_action_result", { requestId, requesterNick, ok, message }),
  // Sentinel (vigilancia continua) — ver src-tauri/src/commands/sentinel.rs.
  // Los hallazgos llegan tambien en vivo por los eventos "sentinel://event",
  // "sentinel://alert" y "sentinel://tick".
  sentinelStatus: () => invoke<SentinelStatus>("sentinel_status"),
  sentinelStart: (intervalSecs?: number) => invoke<void>("sentinel_start", { intervalSecs }),
  sentinelStop: () => invoke<void>("sentinel_stop"),
  sentinelScanNow: () => invoke<ScanOutcome>("sentinel_scan_now"),
  sentinelListEvents: (limit?: number, source?: string) => invoke<SentinelEvent[]>("sentinel_list_events", { limit, source }),
  sentinelListAlerts: (limit?: number, onlyPending?: boolean) => invoke<SentinelAlert[]>("sentinel_list_alerts", { limit, onlyPending }),
  sentinelAcknowledgeAlert: (id: number) => invoke<void>("sentinel_acknowledge_alert", { id }),
  sentinelAcknowledgeAll: () => invoke<void>("sentinel_acknowledge_all"),
  sentinelResetReference: () => invoke<void>("sentinel_reset_reference"),
  sentinelClearHistory: () => invoke<void>("sentinel_clear_history"),
  sentinelExport: () => invoke<SentinelExport>("sentinel_export"),

  // Honeytokens — ver src-tauri/src/commands/honeytoken.rs
  honeytokenDeploy: (label: string, directory: string, fileName: string) =>
    invoke<HoneytokenInfo>("honeytoken_deploy", { label, directory, fileName }),
  honeytokenList: () => invoke<HoneytokenInfo[]>("honeytoken_list"),
  honeytokenRearmAll: () => invoke<number>("honeytoken_rearm_all"),
  honeytokenRemove: (id: number) => invoke<void>("honeytoken_remove", { id }),

  // Dossier de proceso — ver src-tauri/src/commands/dossier.rs
  investigateProcess: (pid: number) => invoke<ProcessDossier>("investigate_process", { pid }),

  // Maquina del tiempo de Sentinel — ver src-tauri/src/commands/sentinel.rs
  sentinelTimeBounds: () => invoke<SentinelTimeBounds>("sentinel_time_bounds"),
  sentinelStateAt: (asOfUnix: number) => invoke<ReconstructedState>("sentinel_state_at", { asOfUnix }),

  panicLockSession: () => invoke<void>("panic_lock_session"),
  panicSetNetwork: (enable: boolean) => invoke<void>("panic_set_network", { enable }),

  // Explorador de archivos — ver src-tauri/src/commands/explorer.rs
  listDirectory: (path: string) => invoke<DirEntryInfo[]>("list_directory", { path }),
  getHomeDirectory: () => invoke<string>("get_home_directory"),
  listDrives: () => invoke<DriveInfo[]>("list_drives"),
  createDirectory: (parentPath: string, name: string) => invoke<string>("create_directory", { parentPath, name }),
  createEmptyFile: (parentPath: string, name: string) => invoke<string>("create_empty_file", { parentPath, name }),
  renamePath: (path: string, newName: string) => invoke<string>("rename_path", { path, newName }),
  deletePath: (path: string) => invoke<void>("delete_path", { path }),
  copyPath: (sourcePath: string, destDir: string) => invoke<string>("copy_path", { sourcePath, destDir }),
  movePath: (sourcePath: string, destDir: string) => invoke<string>("move_path", { sourcePath, destDir }),
  searchDirectory: (root: string, query: string) => invoke<DirEntryInfo[]>("search_directory", { root, query }),
  listFavorites: () => invoke<FavoriteEntry[]>("list_favorites"),
  addFavorite: (path: string, label: string) => invoke<void>("add_favorite", { path, label }),
  removeFavorite: (id: number) => invoke<void>("remove_favorite", { id }),
  readFileText: (path: string) => invoke<string>("read_file_text", { path }),
  writeFileText: (path: string, content: string) => invoke<void>("write_file_text", { path, content }),

  // Permisos elevados — ver src-tauri/src/commands/elevation.rs
  isElevated: () => invoke<boolean>("is_elevated"),
  relaunchElevated: () => invoke<void>("relaunch_elevated"),

  // Servicios — ver src-tauri/src/commands/services.rs
  listServices: () => invoke<ServiceInfo[]>("list_services"),
  startService: (name: string) => invoke<void>("start_service", { name }),
  stopService: (name: string) => invoke<void>("stop_service", { name }),
  restartService: (name: string) => invoke<void>("restart_service", { name }),

  // Red (detalle) — ver src-tauri/src/commands/network_details.rs
  listActiveConnections: () => invoke<ConnectionInfo[]>("list_active_connections"),
  getNetworkConfig: () => invoke<NetworkConfig>("get_network_config"),
  listArpTable: () => invoke<ArpEntry[]>("list_arp_table"),
  runPingDiagnostic: (host: string) => invoke<PingStats>("run_ping_diagnostic", { host }),

  // Configuracion — ver src-tauri/src/commands/settings.rs
  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) => invoke<void>("set_setting", { key, value }),
  getAllSettings: () => invoke<SettingEntry[]>("get_all_settings"),
  getDataDirectory: () => invoke<string>("get_data_directory"),
  openInFileManager: (path: string) => invoke<void>("open_in_file_manager", { path }),

  // OSINT / recon — ver src-tauri/src/commands/recon.rs
  lookupDns: (domain: string) => invoke<DnsRecord[]>("lookup_dns", { domain }),
  lookupWhois: (domain: string) => invoke<string>("lookup_whois", { domain }),
  checkSecurityHeaders: (url: string) => invoke<SecurityHeadersReport>("check_security_headers", { url }),

  // Contrasenas — ver src-tauri/src/commands/password_tools.rs
  generatePassword: (length: number, useUpper: boolean, useDigits: boolean, useSymbols: boolean) =>
    invoke<string>("generate_password", { length, useUpper, useDigits, useSymbols }),
  checkPasswordStrength: (password: string) => invoke<PasswordStrength>("check_password_strength", { password }),
  checkPwnedRange: (prefix: string) => invoke<string>("check_pwned_range", { prefix }),

  // Usuarios — ver src-tauri/src/commands/users.rs
  listUsers: () => invoke<UserAccount[]>("list_users"),

  // Logs generales — ver src-tauri/src/commands/logs.rs
  readSystemLogs: (logName: string, levelFilter?: string, maxEntries?: number) =>
    invoke<LogEntry[]>("read_system_logs", { logName, levelFilter, maxEntries }),

  // Git — ver src-tauri/src/commands/git.rs
  isGitRepository: (path: string) => invoke<boolean>("is_git_repository", { path }),
  getRepoInfo: (path: string) => invoke<RepoInfo>("get_repo_info", { path }),
  getRepoStatus: (path: string) => invoke<FileStatus[]>("get_repo_status", { path }),
  getCommitLog: (path: string, limit?: number) => invoke<CommitInfo[]>("get_commit_log", { path, limit }),
  listBranches: (path: string) => invoke<BranchInfo[]>("list_branches", { path }),
  checkoutBranch: (path: string, branchName: string) => invoke<void>("checkout_branch", { path, branchName }),
  getFileDiff: (path: string, filePath: string, staged: boolean) => invoke<string>("get_file_diff", { path, filePath, staged }),
  stageFile: (path: string, filePath: string) => invoke<void>("stage_file", { path, filePath }),
  unstageFile: (path: string, filePath: string) => invoke<void>("unstage_file", { path, filePath }),
  commitChanges: (path: string, message: string) => invoke<string>("commit_changes", { path, message }),
  pushToRemote: (path: string, remoteName: string, branch: string, keyPath?: string, passphrase?: string) =>
    invoke<void>("push_to_remote", { path, remoteName, branch, keyPath, passphrase }),
  fetchFromRemote: (path: string, remoteName: string, branch: string, keyPath?: string, passphrase?: string) =>
    invoke<void>("fetch_from_remote", { path, remoteName, branch, keyPath, passphrase }),
  pullFromRemote: (path: string, remoteName: string, branch: string, keyPath?: string, passphrase?: string) =>
    invoke<string>("pull_from_remote", { path, remoteName, branch, keyPath, passphrase }),

  // Docker — ver src-tauri/src/commands/docker.rs
  isDockerAvailable: () => invoke<boolean>("is_docker_available"),
  listContainers: (all: boolean) => invoke<ContainerInfo[]>("list_containers", { all }),
  startContainer: (id: string) => invoke<void>("start_container", { id }),
  stopContainer: (id: string) => invoke<void>("stop_container", { id }),
  restartContainer: (id: string) => invoke<void>("restart_container", { id }),
  removeContainer: (id: string, force: boolean) => invoke<void>("remove_container", { id, force }),
  getContainerLogs: (id: string, tailLines?: number) => invoke<string>("get_container_logs", { id, tailLines }),
  listImages: () => invoke<ImageInfo[]>("list_images"),
  removeImage: (id: string, force: boolean) => invoke<void>("remove_image", { id, force }),
  pullLabImage: (image: string) => invoke<void>("pull_lab_image", { image }),
  launchLabContainer: (name: string, image: string, hostPort: number, containerPort: number) =>
    invoke<string>("launch_lab_container", { name, image, hostPort, containerPort }),

  // Inalambrico y USB — ver src-tauri/src/commands/wireless.rs
  listWifiNetworks: () => invoke<WifiNetwork[]>("list_wifi_networks"),
  listBluetoothDevices: () => invoke<BluetoothDevice[]>("list_bluetooth_devices"),
  listUsbDevices: () => invoke<UsbDevice[]>("list_usb_devices"),
  analyzeBinary: (path: string) => invoke<BinaryAnalysis>("analyze_binary", { path }),
  getDirectorySizes: (path: string) => invoke<DirSizeEntry[]>("get_directory_sizes", { path }),
  findDuplicateFiles: (path: string) => invoke<DuplicateScanResult>("find_duplicate_files", { path }),

  // Ejecutar scripts — ver src-tauri/src/commands/scripts.rs
  runScript: (path: string) => invoke<{ success: boolean; output: string }>("run_script", { path }),

  // SSH — ver src-tauri/src/commands/ssh.rs
  listSshProfiles: () => invoke<SshProfile[]>("list_ssh_profiles"),
  addSshProfile: (label: string, host: string, port: number, username: string, authMethod: string, keyPath?: string) =>
    invoke<SshProfile>("add_ssh_profile", { label, host, port, username, authMethod, keyPath }),
  deleteSshProfile: (id: number) => invoke<void>("delete_ssh_profile", { id }),
  createSshSession: (sessionId: string, params: SshConnectParams, cols: number, rows: number) =>
    invoke<void>("create_ssh_session", { sessionId, params, cols, rows }),
  writeToSshSession: (sessionId: string, data: string) => invoke<void>("write_to_ssh_session", { sessionId, data }),
  resizeSshSession: (sessionId: string, cols: number, rows: number) => invoke<void>("resize_ssh_session", { sessionId, cols, rows }),
  closeSshSession: (sessionId: string) => invoke<void>("close_ssh_session", { sessionId }),

  // SFTP — ver src-tauri/src/commands/sftp.rs
  sftpListDirectory: (params: SshConnectParams, path: string) => invoke<SftpEntry[]>("sftp_list_directory", { params, path }),
  sftpCreateDirectory: (params: SshConnectParams, path: string) => invoke<void>("sftp_create_directory", { params, path }),
  sftpDeleteFile: (params: SshConnectParams, path: string) => invoke<void>("sftp_delete_file", { params, path }),
  sftpDownloadFile: (params: SshConnectParams, remotePath: string, localPath: string) =>
    invoke<void>("sftp_download_file", { params, remotePath, localPath }),
  sftpUploadFile: (params: SshConnectParams, localPath: string, remotePath: string) =>
    invoke<void>("sftp_upload_file", { params, localPath, remotePath }),

  // Base de datos — ver src-tauri/src/commands/database.rs
  listDbConnections: () => invoke<DbConnectionProfile[]>("list_db_connections"),
  addDbConnection: (
    label: string,
    engine: string,
    host: string | undefined,
    port: number | undefined,
    username: string | undefined,
    databaseName: string | undefined,
    filePath: string | undefined,
    useTls: boolean
  ) =>
    invoke<DbConnectionProfile>("add_db_connection", {
      label,
      engine,
      host,
      port,
      username,
      databaseName,
      filePath,
      useTls,
    }),
  deleteDbConnection: (id: number) => invoke<void>("delete_db_connection", { id }),
  dbTestConnection: (params: DbConnectParams) => invoke<string>("db_test_connection", { params }),
  dbConnect: (sessionId: string, params: DbConnectParams) => invoke<string>("db_connect", { sessionId, params }),
  dbDisconnect: (sessionId: string) => invoke<void>("db_disconnect", { sessionId }),
  dbListTables: (sessionId: string) => invoke<DbTableInfo[]>("db_list_tables", { sessionId }),
  dbListColumns: (sessionId: string, table: string) => invoke<DbColumnInfo[]>("db_list_columns", { sessionId, table }),
  dbRunQuery: (sessionId: string, sql: string) => invoke<DbQueryResult>("db_run_query", { sessionId, sql }),
};
