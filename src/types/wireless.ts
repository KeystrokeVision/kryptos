// Mirror the Rust side in src-tauri/src/commands/wireless.rs.

export interface WifiNetwork {
  ssid: string;
  signal_percent: number | null;
  channel: number | null;
  authentication: string | null;
}

export interface BluetoothDevice {
  name: string;
  status: string;
  instance_id: string;
}

export interface UsbDevice {
  name: string;
  status: string;
  instance_id: string;
}
