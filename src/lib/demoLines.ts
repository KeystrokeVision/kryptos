function hex(len: number) {
  let s = "";
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

function randIp() {
  return `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
}

/**
 * Generates purely decorative lines that LOOK like fast-scrolling technical
 * output — hex dumps, fake progress bars, generic log lines. This never
 * targets anything real and never executes anything; it's the same genre
 * as "hacker typer" sites. No line here names a real service, a specific
 * victim, or an actual working command.
 */
export function generateDemoLine(): string {
  const kind = Math.floor(Math.random() * 6);
  switch (kind) {
    case 0:
      return `[${randIp()}] handshake ${hex(8)} -> ${hex(8)}  seq=${Math.floor(Math.random() * 99999)}`;
    case 1: {
      const pct = Math.floor(Math.random() * 100);
      const bars = Math.floor(pct / 5);
      return `buffer_sync [${"#".repeat(bars)}${".".repeat(20 - bars)}] ${pct}%`;
    }
    case 2:
      return `0x${hex(6)}  ${hex(2)} ${hex(2)} ${hex(2)} ${hex(2)}  ${hex(2)} ${hex(2)} ${hex(2)} ${hex(2)}   |........|`;
    case 3:
      return `mem[${hex(4)}] <= 0x${hex(8)}   reg[${["ax", "bx", "cx", "dx", "sp"][Math.floor(Math.random() * 5)]}]`;
    case 4:
      return `node_${hex(4)}: state=${["ACTIVE", "SYNC", "IDLE", "PENDING"][Math.floor(Math.random() * 4)]} latency=${Math.floor(Math.random() * 90)}ms`;
    default:
      return `> checksum ${hex(16)} verified`;
  }
}
