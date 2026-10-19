# Instala tarea de Windows Task Scheduler después de pruebas y aprobación de horario.
# NUNCA se ejecuta al instalarla; requiere -HabilitarTrasPruebas explícito.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateRange(0,23)][int]$Hora,
    [Parameter(Mandatory=$true)][ValidateRange(0,59)][int]$Minuto,
    [switch]$HabilitarTrasPruebas
)
$ErrorActionPreference = 'Stop'
if (-not $HabilitarTrasPruebas) {
    throw 'Instalación bloqueada hasta pruebas finales y autorización para activar.'
}
$dir = Join-Path $env:LOCALAPPDATA 'ElCastano\D1'
$cred = Join-Path $dir 'cf-export.dpapi'
if (-not (Test-Path -LiteralPath $cred -PathType Leaf)) {
    throw 'Falta la credencial DPAPI bajo el usuario Windows actual.'
}
$source = Join-Path $PSScriptRoot 'ejecutar-respaldo-d1-windows.ps1'
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw 'Falta el ejecutor Windows junto al instalador.'
}
$taskName = 'ElCastano-D1-Backup'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    throw 'La tarea ya existe; no se sobrescribe.'
}
New-Item -ItemType Directory -Path $dir -Force | Out-Null
# Copia ejecutor sin secretos a carpeta Windows estable; no depende de rutas UNC WSL.
$runner = Join-Path $dir 'ejecutar-respaldo-d1-windows.ps1'
if (Test-Path -LiteralPath $runner) { throw 'Ya hay un ejecutor instalado; revisar manualmente.' }
Copy-Item -LiteralPath $source -Destination $runner -ErrorAction Stop
try {
    $exe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $args = '-NoLogo -NoProfile -NonInteractive -File "' + $runner + '"'
    $action = New-ScheduledTaskAction -Execute $exe -Argument $args
    $at = (Get-Date).Date.AddHours($Hora).AddMinutes($Minuto)
    $trigger = New-ScheduledTaskTrigger -Daily -At $at
    $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
    Write-Host ('Tarea registrada a las {0:D2}:{1:D2} (hora LOCAL Windows); no se ejecutó ahora.' -f $Hora,$Minuto)
} catch {
    if (Test-Path -LiteralPath $runner) { Remove-Item -LiteralPath $runner -Force }
    throw
}
