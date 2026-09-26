import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dashboard } from '../src/components/Dashboard';

describe('Dashboard', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/api/workspaces/default') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(null) } as Response);
      if (url === '/api/workspaces') return Promise.resolve({ ok: true, json: () => Promise.resolve([{ id: '1', name: 'demo', path: '/tmp/demo', sessions: [] }]) } as Response);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a Forget control for each recent project', async () => {
    render(<Dashboard onOpen={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Forget /tmp/demo' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Forget /tmp/demo' }));
  });
});
