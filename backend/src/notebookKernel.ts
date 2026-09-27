import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

export interface KernelEvent { event: string; content: Record<string, unknown> }
interface Message { header: { msg_type: string }; parent_header: { msg_id?: string }; channel: string; content: Record<string, any> }
interface Pending {
  resolve: () => void; reject: (error: Error) => void; event?: (value: KernelEvent) => void;
  timer: ReturnType<typeof setTimeout>; bytes: number; idle: boolean; replied: boolean; execution: boolean;
}

/** Owns a loopback-only, token-authenticated Jupyter Server for one workspace. */
export class JupyterRuntime {
  private child?: ChildProcess;
  private directory = '';
  private token = randomBytes(32).toString('hex');
  private base = '';
  private stopped = false;
  private failure = '';
  private lifetime = new AbortController();
  readonly ready: Promise<void>;
  constructor(private python: string, private root: string, private onExit: () => void) {
    this.ready = this.start();
    void this.ready.catch(() => { this.dispose(); });
  }
  private async start(): Promise<void> {
    this.directory = await mkdtemp(path.join(os.tmpdir(), 'yotram-jupyter-'));
    if (this.stopped) { await rm(this.directory, { recursive: true, force: true }); throw new Error('Notebook service stopped'); }
    const kernels = path.join(this.directory, 'kernels');
    await mkdir(path.join(kernels, 'yotram-python'), { recursive: true });
    await writeFile(path.join(kernels, 'yotram-python', 'kernel.json'), JSON.stringify({
      argv: [this.python, '-m', 'ipykernel_launcher', '-f', '{connection_file}'], display_name: 'Yotram Python', language: 'python',
    }));
    const config = path.join(this.directory, 'jupyter_server_config.json');
    await writeFile(config, JSON.stringify({
      ServerApp: { ip: '127.0.0.1', port: 0, port_retries: 0, open_browser: false, root_dir: this.root,
        runtime_dir: this.directory, allow_remote_access: false, allow_unauthenticated_access: false,
        jpserver_extensions: {}, terminals_enabled: false },
      IdentityProvider: { token: this.token },
      KernelSpecManager: { allowed_kernelspecs: ['yotram-python'], ensure_native_kernel: false },
      ZMQChannelsWebsocketConnection: { iopub_data_rate_limit: 0, iopub_msg_rate_limit: 0 },
    }), { mode: 0o600 });
    if (this.stopped) { await rm(this.directory, { recursive: true, force: true }); throw new Error('Notebook service stopped'); }
    const env = { ...process.env, JUPYTER_RUNTIME_DIR: this.directory, JUPYTER_CONFIG_DIR: this.directory, JUPYTER_PATH: this.directory };
    delete (env as NodeJS.ProcessEnv).YOTRAM_PASSWORD;
    const child = spawn(this.python, ['-I', '-m', 'jupyter_server', '--config', config], { cwd: this.root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    // Do not expose Jupyter logs: they may contain its private access token.
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', chunk => {
      if (chunk.toString().includes('No module named')) this.failure = 'This Python environment needs jupyter_server and ipykernel. Install them in the selected environment, then retry.';
    });
    child.once('error', error => { this.failure = `Unable to launch the selected Python executable: ${error.message}`; this.dispose(); });
    child.once('exit', () => { this.stopped = true; this.lifetime.abort(); this.onExit(); void rm(this.directory, { recursive: true, force: true }).catch(() => {}); });
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline && !this.stopped) {
      try {
        const info = JSON.parse(await readFile(path.join(this.directory, `jpserver-${child.pid}.json`), 'utf8'));
        if (Number.isInteger(info.port) && info.port > 0 && info.port < 65536) {
          this.base = `http://127.0.0.1:${info.port}`;
          await this.request('GET', '/api/kernelspecs');
          return;
        }
      } catch { /* Wait for the private runtime file and HTTP listener. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(this.failure || (this.stopped ? 'Jupyter server exited before startup. Check the selected Python environment.' : 'Jupyter server startup timed out'));
  }
  async request(method: string, endpoint: string, body?: unknown): Promise<any> {
    if (this.stopped) throw new Error('Notebook service stopped');
    const response = await fetch(this.base + endpoint, {
      method, headers: { Authorization: `token ${this.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(40000)]),
    });
    if (!response.ok) throw new Error(`Jupyter request failed (${response.status}). Check the Python environment or restart the kernel.`);
    return response.status === 204 ? undefined : response.json();
  }
  connect(kernelId: string, session: string): WebSocket {
    if (this.stopped) throw new Error('Notebook service stopped');
    return new WebSocket(`${this.base.replace('http:', 'ws:')}/api/kernels/${encodeURIComponent(kernelId)}/channels?session_id=${session}`, {
      headers: { Authorization: `token ${this.token}` }, maxPayload: 12 * 1024 * 1024, handshakeTimeout: 30000,
    });
  }
  dispose(): void {
    if (this.stopped) return;
    // SIGTERM runs Jupyter's own kernel shutdown and runtime cleanup.
    this.stopped = true; this.lifetime.abort(); this.onExit();
    const child = this.child;
    if (!child) return;
    child.kill('SIGTERM');
    const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 10000);
    timer.unref(); child.once('exit', () => clearTimeout(timer));
    if (!child.pid) void rm(this.directory, { recursive: true, force: true }).catch(() => {});
  }
}

/** Implements the Jupyter shell/IOPub protocol, keeping tokens out of the browser. */
export class NotebookKernel {
  private socket?: WebSocket;
  private pending = new Map<string, Pending>();
  private sessionId = '';
  private kernelId = '';
  private clientId = randomUUID();
  private stopped = false;
  private closing?: Promise<void>;
  busy = false;
  started = false;
  readonly ready: Promise<void>;
  constructor(private runtime: JupyterRuntime, private file: string, private onExit: () => void) {
    this.ready = this.start();
    void this.ready.catch(() => this.dispose());
  }
  private async start(): Promise<void> {
    await this.runtime.ready;
    if (this.stopped) throw new Error('Kernel stopped');
    const session = await this.runtime.request('POST', '/api/sessions', { path: this.file, name: randomUUID(), type: 'notebook', kernel: { name: 'yotram-python' } });
    this.sessionId = session.id; this.kernelId = session.kernel.id;
    if (this.stopped) { await this.runtime.request('DELETE', `/api/sessions/${this.sessionId}`); throw new Error('Kernel stopped'); }
    await this.connect();
    this.started = true;
  }
  private async connect(): Promise<void> {
    const socket = this.runtime.connect(this.kernelId, this.clientId); this.socket = socket;
    socket.on('message', (data, binary) => {
      // Widget/binary buffers are outside the first-version feature set.
      if (binary) return;
      try { this.receive(JSON.parse(data.toString())); }
      catch { this.fail(new Error('Invalid response from Jupyter')); this.dispose(); }
    });
    socket.on('error', () => this.fail(new Error('Jupyter connection failed')));
    socket.on('close', () => { if (this.socket === socket && !this.stopped) { this.fail(new Error('Jupyter connection closed. Start the kernel again.')); this.dispose(); } });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.terminate(); reject(new Error('Kernel connection timed out')); }, 35000);
      socket.once('open', () => { clearTimeout(timer); resolve(); });
      socket.once('error', () => { clearTimeout(timer); reject(new Error('Kernel connection failed')); });
      socket.once('close', () => { clearTimeout(timer); reject(new Error('Kernel connection closed')); });
    });
    await this.send('kernel_info_request', {}, false);
  }
  private receive(message: Message): void {
    const id = message.parent_header?.msg_id;
    const pending = id ? this.pending.get(id) : undefined;
    if (!pending) return;
    pending.bytes += Buffer.byteLength(JSON.stringify(message));
    if (pending.bytes > 10 * 1024 * 1024) { this.fail(new Error('Cell output exceeded 10 MB. Reduce output and start the kernel again.')); this.dispose(); return; }
    const kind = message.header.msg_type;
    if (message.channel === 'shell' && kind.endsWith('_reply')) {
      pending.replied = true;
      if (message.content.status === 'aborted') { clearTimeout(pending.timer); this.pending.delete(id!); pending.reject(new Error('Execution was aborted')); return; }
    }
    if (message.channel === 'iopub') {
      if (kind === 'status' && message.content.execution_state === 'idle') pending.idle = true;
      if (['stream', 'display_data', 'execute_result', 'error', 'clear_output', 'update_display_data', 'execute_input'].includes(kind)) pending.event?.({ event: kind, content: message.content });
    }
    if (pending.replied && (pending.idle || !pending.execution)) { clearTimeout(pending.timer); this.pending.delete(id!); pending.resolve(); }
  }
  private send(type: string, content: Record<string, unknown>, execution: boolean, event?: (value: KernelEvent) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.stopped || this.socket?.readyState !== WebSocket.OPEN) { reject(new Error('Kernel disconnected')); return; }
      const id = randomUUID();
      const timer = setTimeout(() => { this.fail(new Error('Kernel request timed out')); this.dispose(); }, execution ? 3600000 : 35000);
      this.pending.set(id, { resolve, reject, event, timer, bytes: 0, idle: false, replied: false, execution });
      this.socket.send(JSON.stringify({ header: { msg_id: id, username: 'yotram', session: this.clientId, date: new Date().toISOString(), msg_type: type, version: '5.3' }, parent_header: {}, metadata: {}, content, channel: 'shell', buffers: [] }));
    });
  }
  private fail(error: Error): void { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pending.clear(); }
  async request(action: string, code?: string, event?: (value: KernelEvent) => void): Promise<void> {
    await this.ready;
    if (this.stopped) throw new Error('Kernel stopped');
    if (action === 'interrupt') { await this.runtime.request('POST', `/api/kernels/${this.kernelId}/interrupt`); return; }
    if (this.busy) throw new Error('Kernel is busy. Interrupt execution before restarting or running another cell.');
    this.busy = true;
    try {
      if (action === 'restart') {
        const old = this.socket; this.socket = undefined; old?.close();
        await this.runtime.request('POST', `/api/kernels/${this.kernelId}/restart`);
        await this.connect();
      } else if (action === 'execute') await this.send('execute_request', { code, silent: false, store_history: true, user_expressions: {}, allow_stdin: false, stop_on_error: true }, true, event);
      else throw new Error('Unknown kernel action');
    } catch (error) { if (action === 'restart') this.dispose(); throw error; }
    finally { this.busy = false; }
  }
  shutdown(): Promise<void> {
    if (this.closing) return this.closing;
    this.stopped = true; this.fail(new Error('Kernel stopped')); this.socket?.close();
    // Keep the identity registered until deletion completes, so a second start
    // cannot attach to the old session while Jupyter is shutting it down.
    this.closing = (this.sessionId ? this.runtime.request('DELETE', `/api/sessions/${this.sessionId}`) : this.ready)
      .then(() => {}, () => {}).finally(() => this.onExit());
    return this.closing;
  }
  dispose(): void { void this.shutdown(); }
}
