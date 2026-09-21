import { networkInterfaces } from 'node:os';
import path from 'node:path';

export interface ParsedArgs { port: number; host: string; rootDir: string }

export function parseArgs(argv: string[]): ParsedArgs {
  const portFlagIndex = argv.indexOf('--port');
  const port = portFlagIndex !== -1 ? Number(argv[portFlagIndex + 1]) : 4287;
  const hostFlagIndex = argv.indexOf('--host');
  const host = hostFlagIndex !== -1 ? argv[hostFlagIndex + 1] : '0.0.0.0';
  const excluded = new Set<number>();
  if (portFlagIndex !== -1) { excluded.add(portFlagIndex); excluded.add(portFlagIndex + 1); }
  if (hostFlagIndex !== -1) { excluded.add(hostFlagIndex); excluded.add(hostFlagIndex + 1); }
  const dirArgs = argv.filter((_, i) => !excluded.has(i));
  const rootDir = path.resolve(dirArgs[0] ?? process.cwd());
  return { port, host, rootDir };
}

export function lanAddresses(): string[] {
  const addresses: string[] = [];
  for (const iface of Object.values(networkInterfaces())) {
    for (const info of iface ?? []) {
      if (info.family === 'IPv4' && !info.internal) addresses.push(info.address);
    }
  }
  return addresses;
}
