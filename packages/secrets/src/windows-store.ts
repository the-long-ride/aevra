import type { ProcessAdapter } from './platform.js';

// CREDENTIALW and CredReadW/CredWriteW use one allocated blob, freed by CredFree.
// https://learn.microsoft.com/windows/win32/api/wincred/ns-wincred-credentialw
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.ComponentModel;
public static class AevraCredential {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct Credential {
    public UInt32 Flags, Type;
    public string TargetName, Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist, AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias, UserName;
  }
  [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool Write(ref Credential credential, UInt32 flags);
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool Read(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool Delete(string target, UInt32 type, UInt32 flags);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr pointer);
  public static void Set(string target, string value) {
    byte[] bytes = Encoding.UTF8.GetBytes(value);
    if (bytes.Length > 2560) throw new ArgumentException("Credential value exceeds Windows limit");
    IntPtr blob = Marshal.AllocHGlobal(Math.Max(bytes.Length, 1));
    try {
      Marshal.Copy(bytes, 0, blob, bytes.Length);
      Credential credential = new Credential { Type=1, TargetName=target, CredentialBlobSize=(UInt32)bytes.Length, CredentialBlob=blob, Persist=2, UserName="Aevra" };
      if (!Write(ref credential, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
    } finally {
      for (int i=0; i<bytes.Length; i++) Marshal.WriteByte(blob, i, 0);
      Marshal.FreeHGlobal(blob);
      Array.Clear(bytes, 0, bytes.Length);
    }
  }
  public static string Get(string target) {
    IntPtr pointer;
    if (!Read(target, 1, 0, out pointer)) {
      int error = Marshal.GetLastWin32Error();
      if (error == 1168) return null;
      throw new Win32Exception(error);
    }
    try {
      Credential credential = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
      byte[] bytes = new byte[credential.CredentialBlobSize];
      Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
      return Encoding.UTF8.GetString(bytes);
    } finally { CredFree(pointer); }
  }
  public static void Remove(string target) {
    if (!Delete(target, 1, 0)) {
      int error = Marshal.GetLastWin32Error();
      if (error != 1168) throw new Win32Exception(error);
    }
  }
}
"@
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$target = [string]$request.service + ':' + [string]$request.ref
switch ($request.operation) {
  'set' { [AevraCredential]::Set($target, [string]$request.value) }
  'get' { $value = [AevraCredential]::Get($target); if ($null -eq $value) { [Console]::Write('null') } else { [Console]::Write((ConvertTo-Json -InputObject $value -Compress)) } }
  'delete' { [AevraCredential]::Remove($target) }
  default { throw 'Unknown credential operation' }
}
`;

export async function windowsCredentialOperation(
  adapter: ProcessAdapter,
  service: string,
  ref: string,
  operation: 'set' | 'get' | 'delete',
  value?: string,
): Promise<string | null> {
  const result = await adapter.run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(SCRIPT, 'utf16le').toString('base64'),
    ],
    JSON.stringify({ service, ref, operation, value }),
  );
  if (result.code !== 0) throw new Error('Windows credential operation failed');
  if (operation !== 'get') return null;
  const decoded: unknown = JSON.parse(result.stdout.trim());
  if (decoded !== null && typeof decoded !== 'string')
    throw new Error('Invalid Windows credential response');
  return decoded;
}
