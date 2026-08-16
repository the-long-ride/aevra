import { spawn } from 'node:child_process';

export interface NotificationCommand {
  file: string;
  args: string[];
}

function appleScriptLiteral(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', ' ');
}

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

export function buildNotificationCommand(
  platform: NodeJS.Platform,
  title: string,
  message: string,
): NotificationCommand | null {
  if (platform === 'linux') {
    return {
      file: 'notify-send',
      args: ['--app-name=Aevra', title, message],
    };
  }

  if (platform === 'darwin') {
    const script = `display notification "${appleScriptLiteral(message)}" with title "${appleScriptLiteral(title)}"`;
    return { file: 'osascript', args: ['-e', script] };
  }

  if (platform === 'win32') {
    const title64 = base64(title);
    const message64 = base64(message);
    const script = [
      `$title=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${title64}'))`,
      `$message=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${message64}'))`,
      `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null`,
      `$xml=New-Object Windows.Data.Xml.Dom.XmlDocument`,
      `$safeTitle=[Security.SecurityElement]::Escape($title)`,
      `$safeMessage=[Security.SecurityElement]::Escape($message)`,
      `$xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text>'+$safeTitle+'</text><text>'+$safeMessage+'</text></binding></visual></toast>')`,
      `$toast=New-Object Windows.UI.Notifications.ToastNotification $xml`,
      `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Aevra').Show($toast)`,
    ].join(';');
    return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script] };
  }

  return null;
}

export function notifySystem(title: string, message: string): void {
  const command = buildNotificationCommand(process.platform, title, message);
  if (!command) return;
  try {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
    });
    child.once('error', () => {});
    child.unref();
  } catch {
    // Notifications are best-effort and must never block execution.
  }
}
