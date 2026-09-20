import path from 'node:path';
import express from 'express';
import { createServer } from './server.js';

const args = process.argv.slice(2);
const portFlagIndex = args.indexOf('--port');
const port = portFlagIndex !== -1 ? Number(args[portFlagIndex + 1]) : 4287;
const dirArgs = portFlagIndex === -1
  ? args
  : args.filter((_, i) => i !== portFlagIndex && i !== portFlagIndex + 1);
const rootDir = path.resolve(dirArgs[0] ?? process.cwd());

const { httpServer } = createServer(rootDir);

httpServer.listen(port, '127.0.0.1', () => {
  console.log(`Yotram IDE serving ${rootDir} at http://127.0.0.1:${port}`);
});
