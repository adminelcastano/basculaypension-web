# Respaldos cifrados D1 — Windows principal, macOS recuperación

**Estado: preparado, no probado ni activado.** El usuario confirmó que **Windows permanece normalmente encendida**. Ningún archivo de D1 productiva se ha exportado ni hay tareas programadas por estos cambios.

## Arquitectura definitiva propuesta

- **Windows (principal)**: Task Scheduler → PowerShell (token Cloudflare cifrado con DPAPI bajo el mismo usuario Windows) → Ubuntu/WSL (Wrangler fijo 4.151.2) → exportación SQL temporal → comprobación SQLite local → cifrado `age` con **clave pública** → rclone → carpeta privada de Drive. El respaldo cifrado también permanece localmente en WSL.
- **macOS (recuperación y custodia)**: guarda **la clave privada** `age` fuera de Google Drive, GitHub y chats, bajo FileVault y con segunda custodia independiente. Puede descifrar y restaurar una copia en SQLite local con `herramientas/verificar-restauracion-d1-local.sh`.
- **Drive**: `El Castaño · Respaldos D1 cifrados`, carpeta nueva ya creada en `administracion@basculaypension.com`. Metadatos comprobados: propietario único, no compartida, vacía. Su identificador sólo se utilizará en la configuración local de rclone; **no publicar en GitHub**.
- **Separación de secretos**: Windows posee el token Cloudflare de exportación y **sólo la clave pública de cifrado**; macOS guarda la clave privada de recuperación. El remote rclone en Windows usa una autorización Google independiente guardada localmente. `root_folder_id` acota las rutas navegables por rclone, pero **no reduce por sí mismo el alcance del permiso OAuth**.
- **Disponibilidad**: la tarea Windows usa el mismo usuario interactivo que protegió el token con DPAPI. Si la sesión se cierra, no se garantiza ejecución. Una tarea retrasada puede ejecutarse al volver a iniciar sesión, pero Windows debe estar encendida y WSL disponible.

## Fase A — preparar Mac como custodio (requiere intervención del administrador)

En Terminal macOS:

```bash
brew install age sqlite git
git clone https://github.com/adminelcastano/basculaypension-web.git
cd basculaypension-web
git fetch origin deuda-tecnica/fases-1-4-20261019
git switch --track origin/deuda-tecnica/fases-1-4-20261019
```

Habilitar FileVault si el equipo todavía no lo usa y elegir una carpeta **local cifrada, no sincronizada en la nube**. Crear la clave de recuperación **sólo en esa Mac**:

```bash
export AGE_KEY_DIR="$HOME/Library/Application Support/ElCastano/Clave-D1"
bash herramientas/preparar-clave-respaldo-local.sh
```

El programa muestra la **clave pública** `age1...`; es la única cadena que se llevará a Windows. Custodiar el archivo de clave **privada** en macOS, con una segunda copia protegida fuera de ambos equipos. Si se pierde la clave privada, no podrán recuperarse los respaldos cifrados.

Para probar una restauración **local** más adelante, con el archivo cifrado y su manifiesto ya descargados en la Mac:

```bash
export AGE_KEY_FILE="$HOME/Library/Application Support/ElCastano/Clave-D1/d1-elcastano-age-key.txt"
bash herramientas/verificar-restauracion-d1-local.sh "/ruta/segura/d1-AAAAMMDDTHHMMSSZ.sql.age"
```

**No ejecutar aún:** todas las pruebas se harán juntas al finalizar las correcciones.

## Fase B — preparar Windows/Ubuntu WSL como ejecutor

En PowerShell, si todavía no hay Ubuntu WSL:

```powershell
wsl --install -d Ubuntu
```

Reiniciar si lo solicita y configurar Ubuntu. Dentro de Ubuntu/WSL, instalar `age`, `sqlite3`, `rclone` y Git, además de Node.js **22 o superior** con `npx` disponible para el usuario WSL (con nvm, por ejemplo). La tarea carga `~/.nvm/nvm.sh` cuando necesita encontrar `npx`.

```bash
sudo apt update
sudo apt install -y age sqlite3 rclone git
git clone https://github.com/adminelcastano/basculaypension-web.git "$HOME/basculaypension-web"
cd "$HOME/basculaypension-web"
git fetch origin deuda-tecnica/fases-1-4-20261019
git switch --track origin/deuda-tecnica/fases-1-4-20261019
mkdir -p "$HOME/.config/elcastano-d1"
chmod 700 "$HOME/.config/elcastano-d1"
cp herramientas/respaldo-wsl.env.example "$HOME/.config/elcastano-d1/backup.env"
chmod 600 "$HOME/.config/elcastano-d1/backup.env"
```

Editar `backup.env` directamente dentro de WSL: `AGE_RECIPIENT` debe contener exclusivamente la **clave pública** que se creó en la Mac, `BACKUP_DEST` debe estar en almacenamiento Linux privado fuera del repositorio y `BACKUP_DRIVE_REMOTE=castano-d1-backups:`. Mantener **`BACKUP_ACTIVE="NO"`** hasta pruebas y autorización de publicación.

Con `rclone config`, crear **en WSL** el remote `castano-d1-backups`, cuenta administrativa `administracion@basculaypension.com` y `root_folder_id` de la carpeta exclusiva de respaldos. El remote y su token OAuth se guardan **sólo en WSL**, con permisos restrictivos; no compartirlos ni importarlos a GitHub.

El token Cloudflare **no se guarda en WSL**. Para ejecutar los archivos `.ps1` de forma estable desde Windows, tener también **Git para Windows** y una copia del código sin datos en una carpeta local de Windows (la copia Linux de WSL se conserva por separado). En PowerShell del usuario que programará la tarea:

```powershell
New-Item -ItemType Directory -Path "$env:LOCALAPPDATA\ElCastano" -Force | Out-Null
git clone https://github.com/adminelcastano/basculaypension-web.git "$env:LOCALAPPDATA\ElCastano\Codigo"
Set-Location "$env:LOCALAPPDATA\ElCastano\Codigo"
git fetch origin deuda-tecnica/fases-1-4-20261019
git switch --track origin/deuda-tecnica/fases-1-4-20261019
```

Esta segunda copia contiene únicamente código público; **no almacena SQL, tokens, claves privadas ni respaldos**. Si ya existe, verificar rama y commit antes de actualizar, no sobrescribirla automáticamente.

En Windows PowerShell 5.1, desde la misma cuenta Windows con que se ejecutará la tarea, preparar una credencial mínima de **exportación D1**:

```powershell
.\herramientas\preparar-credencial-d1-windows.ps1
```

Se solicitará el valor de forma oculta y se cifrará mediante **DPAPI**, enlazado al usuario Windows; se guardará en `%LOCALAPPDATA%\ElCastano\D1\cf-export.dpapi`, con ACL privado. No pegar tokens en este chat ni incluirlos como argumentos. **No reutilizar secretos del Worker.** Si se cambia de cuenta Windows, el archivo DPAPI no puede descifrarse sin reprovisión.

La tarea usa `herramientas/ejecutar-respaldo-d1-windows.ps1`, que recupera temporalmente la credencial protegida y la transmite únicamente al proceso hijo WSL mediante `WSLENV`, sin incluirla en la línea de comandos. Windows y ese usuario WSL pueden inspeccionar su propio entorno de proceso durante la ejecución; por ello sólo debe ejecutarse bajo cuentas de administración confiables.

## Fase C — prueba final conjunta y activación

No se ha ejecutado ningún script ni instalado tareas. **Tras aprobar todas las pruebas**, el administrador cambiará `BACKUP_ACTIVE="NO"` por `BACKUP_ACTIVE="SI"` en el archivo local de WSL y validará la ejecución controlada:

```powershell
.\herramientas\ejecutar-respaldo-d1-windows.ps1
```

Este comando, una vez habilitado y autenticado, **sí exporta la D1 productiva**, cifra y sube archivos. Sólo realizarlo en la ventana final de validación acordada, después de cotejar base, cuenta, clave pública y carpeta.

Cuando la exportación, envío e importación local independiente estén validados, se preparará el horario **local de Windows** decidido por administración, sin inventar horas:

```powershell
.\herramientas\instalar-tarea-d1-windows.ps1 -Hora HH -Minuto MM -HabilitarTrasPruebas
```

`HH` (0–23) y `MM` (0–59) son valores a sustituir. La tarea queda asociada al usuario Windows actual; no se instala si ya existe. Si Windows está apagada o no hay sesión, se puede retrasar o perder una copia. Registrar alertas por ausencia de respaldos y definir quién revisa el historial de Task Scheduler.

**Mac como emergencia**: los ejecutores `ejecutar-respaldo-d1-macos.sh` y `instalar-respaldo-d1-macos.sh` permanecen como **alternativa opcional**, desactivada, nunca habilitada simultáneamente sin diseñar la coordinación. No duplicar programaciones por defecto.

## Comprobaciones y medidas que faltan antes del primer respaldo real

1. Validar permisos del token Cloudflare para exportar sólo la D1 correcta.
2. Probar que el remote OAuth de Google Drive sólo apunta a la carpeta de respaldos, y su custodia es privada.
3. Generar y recuperar archivo **sintético**, probar SHA-256 y la restauración SQLite en macOS.
4. Comprobar que Windows/WSL está disponible en el horario elegido, y que DPAPI se descifra bajo el usuario de la tarea.
5. Supervisar ausencia o deterioro de copias locales: desde Ubuntu/WSL, ejecutar `bash herramientas/verificar-estado-respaldo-wsl.sh` **después** de un primer respaldo válido. Esta consulta no usa secretos ni modifica datos, comprueba el SHA-256 y alerta si han transcurrido más de 36 horas (configurable localmente con `BACKUP_MAX_HOURS`). Para notificaciones automáticas, programar un control Windows separado tras las pruebas y decidir qué canal operativo recibirá las alertas. La comprobación local no certifica disponibilidad remota de Drive.
6. Definir política de retención (sin borrado automático todavía) y custodia redundante de la clave privada.
6. Sólo entonces habilitar programación diaria y vigilar el primer respaldo cifrado real.

Referencias: [Microsoft WSLENV](https://learn.microsoft.com/windows/wsl/interop), [PowerShell DPAPI](https://learn.microsoft.com/powershell/module/microsoft.powershell.security/convertfrom-securestring), [rclone Drive](https://rclone.org/drive/), [Cloudflare D1 export](https://developers.cloudflare.com/workers/wrangler/commands/d1/), [age](https://github.com/FiloSottile/age).
