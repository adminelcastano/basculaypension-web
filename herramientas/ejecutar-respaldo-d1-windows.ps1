# Lanzador Windows para Ubuntu/WSL. No ejecutarlo antes de las pruebas finales.
# Lee un token protegido con DPAPI; lo entrega sólo al proceso WSL hijo.
# Nunca acepta claves/token como argumento o texto en logs.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$file = Join-Path $env:LOCALAPPDATA 'ElCastano\D1\cf-export.dpapi'
if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    throw 'No hay token DPAPI. Preparar credencial desde PowerShell del mismo usuario.'
}
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    throw 'No se encontró WSL. Configurar Ubuntu antes de programar tareas.'
}
$encrypted = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::ASCII)
$secure = ConvertTo-SecureString -String $encrypted
$ptr = [IntPtr]::Zero
$previousToken = [Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN','Process')
$previousWslenv = [Environment]::GetEnvironmentVariable('WSLENV','Process')
try {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    if ([string]::IsNullOrWhiteSpace($value)) { throw 'Token vacío en almacén Windows.' }
    $env:CLOUDFLARE_API_TOKEN = $value
    # WSLENV sin sufijos: variable simple, sólo durante este proceso.
    # No aparecerá en la línea de comandos ni en el repositorio.
    $parts = @($previousWslenv -split ':' | Where-Object {
        $_ -and ($_ -notmatch '^CLOUDFLARE_API_TOKEN(/.*)?$')
    })
    $env:WSLENV = (@($parts) + @('CLOUDFLARE_API_TOKEN')) -join ':'
    Remove-Variable value -ErrorAction SilentlyContinue
    & wsl.exe --exec /bin/bash -c 'cd "$HOME/basculaypension-web" && /bin/bash herramientas/ejecutar-respaldo-d1-wsl.sh'
    if ($LASTEXITCODE -ne 0) {
        throw ('La ejecución aislada en WSL terminó con código ' + $LASTEXITCODE)
    }
    Write-Host 'Ejecución WSL finalizada sin error; revisar el inventario de copias.'
} finally {
    [Environment]::SetEnvironmentVariable('CLOUDFLARE_API_TOKEN',$previousToken,'Process')
    [Environment]::SetEnvironmentVariable('WSLENV',$previousWslenv,'Process')
    if ($ptr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
    $secure.Dispose()
}
