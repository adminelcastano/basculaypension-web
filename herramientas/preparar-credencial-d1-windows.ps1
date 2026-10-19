# Configuración privada de credencial Cloudflare para respaldos D1 en Windows.
# Ejecutar INTERACTIVAMENTE desde PowerShell 5.1 del usuario administrador.
# No pide ni almacena la clave privada age; no toca Cloudflare.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'ElCastano\D1'
$file = Join-Path $dir 'cf-export.dpapi'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
if (Test-Path -LiteralPath $file) {
    throw 'Ya existe una credencial protegida; no se reemplaza automáticamente.'
}
$token = Read-Host 'Token de Cloudflare de exportación D1 (no se mostrará)' -AsSecureString
try {
    $encrypted = ConvertFrom-SecureString -SecureString $token
    if ([string]::IsNullOrWhiteSpace($encrypted)) { throw 'No se recibió credencial.' }
    [System.IO.File]::WriteAllText($file, $encrypted, [System.Text.Encoding]::ASCII)
    # DPAPI cifra para este usuario Windows, pero también restringimos el ACL NTFS.
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = New-Object System.Security.AccessControl.FileSecurity
    $acl.SetOwner($identity)
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $file -AclObject $acl
    Write-Host 'Credencial cifrada con DPAPI para este usuario de Windows; no se imprimió el valor.'
} catch {
    if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
    throw
} finally {
    $token.Dispose()
}
