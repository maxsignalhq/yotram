import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PluginProvider, PluginsMenu } from '../src/plugins/PluginProvider';

vi.mock('../src/plugins/registry', () => ({ getPlugin: () => ({ commands: [], editors: [] }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('does not overwrite a Python path being edited when the plugin list refreshes', async () => {
  const plugin = { id: 'yotram.notebook', name: 'Notebook', version: '0.1.0', description: 'Notebook', enabled: false, permissions: [], settings: { python: 'python3' }, settingsSchema: { python: { label: 'Python executable', default: 'python3' } } };
  let resolveRefresh: (response: Response) => void = () => {};
  let calls = 0;
  const request = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'PUT') return new Response('{}');
    if (++calls === 2) return new Promise<Response>(resolve => { resolveRefresh = resolve; });
    return new Response(JSON.stringify([plugin]));
  });
  vi.stubGlobal('fetch', request);
  render(<PluginProvider workspaceId="local"><PluginsMenu openFile={() => {}} openPanel={() => {}} /></PluginProvider>);
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Plugins' }));
  const details = (await screen.findByText('Settings and access')).closest('details');
  expect(details?.open).toBe(false);
  expect(screen.getByRole('button', { name: 'Enable Notebook' })).toBeTruthy();
  fireEvent.click(screen.getByText('Settings and access'));
  const input = await screen.findByLabelText('Python executable');
  fireEvent.change(input, { target: { value: '/project/.venv/bin/python' } });
  await act(async () => resolveRefresh(new Response(JSON.stringify([plugin]))));
  expect((input as HTMLInputElement).value).toBe('/project/.venv/bin/python');
  fireEvent.click(screen.getByRole('button', { name: 'Enable Notebook' }));
  await waitFor(() => expect(request.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(true));
  const saved = request.mock.calls.find(([, options]) => options?.method === 'PUT')![1]!;
  expect(JSON.parse(saved.body as string)).toEqual({ enabled: true, settings: { python: '/project/.venv/bin/python' } });
});
