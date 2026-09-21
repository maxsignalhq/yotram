import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import App from '../src/App';

// vi.mock factories are hoisted above regular top-level declarations (even
// ones written earlier in the source), so a plain `class FakeWsClient {...}`
// referenced from the factory below hits the temporal dead zone. Wrapping
// the class in vi.hoisted() hoists its definition together with the mock.
const { FakeWsClient } = vi.hoisted(() => {
  class FakeWsClient {
    static instances: FakeWsClient[] = [];
    private handlers = new Map<string, ((msg: any) => void)[]>();
    private statusHandlers: ((status: string) => void)[] = [];
    send = vi.fn();
    close = vi.fn();
    constructor(public url: string) { FakeWsClient.instances.push(this); }
    on(type: string, handler: (msg: any) => void) {
      const list = this.handlers.get(type) ?? [];
      list.push(handler);
      this.handlers.set(type, list);
      return () => {};
    }
    onStatusChange(handler: (status: string) => void) {
      this.statusHandlers.push(handler);
      return () => {};
    }
    emit(type: string, msg: any) {
      act(() => { for (const h of this.handlers.get(type) ?? []) h(msg); });
    }
    open() {
      act(() => { for (const h of this.statusHandlers) h('open'); });
    }
  }
  return { FakeWsClient };
});

vi.mock('../src/wsClient', () => ({ WsClient: FakeWsClient }));

vi.mock('@monaco-editor/react', () => ({
  default: () => null,
  DiffEditor: () => null,
  loader: { config: vi.fn() },
}));
vi.mock('monaco-editor', () => ({}));

class FakeNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  static instances: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  constructor(public title: string, public options?: NotificationOptions) {
    FakeNotification.instances.push(this);
  }
}

// App shows the Dashboard until a workspace is chosen, and WorkspaceIDE
// isn't exported on its own — mock Dashboard to open a workspace immediately
// on mount, so these tests can exercise WorkspaceIDE's notification behavior
// without driving the real Dashboard UI.
vi.mock('../src/components/Dashboard', async () => {
  const actual = await vi.importActual<any>('../src/components/Dashboard');
  const { useEffect } = await vi.importActual<any>('react');
  return {
    ...actual,
    Dashboard: ({ onOpen }: { onOpen: (w: any) => void }) => {
      // Call onOpen from an effect, not during render, to avoid React's
      // "Cannot update a component while rendering a different component"
      // warning (setState-in-render from App's setWorkspace).
      useEffect(() => { onOpen({ id: 'w1', name: 'demo', path: '/tmp/demo' }); }, []);
      return null;
    },
  };
});

describe('WorkspaceIDE notifications', () => {
  beforeEach(() => {
    FakeWsClient.instances = [];
    FakeNotification.permission = 'default';
    FakeNotification.instances = [];
    FakeNotification.requestPermission = vi.fn(async () => FakeNotification.permission);
    (window as any).Notification = FakeNotification;
  });

  afterEach(() => cleanup());

  it('requests permission when the bell toggle is clicked from the default state', async () => {
    render(<App />);
    const client = FakeWsClient.instances[0];
    client.open();
    const toggle = await screen.findByRole('button', { name: /notifications/i });
    FakeNotification.permission = 'granted';
    await act(async () => { fireEvent.click(toggle); });
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('shows a notification when a terminal exits while the tab is hidden', async () => {
    FakeNotification.permission = 'granted';
    render(<App />);
    const client = FakeWsClient.instances[0];
    client.open();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    client.emit('pty:exit', { type: 'pty:exit', sessionId: 'main', exitCode: 0 });
    expect(FakeNotification.instances).toHaveLength(1);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('does not show a notification when the tab is visible', async () => {
    FakeNotification.permission = 'granted';
    render(<App />);
    const client = FakeWsClient.instances[0];
    client.open();
    client.emit('pty:exit', { type: 'pty:exit', sessionId: 'main', exitCode: 0 });
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it('uses the friendly "Shell N" tab label (not the raw session id) for a second terminal\'s exit notification', async () => {
    FakeNotification.permission = 'granted';
    const uuidSpy = vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-1111-1111-111111111111' as any);
    // xterm (used by the real, unmocked Terminal component) needs
    // window.matchMedia, which jsdom doesn't implement.
    const matchMediaSpy = vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList);
    render(<App />);
    const client = FakeWsClient.instances[0];
    client.open();

    // Open the terminal panel (creates the 'main' session), then add a
    // second terminal via the "New terminal" button, mirroring the real
    // "New terminal" UI flow that assigns it a crypto.randomUUID() id.
    const terminalToggle = await screen.findByRole('button', { name: 'Open terminal' });
    await act(async () => { fireEvent.click(terminalToggle); });
    const newTerminalButton = await screen.findByRole('button', { name: 'New terminal' });
    await act(async () => { fireEvent.click(newTerminalButton); });

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    client.emit('pty:exit', { type: 'pty:exit', sessionId: '11111111-1111-1111-1111-111111111111', exitCode: 1 });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

    expect(FakeNotification.instances).toHaveLength(1);
    expect(FakeNotification.instances[0].title).toContain('Shell 2');
    expect(FakeNotification.instances[0].title).not.toContain('11111111');
    uuidSpy.mockRestore();
    matchMediaSpy.mockRestore();
  });

  it('still uses "Terminal" as the label for the main session\'s exit notification (regression check)', async () => {
    FakeNotification.permission = 'granted';
    render(<App />);
    const client = FakeWsClient.instances[0];
    client.open();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    client.emit('pty:exit', { type: 'pty:exit', sessionId: 'main', exitCode: 0 });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    expect(FakeNotification.instances).toHaveLength(1);
    expect(FakeNotification.instances[0].title).toContain('Terminal');
  });
});
