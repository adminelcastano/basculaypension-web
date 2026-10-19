# Instalación preparada: macOS + Windows (WSL)

**Estado: preparado, NO probado ni activado.** No ejecutar contra producción antes de la pasada de pruebas y de comprobar el acceso mínimo. No hay contraseñas, tokens ni claves privadas en este repositorio.

## Separación de responsabilidades

- **Windows**: equipo custodio de la **clave privada** `age` y recuperación independiente; Ubuntu mediante WSL. Requiere almacenamiento cifrado y respaldo independiente de la clave. No guardar en OneDrive, Google Drive, repositorio ni chat.
- **macOS**: posible ejecutor principal de exportación D1 y subida de **archivos ya cifrados**; sólo necesita la **clave pública** `AGE_RECIPIENT`. Se autentica a Cloudflare con un token de exportación guardado en Llavero, y a Google Drive con un remote de rclone protegido localmente.
- La asignación es reversible, pero mantener el secreto de descifrado separado del equipo que exporta limita el daño si ese equipo se compromete. El equipo programado necesita estar encendido y tener sesión de usuario; launchd recupera tareas omitidas por reposo, no necesariamente por apagado.

## 1. Preparación de Windows (en el ordenador, no en el chat)

Desde **PowerShell como administrador**, si Ubuntu WSL aún no está instalado:

```powershell
wsl --install -d Ubuntu
```

Reiniciar si Windows lo solicita y terminar la configuración de Ubuntu. Después, **en la terminal de Ubuntu/WSL**, instalar las herramientas:

```bash
sudo apt update
sudo apt install -y age sqlite3 git
```

Obtener el repositorio y la rama preparada en la carpeta Linux del propio WSL, **no en /mnt/c si está sincronizado con OneDrive**:

```bash
git clone https://github.com/adminelcastano/basculaypension-web.git
cd basculaypension-web
git fetch origin deuda-tecnica/fases-1-4-20261019
git switch --track origin/deuda-tecnica/fases-1-4-20261019
```

Antes de la primera ejecución real, crear una ubicación **privada y cifrada** de claves (con BitLocker/almacenamiento cifrado habilitado y copia independiente). Cuando el administrador confirme esa protección:

```bash
export AGE_KEY_DIR="$HOME/.local/share/elcastano-claves"
bash herramientas/preparar-clave-respaldo-local.sh
```

La herramienta muestra exclusivamente el **destinatario PÚBLICO** `age1...`. Llevar sólo esa cadena al Mac. Conservar `d1-elcastano-age-key.txt` de forma segura en Windows y en una segunda custodia independiente, nunca en Drive. Si se pierde la clave privada, los respaldos cifrados serán irrecuperables.

La comprobación posterior de descifrado/restauración **local**, tras crear el primer respaldo y descargar sus dos archivos a WSL, será:

```bash
export AGE_KEY_FILE="$HOME/.local/share/elcastano-claves/d1-elcastano-age-key.txt"
bash herramientas/verificar-restauracion-d1-local.sh "/ruta/segura/d1-AAAAMMDDTHHMMSSZ.sql.age"
```

**No ejecutar todavía**: se hará al final, como parte de las pruebas conjuntas.

## 2. Preparación de macOS

Con Homebrew ya instalado en la Mac, estas dependencias son compatibles con los scripts:

```bash
brew install age rclone sqlite node git
```

Git y Bash también pueden estar instalados mediante herramientas de Apple. No hace falta instalar GNU coreutils: `respaldo-portable.sh` acepta `shasum` y `md5` nativos de macOS. El script local usa SQLite; no configura ninguna base de producción.

Obtener la rama preparada:

```bash
git clone https://github.com/adminelcastano/basculaypension-web.git
cd basculaypension-web
git fetch origin deuda-tecnica/fases-1-4-20261019
git switch --track origin/deuda-tecnica/fases-1-4-20261019
```

Crear la configuración **sin secretos**, usando únicamente la clave pública procedente de Windows:

```bash
mkdir -p "$HOME/.config/elcastano-d1"
chmod 700 "$HOME/.config/elcastano-d1"
cp herramientas/respaldo-macos.env.example "$HOME/.config/elcastano-d1/backup.env"
chmod 600 "$HOME/.config/elcastano-d1/backup.env"
```

Editar personalmente `backup.env`, reemplazando `AGE_RECIPIENT` por la clave pública `age1...` y eligiendo `BACKUP_DEST` (carpeta local privada fuera del repositorio) y `BACKUP_DRIVE_REMOTE=castano-d1-backups:`. Mantener `BACKUP_ACTIVE="NO"` hasta haber terminado la prueba final conjunta; sólo entonces cambiarlo a `BACKUP_ACTIVE="SI"`. **Nunca** introducir la clave privada ni un token en ese archivo.

En la Terminal del Mac, configurar un **token Cloudflare de permisos mínimos suficientes para exportar D1** en el Llavero (se solicita de forma interactiva, **no se imprime ni se pega en el chat**):

```bash
security add-generic-password -a "$USER" -s "elcastano-d1-backup" -w
```

Comprobar en la configuración administrativa de Cloudflare que ese token puede exportar sólo la base autorizada. No reutilizar secretos de Workers ni colocarlos en un `.env` del proyecto.

En la Mac, ejecutar **interactivamente** `rclone config` y crear `castano-d1-backups` de tipo `drive`, autenticando sólo la cuenta `administracion@basculaypension.com`. En opciones avanzadas, establecer **`root_folder_id` al ID de la carpeta exclusiva `El Castaño · Respaldos D1 cifrados`**. Obtenerlo de la URL de esa carpeta en tu Drive, sin colocarlo en GitHub.

Importante: `root_folder_id` limita las rutas que navega rclone, **no reduce por sí mismo el alcance OAuth** concedido a Google Drive. Mantener el archivo `rclone.conf` bajo permisos privados del usuario y revisar los permisos durante la prueba final.

El ejecutor preparado es:

```bash
bash herramientas/ejecutar-respaldo-d1-macos.sh
```

Este comando **sí exportará D1 de producción cuando las credenciales estén instaladas**. No utilizarlo hasta la prueba final autorizada, después de verificar que las claves, los destinatarios y el remote corresponden a los recursos correctos.

## 3. Programación diaria macOS (preparada, no activada)

Una vez superadas las pruebas conjuntas y establecido el horario local de administración:

```bash
BACKUP_HOUR=HH BACKUP_MINUTE=MM bash herramientas/instalar-respaldo-d1-macos.sh
```

Sustituir `HH` y `MM` por la hora y minuto elegidos; no hay un horario impuesto. Crea `~/Library/LaunchAgents/com.elcastano.d1-backup.plist`, valida el formato y lo registra sin ejecutar inmediatamente. Los resultados sólo muestran estados no secretos en `~/Library/Logs/`.

**Advertencias:** un LaunchAgent de usuario necesita una sesión activa y que el Llavero autorice el acceso; si la Mac está apagada, la tarea puede perderse. Para garantizar respaldo diario deben revisarse tanto el uso real de ese equipo como las alertas y el estado del último respaldo, y considerar un ejecutor siempre encendido autorizado.

## 4. Criterios previos a la activación

1. Clave privada custodiada y recuperable **fuera de la Mac y de Drive**.
2. Clave pública `AGE_RECIPIENT` correcta en el Mac, probada con un archivo sintético.
3. Token Cloudflare de exportación mínimo en Llavero; rclone con cuenta y `root_folder_id` verificados.
4. Prueba SQL sintética y restauración independiente en Windows; comprobación remota de ambos archivos cifrados.
5. Escoger equipo que esté encendido al horario elegido y aprobar retención, responsables y monitoreo.
6. Sólo entonces habilitar la programación y revisar resultado del primer backup real. **No borrar respaldos automáticamente todavía.**

Referencia: [age (proyecto oficial)](https://github.com/FiloSottile/age), [rclone Google Drive](https://rclone.org/drive/), [Cloudflare D1 export](https://developers.cloudflare.com/workers/wrangler/commands/d1/), [Apple launchd](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html).
