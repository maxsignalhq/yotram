export type PermissionState = 'default' | 'granted' | 'denied';

function hasNotificationApi(): boolean {
  return typeof window !== 'undefined' && typeof window.Notification !== 'undefined';
}

export function getPermissionState(): PermissionState {
  if (!hasNotificationApi()) return 'denied';
  return Notification.permission as PermissionState;
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  if (!hasNotificationApi()) return 'denied';
  const result = await Notification.requestPermission();
  return result as PermissionState;
}

export function notifyProcessExit(label: string, exitCode: number): void {
  if (!hasNotificationApi() || Notification.permission !== 'granted') return;
  // `new Notification(...)` can throw even when the API is feature-detected
  // as present (e.g. Android Chrome, where construction always throws
  // "Illegal constructor" and ServiceWorkerRegistration.showNotification()
  // is required instead). This function must never throw: it's called from
  // a handler in a shared WebSocket dispatch loop with no try/catch of its
  // own, so an uncaught error here would stop every handler registered
  // after this one from running for the same message.
  try {
    const notification = new Notification(`${label} exited`, { body: `Exit code ${exitCode}` });
    notification.onclick = () => window.focus();
  } catch {
    // Swallow silently — feature detection can't guarantee construction succeeds.
  }
}
