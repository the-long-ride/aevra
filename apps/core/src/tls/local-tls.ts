import { spawn } from 'node:child_process';
import { X509Certificate, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { ServerOptions } from 'node:https';
import os from 'node:os';
import path from 'node:path';

export interface LocalTlsPaths {
  dir: string;
  certificatePath: string;
  certificateDerPath: string;
  keyPath: string;
  pfxPath: string;
  passphrasePath: string;
}

export interface LocalTlsMaterial {
  serverOptions: ServerOptions;
  certificatePem: string;
  certificatePath: string;
  caPath: string;
  managed: boolean;
}

export interface LocalTlsOptions {
  platform?: NodeJS.Platform;
  trust?: boolean;
  certificatePath?: string;
  keyPath?: string;
  caPath?: string;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function localTlsPaths(stateDir: string): LocalTlsPaths {
  const dir = path.join(stateDir, 'tls');
  return {
    dir,
    certificatePath: path.join(dir, 'localhost-cert.pem'),
    certificateDerPath: path.join(dir, 'localhost-cert.cer'),
    keyPath: path.join(dir, 'localhost-key.pem'),
    pfxPath: path.join(dir, 'localhost.pfx'),
    passphrasePath: path.join(dir, 'localhost-pfx.passphrase'),
  };
}

export function windowsTlsScript(): string {
  return String.raw`
$ErrorActionPreference = 'Stop'
$rsa = [System.Security.Cryptography.RSACng]::new(2048)
try {
  $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
    'CN=localhost',
    $rsa,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256,
    [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
  )
  $san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
  $san.AddDnsName('localhost')
  $san.AddIpAddress([System.Net.IPAddress]::Parse('127.0.0.1'))
  $san.AddIpAddress([System.Net.IPAddress]::Parse('::1'))
  $request.CertificateExtensions.Add($san.Build($false))

  $usage = [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment
  $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new($usage, $true))
  $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
  $oids = [System.Security.Cryptography.OidCollection]::new()
  [void]$oids.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
  $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids, $false))

  $cert = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5), [DateTimeOffset]::UtcNow.AddDays(365))
  try {
    $der = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    $pfx = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $env:AEVRA_TLS_PFX_PASSWORD)
    [System.IO.File]::WriteAllBytes($env:AEVRA_TLS_CERT_DER, $der)
    [System.IO.File]::WriteAllBytes($env:AEVRA_TLS_PFX, $pfx)
    $base64 = [Convert]::ToBase64String($der, [Base64FormattingOptions]::InsertLineBreaks)
    $nl = [Environment]::NewLine
    $pem = '-----BEGIN CERTIFICATE-----' + $nl + $base64 + $nl + '-----END CERTIFICATE-----' + $nl
    [System.IO.File]::WriteAllText($env:AEVRA_TLS_CERT, $pem, [System.Text.UTF8Encoding]::new($false))
  } finally {
    $cert.Dispose()
  }
} finally {
  $rsa.Dispose()
}
`;
}

function windowsTrustScript(): string {
  return String.raw`
$ErrorActionPreference = 'Stop'
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($env:AEVRA_TLS_CERT_DER)
$root = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root','CurrentUser')
$root.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
if ($root.Certificates.Find([System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, $cert.Thumbprint, $false).Count -eq 0) { $root.Add($cert) }
$root.Close()
`;
}

function run(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      shell: false,
      windowsHide: true,
      env: env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function certificateStillValid(certificatePem: string, now = Date.now()): boolean {
  try {
    const cert = new X509Certificate(certificatePem);
    const sans = cert.subjectAltName ?? '';
    const enoughLifetime = Date.parse(cert.validTo) - now > 30 * 24 * 60 * 60 * 1000;
    return (
      enoughLifetime &&
      sans.includes('DNS:localhost') &&
      sans.includes('IP Address:127.0.0.1') &&
      (sans.includes('IP Address:::1') || sans.includes('IP Address:0:0:0:0:0:0:0:1'))
    );
  } catch {
    return false;
  }
}

function managedFilesReady(paths: LocalTlsPaths, platform: NodeJS.Platform): boolean {
  if (!existsSync(paths.certificatePath)) return false;
  const cert = readFileSync(paths.certificatePath, 'utf8');
  if (!certificateStillValid(cert)) return false;
  if (platform === 'win32')
    return (
      existsSync(paths.certificateDerPath) &&
      existsSync(paths.pfxPath) &&
      existsSync(paths.passphrasePath)
    );
  return existsSync(paths.keyPath);
}

function openSslConfig(): string {
  return `[req]\nprompt = no\ndistinguished_name = dn\nx509_extensions = server\n[dn]\nCN = localhost\n[server]\nbasicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature,keyEncipherment\nextendedKeyUsage = serverAuth\nsubjectAltName = @alt_names\n[alt_names]\nDNS.1 = localhost\nIP.1 = 127.0.0.1\nIP.2 = ::1\n`;
}

async function generateUnix(paths: LocalTlsPaths): Promise<void> {
  const configPath = path.join(paths.dir, 'openssl-localhost.cnf');
  writeFileSync(configPath, openSslConfig(), { mode: 0o600 });
  try {
    const result = await run('openssl', [
      'req',
      '-x509',
      '-nodes',
      '-newkey',
      'rsa:2048',
      '-sha256',
      '-days',
      '365',
      '-keyout',
      paths.keyPath,
      '-out',
      paths.certificatePath,
      '-config',
      configPath,
      '-extensions',
      'server',
    ]);
    if (result.code !== 0)
      throw new Error(`openssl certificate generation failed: ${result.stderr || result.stdout}`);
    chmodSync(paths.keyPath, 0o600);
    chmodSync(paths.certificatePath, 0o600);
  } finally {
    rmSync(configPath, { force: true });
  }
}

async function trustUnix(certificatePath: string, platform: NodeJS.Platform): Promise<void> {
  if (platform === 'darwin') {
    const keychain = path.join(os.homedir(), 'Library', 'Keychains', 'login.keychain-db');
    const result = await run('security', [
      'add-trusted-cert',
      '-r',
      'trustRoot',
      '-k',
      keychain,
      certificatePath,
    ]);
    if (result.code !== 0)
      throw new Error(
        `Could not trust Aevra localhost certificate: ${result.stderr || result.stdout}`,
      );
    return;
  }
  if (platform === 'linux') {
    const nssDir = path.join(os.homedir(), '.pki', 'nssdb');
    mkdirSync(nssDir, { recursive: true, mode: 0o700 });
    try {
      if (!existsSync(path.join(nssDir, 'cert9.db')))
        await run('certutil', ['-d', `sql:${nssDir}`, '-N', '--empty-password']);
      await run('certutil', ['-d', `sql:${nssDir}`, '-D', '-n', 'Aevra Localhost']);
      await run('certutil', [
        '-d',
        `sql:${nssDir}`,
        '-A',
        '-t',
        'P,,',
        '-n',
        'Aevra Localhost',
        '-i',
        certificatePath,
      ]);
    } catch {
      // Linux browser trust stores vary; local HTTPS still works and Aevra's CLI pins the certificate directly.
    }
  }
}

async function generateWindows(paths: LocalTlsPaths): Promise<void> {
  const passphrase = randomBytes(24).toString('base64url');
  writeFileSync(paths.passphrasePath, passphrase, { mode: 0o600 });
  const env = {
    ...process.env,
    AEVRA_TLS_PFX_PASSWORD: passphrase,
    AEVRA_TLS_PFX: paths.pfxPath,
    AEVRA_TLS_CERT: paths.certificatePath,
    AEVRA_TLS_CERT_DER: paths.certificateDerPath,
  };
  const result = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', windowsTlsScript()],
    env,
  );
  if (result.code !== 0)
    throw new Error(
      `PowerShell localhost certificate generation failed: ${result.stderr || result.stdout}`,
    );
  for (const file of [paths.pfxPath, paths.passphrasePath]) {
    try {
      chmodSync(file, 0o600);
    } catch {
      /* Windows ACLs remain authoritative. */
    }
  }
}

async function trustWindows(paths: LocalTlsPaths): Promise<void> {
  const env = { ...process.env, AEVRA_TLS_CERT_DER: paths.certificateDerPath };
  const result = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      windowsTrustScript(),
    ],
    env,
  );
  if (result.code !== 0)
    throw new Error(
      `Could not trust Aevra localhost certificate: ${result.stderr || result.stdout}`,
    );
}

function loadManaged(paths: LocalTlsPaths, platform: NodeJS.Platform): LocalTlsMaterial {
  const certificatePem = readFileSync(paths.certificatePath, 'utf8');
  const serverOptions: ServerOptions =
    platform === 'win32'
      ? {
          pfx: readFileSync(paths.pfxPath),
          passphrase: readFileSync(paths.passphrasePath, 'utf8').trim(),
        }
      : { cert: certificatePem, key: readFileSync(paths.keyPath) };
  return {
    serverOptions,
    certificatePem,
    certificatePath: paths.certificatePath,
    caPath: paths.certificatePath,
    managed: true,
  };
}

export function loadLocalTlsOverride(
  certificatePath: string,
  keyPath: string,
  caPath?: string,
): LocalTlsMaterial {
  const certPath = path.resolve(certificatePath);
  const resolvedKey = path.resolve(keyPath);
  const resolvedCa = caPath ? path.resolve(caPath) : certPath;
  const certificatePem = readFileSync(certPath, 'utf8');
  return {
    serverOptions: { cert: certificatePem, key: readFileSync(resolvedKey) },
    certificatePem,
    certificatePath: certPath,
    caPath: resolvedCa,
    managed: false,
  };
}

export async function ensureLocalTls(
  stateDir: string,
  options: LocalTlsOptions = {},
): Promise<LocalTlsMaterial> {
  if (options.certificatePath || options.keyPath) {
    if (!options.certificatePath || !options.keyPath)
      throw new Error('AEVRA_TLS_CERT and AEVRA_TLS_KEY must be set together');
    return loadLocalTlsOverride(options.certificatePath, options.keyPath, options.caPath);
  }
  const platform = options.platform ?? process.platform;
  const paths = localTlsPaths(stateDir);
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  if (!managedFilesReady(paths, platform)) {
    for (const file of [
      paths.certificatePath,
      paths.certificateDerPath,
      paths.keyPath,
      paths.pfxPath,
      paths.passphrasePath,
    ])
      rmSync(file, { force: true });
    if (platform === 'win32') await generateWindows(paths);
    else await generateUnix(paths);
  }
  if (options.trust !== false) {
    if (platform === 'win32') await trustWindows(paths);
    else await trustUnix(paths.certificatePath, platform);
  }
  return loadManaged(paths, platform);
}
