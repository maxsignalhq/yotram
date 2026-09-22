import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Socket } from 'node:net';
const require = createRequire(import.meta.url);

// Each app gets its own origin. App scripts cannot share the IDE's DOM or bypass
// its origin checks. No IDE cookies/authorization are forwarded to the target.
export class PreviewService {
  private gateways = new Map<number, { server: http.Server; port: number; tickets: Map<string, number>; sessions: Map<string, number>; inspect: boolean; parentOrigin: string; sockets: Set<Socket> }>();
  private pending = new Map<number, Promise<number>>();
  constructor(private mainPort: () => number, private bindHost: () => string) {}
  async open(target: number, parentOrigin: string, inspect: boolean): Promise<{ port: number; ticket: string }> {
    if (!Number.isInteger(target) || target < 1 || target > 65535 || target === this.mainPort() || [...this.gateways.values()].some(g => g.port === target)) throw new Error('Choose a development server port, not a Yotram port.');
    if (!this.gateways.has(target)) {
      if (!this.pending.has(target)) this.pending.set(target, this.create(target, parentOrigin, inspect).finally(() => this.pending.delete(target)));
      await this.pending.get(target);
    }
    const gateway = this.gateways.get(target)!;
    gateway.inspect = inspect; gateway.parentOrigin = parentOrigin;
    const ticket = randomBytes(24).toString('hex'); gateway.tickets.set(ticket, Date.now() + 60000);
    for (const [key, expiry] of gateway.tickets) if (expiry < Date.now()) gateway.tickets.delete(key);
    return { port: gateway.port, ticket };
  }
  private async create(target: number, parentOrigin: string, inspect: boolean): Promise<number> {
    if (this.gateways.size >= 20) throw new Error('Preview limit reached. Restart Yotram to release unused preview gateways.');
    const gateway = { server: http.createServer(), port: 0, tickets: new Map<string, number>(), sessions: new Map<string, number>(), inspect, parentOrigin, sockets: new Set<Socket>() };
    const cookieName = `yotram_preview_${target}`;
    const authorized = (req: http.IncomingMessage) => {
      const cookie = req.headers.cookie?.split(';').map(p => p.trim()).find(p => p.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
      return !!cookie && (gateway.sessions.get(cookie) ?? 0) > Date.now();
    };
    gateway.server.on('connection', socket => { gateway.sockets.add(socket); socket.on('close', () => gateway.sockets.delete(socket)); });
    gateway.server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://preview');
      const ticket = url.searchParams.get('__yotram_preview');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cache-Control', 'no-store');
      if (ticket && (gateway.tickets.get(ticket) ?? 0) > Date.now()) {
        gateway.tickets.delete(ticket);
        const session = randomBytes(24).toString('hex'); gateway.sessions.set(session, Date.now() + 8 * 3600000);
        for (const [key, expiry] of gateway.sessions) if (expiry < Date.now()) gateway.sessions.delete(key);
        url.searchParams.delete('__yotram_preview');
        res.writeHead(302, { 'Set-Cookie': `${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`, Location: url.pathname + url.search }); res.end(); return;
      }
      if (!authorized(req)) { res.writeHead(401); res.end('Open this preview from your signed-in Yotram workspace.'); return; }
      if (url.pathname === '/__yotram/capture.js' && gateway.inspect) {
        try { res.setHeader('Content-Type', 'application/javascript'); res.end(readFileSync(require.resolve('html2canvas/dist/html2canvas.min.js'))); }
        catch { res.writeHead(503); res.end('Capture library unavailable'); } return;
      }
      const headers = { ...req.headers, host: `127.0.0.1:${target}`, 'accept-encoding': 'identity' };
      delete headers.cookie; delete headers.authorization;
      const upstream = http.request({ hostname: '127.0.0.1', port: target, path: req.url, method: req.method, headers }, response => {
        const outgoing = { ...response.headers };
        delete outgoing['set-cookie']; delete outgoing['content-length']; delete outgoing['transfer-encoding'];
        if (outgoing.location?.startsWith(`http://127.0.0.1:${target}`)) outgoing.location = outgoing.location.replace(`http://127.0.0.1:${target}`, `http://${req.headers.host}`);
        // Preserve the application's CSP; inspection may be unavailable if it forbids our helper.
        if (gateway.inspect && outgoing['content-type']?.includes('text/html') && !outgoing['content-encoding']) {
          let body = ''; let size = 0;
          response.on('data', chunk => { size += chunk.length; if (size > 8 * 1024 * 1024) { response.destroy(); res.destroy(); } else body += chunk; });
          response.on('end', () => { res.writeHead(response.statusCode ?? 200, outgoing); res.end(body.replace(/<\/body>/i, `${helper(gateway.parentOrigin)}</body>`)); });
          response.on('error', () => res.destroy());
        } else { res.writeHead(response.statusCode ?? 200, outgoing); response.pipe(res); }
      });
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Development server is not reachable. Start it in a terminal and reload.'); });
      req.pipe(upstream); res.on('close', () => upstream.destroy());
    });
    gateway.server.on('upgrade', (req, socket, head) => {
      const expected = `http://${req.headers.host}`;
      if (!authorized(req) || (req.headers.origin && req.headers.origin !== expected)) { socket.destroy(); return; }
      const headers = { ...req.headers, host: `127.0.0.1:${target}` }; delete headers.cookie; delete headers.authorization;
      const upstream = http.request({ hostname: '127.0.0.1', port: target, path: req.url, headers });
      upstream.on('upgrade', (response, peer, upstreamHead) => {
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).filter(([key]) => key !== 'set-cookie').map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`);
        if (head.length) peer.write(head); if (upstreamHead.length) socket.write(upstreamHead);
        socket.pipe(peer).pipe(socket); socket.on('error', () => peer.destroy()); peer.on('error', () => socket.destroy()); socket.on('close', () => peer.destroy());
      });
      upstream.on('response', () => socket.destroy()); upstream.on('error', () => socket.destroy()); upstream.end();
    });
    await new Promise<void>((resolve, reject) => { gateway.server.once('error', reject); gateway.server.listen(0, this.bindHost(), resolve); });
    const address = gateway.server.address(); gateway.port = typeof address === 'object' && address ? address.port : 0;
    this.gateways.set(target, gateway); return gateway.port;
  }
  close(): void { for (const gateway of this.gateways.values()) { for (const socket of gateway.sockets) socket.destroy(); gateway.server.close(); } this.gateways.clear(); }
}
function helper(parentOrigin: string): string {
  const origin = JSON.stringify(parentOrigin).replace(/</g, '\\u003c');
  return `<script src="/__yotram/capture.js"></script><script>(()=>{
const origin=${origin}; let active=false, highlighted=null, previous='';
const clear=()=>{if(highlighted) highlighted.style.outline=previous; highlighted=null;};
window.addEventListener('message',e=>{if(e.source!==parent||e.origin!==origin)return;if(e.data?.type==='yotram:select'){active=!!e.data.active;if(!active)clear();}});
document.addEventListener('mouseover',e=>{if(!active||!(e.target instanceof HTMLElement))return;clear();highlighted=e.target;previous=highlighted.style.outline;highlighted.style.outline='2px solid #3794ff';},true);
document.addEventListener('click',async e=>{if(!active||!(e.target instanceof HTMLElement))return;e.preventDefault();e.stopImmediatePropagation();active=false;clear();const el=e.target;const style=getComputedStyle(el);const copy=el.cloneNode(true);for(const node of [copy,...copy.querySelectorAll('input,textarea,[value]')]){node.removeAttribute('value');if(node.tagName==='TEXTAREA')node.textContent='[redacted]';}const context={url:location.href,viewport:{width:innerWidth,height:innerHeight},html:copy.outerHTML.slice(0,6000),styles:Object.fromEntries(['display','color','background-color','font-size','margin','padding','width','height','gap'].map(k=>[k,style.getPropertyValue(k)])),source:el.getAttribute('data-source')||null,screenshot:null,captureError:null};try{const canvas=await html2canvas(document.documentElement,{useCORS:true,scale:Math.min(1,1200/innerWidth),width:innerWidth,height:innerHeight,x:scrollX,y:scrollY,logging:false});context.screenshot=canvas.toDataURL('image/png');}catch(err){context.captureError='Screenshot unavailable; element details were captured.';}parent.postMessage({type:'yotram:selection',context},origin);},true);
parent.postMessage({type:'yotram:inspector-ready'},origin);
})();</script>`;
}
