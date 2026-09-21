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
  const notification = new Notification(`${label} exited`, { body: `Exit code ${exitCode}` });
  notification.onclick = () => window.focus();
}
