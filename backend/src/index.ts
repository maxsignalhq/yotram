import os from 'node:os';
import path from 'node:path';
import { createServer } from './server.js';
import { loadPassword } from './auth.js';
import { parseArgs, lanAddresses } from './cli.js';

const { port, host, rootDir } = parseArgs(process.argv.slice(2));

let password: string;
try {
  password = loadPassword();
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

const { httpServer, close } = createServer(rootDir, { password, stateDir: process.env.YOTRAM_STATE_DIR ?? path.join(os.homedir(), '.yotram', 'state') });
process.on('SIGTERM', () => { close(); process.exit(0); });
process.on('SIGINT', () => { close(); process.exit(0); });

httpServer.listen(port, host, () => {
  console.log(`Yotram IDE serving ${rootDir}`);
  console.log(`  Local:   http://127.0.0.1:${port}`);
  for (const address of lanAddresses()) console.log(`  Network: http://${address}:${port}`);
});
