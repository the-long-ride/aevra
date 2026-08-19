import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { ensureLocalTls, localTlsPaths, windowsTlsScript } from '../src/tls/local-tls.js';

test('local TLS paths live under Aevra state', () => {
  const p = localTlsPaths('/tmp/aevra-state');
  assert.equal(p.dir, path.join('/tmp/aevra-state', 'tls'));
  assert.equal(p.certificatePath, path.join(p.dir, 'localhost-cert.pem'));
  assert.equal(p.keyPath, path.join(p.dir, 'localhost-key.pem'));
  assert.equal(p.pfxPath, path.join(p.dir, 'localhost.pfx'));
});

test('managed certificate generation works on the current platform, covers loopback SANs, and is reused', async () => {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), 'aevra-tls-'));
  const first = await ensureLocalTls(stateDir, { platform: process.platform, trust: false });
  const cert = new X509Certificate(first.certificatePem);
  assert.match(cert.subjectAltName ?? '', /DNS:localhost/);
  assert.match(cert.subjectAltName ?? '', /IP Address:127\.0\.0\.1/);
  assert.match(cert.subjectAltName ?? '', /IP Address:(?:::1|0:0:0:0:0:0:0:1)/);
  assert.equal(first.managed, true);
  const paths = localTlsPaths(stateDir);
  assert.equal(existsSync(paths.certificatePath), true);
  if (process.platform === 'win32') {
    assert.equal(existsSync(paths.certificateDerPath), true);
    assert.equal(existsSync(paths.pfxPath), true);
    assert.equal(existsSync(paths.passphrasePath), true);
  } else {
    assert.equal(existsSync(paths.keyPath), true);
  }
  const before = readFileSync(first.certificatePath, 'utf8');
  const second = await ensureLocalTls(stateDir, { platform: process.platform, trust: false });
  assert.equal(second.certificatePem, before);
});

test('Windows certificate generation does not depend on the PowerShell Cert provider or mutate trust', () => {
  const script = windowsTlsScript();
  assert.match(script, /CertificateRequest/);
  assert.match(script, /SubjectAlternativeNameBuilder/);
  assert.match(script, /DNS|AddDnsName/);
  assert.match(script, /127\.0\.0\.1/);
  assert.match(script, /::1/);
  assert.doesNotMatch(script, /Cert:\\/i);
  assert.doesNotMatch(script, /New-SelfSignedCertificate/i);
  assert.doesNotMatch(script, /Export-PfxCertificate/i);
  assert.doesNotMatch(script, /\.KeySize\s*=/i);
  assert.match(script, /RSACng\]::new\(2048\)/i);
  assert.doesNotMatch(script, /X509Store\s*\(?'?Root/i);
  assert.doesNotMatch(script, /LocalMachine/i);
});

test('Windows TLS source has no PowerShell certificate-provider dependency', () => {
  const source = readFileSync(path.resolve('apps/core/src/tls/local-tls.ts'), 'utf8');
  assert.doesNotMatch(source, /Cert:\\/i);
  assert.doesNotMatch(source, /New-SelfSignedCertificate/i);
  assert.doesNotMatch(source, /Export-PfxCertificate/i);
});

test(
  'Windows normal-start path can trust the generated certificate in CurrentUser Root',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), 'aevra-tls-trust-'));
    const material = await ensureLocalTls(stateDir, { platform: 'win32', trust: true });
    const thumbprint = new X509Certificate(material.certificatePem).fingerprint.replaceAll(':', '');
    const script = String.raw`
$ErrorActionPreference = 'Stop'
$store = [System.Security.Cryptography.X509Certificates.X509Store]::new('Root','CurrentUser')
$store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
try {
  $found = $store.Certificates.Find([System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, $env:AEVRA_TLS_TEST_THUMBPRINT, $false)
  if ($found.Count -eq 0) { exit 2 }
  if ($env:AEVRA_TLS_TEST_REMOVE -eq '1') { foreach ($cert in $found) { $store.Remove($cert) } }
} finally { $store.Close() }
`;
    const env = { ...process.env, AEVRA_TLS_TEST_THUMBPRINT: thumbprint };
    t.after(() => {
      spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { encoding: 'utf8', env: { ...env, AEVRA_TLS_TEST_REMOVE: '1' } },
      );
    });
    const found = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { encoding: 'utf8', env },
    );
    assert.equal(found.status, 0, found.stderr || found.stdout);
  },
);
