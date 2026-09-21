import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPermissionState, requestNotificationPermission, notifyProcessExit } from '../src/notifications';

class FakeNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  static instances: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  constructor(public title: string, public options?: NotificationOptions) {
    FakeNotification.instances.push(this);
  }
}

const originalNotification = (window as any).Notification;

beforeEach(() => {
  FakeNotification.permission = 'default';
  FakeNotification.instances = [];
  FakeNotification.requestPermission = vi.fn(async () => FakeNotification.permission);
  (window as any).Notification = FakeNotification;
});

afterEach(() => {
  (window as any).Notification = originalNotification;
});

describe('getPermissionState', () => {
  it('reflects Notification.permission', () => {
    FakeNotification.permission = 'granted';
    expect(getPermissionState()).toBe('granted');
  });

  it('returns "denied" when the Notification API is unavailable', () => {
    (window as any).Notification = undefined;
    expect(getPermissionState()).toBe('denied');
  });
});

describe('requestNotificationPermission', () => {
  it('calls Notification.requestPermission and returns its result', async () => {
    FakeNotification.permission = 'granted';
    const result = await requestNotificationPermission();
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(result).toBe('granted');
  });
});

describe('notifyProcessExit', () => {
  it('does nothing when permission is not granted', () => {
    FakeNotification.permission = 'default';
    notifyProcessExit('Terminal', 0);
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it('creates a notification with a title/body derived from the label and exit code when granted', () => {
    FakeNotification.permission = 'granted';
    notifyProcessExit('Shell 2', 1);
    expect(FakeNotification.instances).toHaveLength(1);
    const notification = FakeNotification.instances[0];
    expect(notification.title).toContain('Shell 2');
    expect(notification.options?.body).toContain('1');
  });

  it('focuses the window when the notification is clicked', () => {
    FakeNotification.permission = 'granted';
    const focusSpy = vi.spyOn(window, 'focus').mockImplementation(() => {});
    notifyProcessExit('Terminal', 0);
    FakeNotification.instances[0].onclick?.();
    expect(focusSpy).toHaveBeenCalledTimes(1);
    focusSpy.mockRestore();
  });

  it('does not throw when the Notification API is unavailable', () => {
    (window as any).Notification = undefined;
    expect(() => notifyProcessExit('Terminal', 0)).not.toThrow();
  });
});
