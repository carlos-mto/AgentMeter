# AgentMeter

Aplicación de bandeja para Windows que permite consultar los límites de uso de las suscripciones de **Claude Code, Codex, Antigravity, Grok y Grok Bot**. Reúne tus cuentas en un Dashboard, un Widget de escritorio o una Strip compacta, sin gestionar credenciales en otro servicio en la nube.

**Versión actual del código: 0.0.1** · Windows 10/11 · Tauri + WebView2 · MIT

[English](./README.md) · [Español](./README.es.md) · [Português](./README.pt.md) · [Italiano](./README.it.md) · [Deutsch](./README.de.md) · [繁體中文](./README.zh-TW.md)

[Funciones](#features) · [Configuración](#installation) · [Cuentas](#accounts) · [Widget / Strip](#widget-strip) · [Compilar y probar](#development)

<a id="features"></a>
## Funciones

- **Cinco proveedores**, con actualizaciones independientes, mensajes de configuración/estado, lecturas en caché y reintentos con espera progresiva. Un proveedor no disponible no bloquea a los demás.
- **Cuatro páginas del Dashboard:** Inicio, Servicios, Estadísticas y Configuración; menú lateral solo con iconos, tooltips traducidos, navegación por teclado y controles accesibles.
- **Múltiples cuentas de Claude/Codex:** perfiles aislados, inicio de sesión mediante la CLI oficial, terminales específicas por cuenta, cuotas/caché/reintentos independientes y una cuenta seleccionada por proveedor para Strip.
- **Detalles de cuotas:** periodos reportados, porcentajes usados o restantes, plan, cuenta atrás del reinicio, indicadores de ritmo y desglose por proveedor/producto cuando estén disponibles.
- **Widget Neon:** ventana transparente y siempre encima, nombres de cuenta, anillos de porcentaje, barras de sesión, columnas 5h/7d alineadas y tiempo hasta el reinicio en letra pequeña. Las cuentas adicionales tienen desplazamiento interno.
- **Escala del Widget:** comienza al **100%**, ajustable hasta **300%** en pasos del **25%**, además del escalado DPI de Windows. La escala guardada no agranda Strip.
- **Strip compacta:** cuentas seleccionadas, nombres abreviados, movimiento libre o fijación encima de una barra de tareas sin reservar espacio del escritorio.
- **Visibilidad:** ocultar proveedores pausa sus consultas; el grupo Claude+GPT de Antigravity se puede ocultar sin modificar sus datos originales.
- **Preferencias persistentes:** idioma, usado/restante, modo de ventana, escala, bloqueo, posiciones separadas de Widget/Strip y fijación a la barra de tareas.
- **Bandeja e inicio automático:** abrir Dashboard, mostrar/ocultar ventanas, bloquear posición, iniciar con Windows y salir. La vista guardada se recupera con reintentos mientras se inicializan escritorio y monitores.
- **Temas claro/oscuro y cinco idiomas de interfaz**, aplicados a Dashboard, Widget, Strip y bandeja. Se sigue la apariencia del sistema hasta elegir un tema explícitamente.
- **Consultas conservadoras de Claude:** se pausan con Windows inactivo/bloqueado, respetan las esperas del servidor incluso tras reiniciar y usan la CLI oficial para intentar recuperar un access token rechazado.
- **Integración local:** utiliza sesiones existentes de aplicaciones/CLI. Antigravity usa el servidor local de su IDE o `agy`; no requiere extensión de navegador, cuenta de AgentMeter ni telemetría.

<a id="screenshots"></a>
## Capturas

### Dashboard
<p align="center"><img src="./assets/screenshots/dashboard.png" alt="Captura real del Dashboard de AgentMeter con tema oscuro" width="644"></p>

### Widget
<p align="center"><img src="./assets/screenshots/widget.png" alt="Widget Neon de AgentMeter con varias cuentas" width="640"></p>

### Strip
<p align="center"><img src="./assets/screenshots/strip.png" alt="Strip compacta de AgentMeter" width="500"></p>

Capturas reales de **AgentMeter**, no maquetas: Dashboard con su ancho predeterminado de 644 px y Widget al 100%. Las lecturas y los periodos disponibles dependen de las cuentas y sus planes; las capturas no representan cuotas fijas de ejemplo.

<a id="providers"></a>
## Proveedores compatibles

| Proveedor | Qué muestra cuando el proveedor lo reporta | Fuente necesaria |
|---|---|---|
| **Claude** | Sesión/5 horas, semanal y límites por modelo; plan y reinicios | Perfil de Claude Code con sesión iniciada |
| **Codex** | Sesión/5 horas y ventanas semanales o mensuales según plan/cuenta | Codex Desktop o un perfil autenticado de la CLI Codex |
| **Antigravity** | Grupos Gemini y Claude+GPT, con sus periodos de 5 horas/semanales | Antigravity IDE **o la CLI independiente `agy`**, autenticados y abiertos |
| **Grok** | Cuota de suscripción y desglose por producto cuando se reporta | Perfil autenticado de la CLI Grok Build |
| **Grok Bot** | Cuota semanal independiente | Aplicación de escritorio Grok Bot autenticada |

AgentMeter muestra los datos disponibles, sin inventar periodos ausentes. Si Codex solo reporta una cuota semanal, esta ocupa todo el área de cuotas. Widget oculta cuentas/proveedores sin lecturas utilizables; Inicio puede conservar tarjetas de configuración/error. Los proveedores ocultados explícitamente no se consultan.

<a id="installation"></a>
## Instalación y configuración de proveedores

1. Descarga un instalador disponible desde [GitHub Releases](https://github.com/carlos-mto/AgentMeter/releases), o [compila el código actual](#development). Si aún no hay un instalador disponible, compila desde el código fuente.
2. Ejecuta el instalador y abre **AgentMeter**. El código actual genera `AgentMeter_0.0.1_x64-setup.exe` y `agentmeter.exe`.
3. Configura los proveedores que utilizas. Cerrar el Dashboard deja la aplicación en la bandeja; **Salir (Quit)** la termina.

**Requiere Windows 10/11 y Microsoft Edge WebView2 Runtime.** Para compilar se necesitan también las herramientas indicadas más abajo. Las compilaciones actuales no tienen firma de código; utiliza archivos de una fuente confiable.

- **Claude:** instala Claude Code si hace falta, ejecuta `claude` e inicia sesión. La CLI no necesita permanecer abierta para las consultas normales.
- **Codex:** inicia sesión en Codex Desktop para la cuenta actual, o utiliza **Servicios → Cuentas → Iniciar sesión (Services → Accounts → Sign in)** para un perfil CLI independiente. La CLI oficial `codex` es necesaria para ese botón y **Abrir CLI (Open CLI)**.
- **Antigravity:** deja abierta una sesión autenticada del IDE o de `agy`. AgentMeter descubre su servidor local en `127.0.0.1`; no hay que configurar puertos/tokens. Con `agy` no necesitas el IDE. Si ambos están abiertos, se prefiere el IDE. Sin ninguno abierto, pueden conservarse en caché hasta 24 horas los periodos que aún no hayan caducado.
- **Grok Bot:** instala la [aplicación de escritorio](https://docs.x.ai/grok-bot/get-started) e inicia sesión. Su cuota es independiente de Grok/SuperGrok. Vuelve a abrirla cuando AgentMeter pida datos de sesión renovados.
- **Grok:** instala Grok Build e inicia sesión una vez. Vuelve a abrirlo cuando AgentMeter pida datos de sesión renovados.

Los modelos Gemini se mantienen dentro de **las cuotas de Antigravity**, no como un proveedor independiente.

<a id="dashboard"></a>
## Navegación del Dashboard

La ventana abre a **644 × 840 píxeles lógicos**. Se puede redimensionar hasta un mínimo de **380 × 520**, con tarjetas adaptables y una **barra lateral de iconos de 68 px**. Al pasar el cursor se muestra el nombre traducido; los accesos a tema e idioma están cerca de la parte inferior.

| Página | Función |
|---|---|
| **Inicio (Home)** | Tarjetas por proveedor/cuenta, periodos reales, plan/estado, reinicios, ritmo y desgloses. Actualización manual y controles de visibilidad. |
| **Servicios (Services)** | Único lugar para gestionar cuentas, seleccionar la cuenta de Strip, mostrar/ocultar proveedores y consultar estado e instrucciones de configuración. |
| **Estadísticas (Statistics)** | Tabla de la instantánea actual de cuotas, valores usados/restantes y caché, respetando la visibilidad de proveedores/grupos. Sin consultas adicionales, gráficos históricos ni promedios entre cuotas diferentes. |
| **Configuración (Settings)** | Apariencia global, accesos de idioma y usado/restante; las cuentas están en Servicios, no duplicadas aquí. |

El **botón del ojo Claude+GPT de Antigravity** oculta/restaura ese grupo en todas las vistas. Al ocultarlo, Widget/Strip utilizan las ventanas Gemini **5h / 7d**. No cambia las consultas ni los datos originales.

<a id="accounts"></a>
## Múltiples cuentas de Claude y Codex

1. Abre **Servicios → Cuentas (Services → Accounts)**. Las cuentas se agrupan por proveedor.
2. Elige Claude o Codex y pulsa **Agregar cuenta (Add account)**; la cuenta muestra el usuario de sus credenciales tras iniciar sesión (hasta entonces se numera, p. ej. "Cuenta 2").
3. Deja vacío el directorio para crear un perfil aislado, o indica un **directorio de configuración absoluto** existente, no un archivo de credenciales.
4. Utiliza **Iniciar sesión (Sign in)** para autenticarte mediante la CLI oficial. AgentMeter no copia credenciales entre perfiles.

| Acción / comportamiento | Qué hace |
|---|---|
| **Abrir CLI (Open CLI)** | Abre una terminal nueva con `CLAUDE_CONFIG_DIR` o `CODEX_HOME` solo para ese perfil; no cambia terminales existentes ni el entorno global. |
| **Comprobar cuentas (Check accounts)** | Comprueba perfiles habilitados respetando las esperas y reglas de consulta. Claude conserva un intervalo mínimo de seis minutos y la pausa por inactividad/bloqueo. |
| **Seleccionada para Strip (Selected for Strip)** | Elige una cuenta por proveedor para Strip, sin ocultar las demás en Inicio/Estadísticas/Widget. |
| **Quitar (Remove)** | Olvida el perfil pero conserva sus archivos y sesiones abiertas. |
| **Cuenta actual (Current account)** | Perfil implícito que respeta las variables de entorno existentes o `~/.claude` / `~/.codex`; no se puede quitar. |

Cada perfil tiene cuotas, caché y reintentos independientes. Se prioriza el nombre de usuario disponible localmente frente al alias; Widget lo muestra más pequeño y en minúsculas. No se muestran ni guardan dominios de correo o tokens en el registro de perfiles. Ocultar un proveedor pausa todas sus cuentas. El botón **Cuentas (Accounts)** del Widget abre Servicios directamente.

La gestión multicuenta cubre actualmente **solo Claude y Codex**. Los demás proveedores mantienen su comportamiento de una sola cuenta; no existe rotación automática.

<a id="widget-strip"></a>
## Widget y Strip

Selecciona una vista desde los botones laterales o el menú de bandeja.

### Widget

- Sin marco, transparente y siempre encima, con el icono de medidor de AgentMeter y diseño Neon.
- Muestra todas las cuentas utilizables de Claude/Codex, anillos de porcentaje, barras de sesión y columnas **5h / 7d** alineadas. Las cuentas con solo cuota semanal dejan vacío 5h; el tiempo hasta el reinicio aparece debajo.
- Oculta entradas sin configuración o lecturas utilizables; vuelven a aparecer cuando hay datos. Las filas adicionales tienen desplazamiento interno.
- Arrastra el encabezado para moverlo; el bloqueo impide movimientos accidentales.
- **− / +** ajusta entre **100–300%**, en pasos del **25%**. Se guarda el valor y se aplica también el escalado DPI de Windows.
- **Cuentas (Accounts)** abre Servicios; **Abrir Dashboard (Open dashboard)** muestra los detalles sin ocultar el Widget.

### Strip

- Barra horizontal compacta con una cuenta seleccionada de Claude/Codex por proveedor, nombres abreviados y porcentajes/tooltip de reinicio.
- Como el Widget, oculta los proveedores cuya cuenta seleccionada aún no tiene una lectura utilizable (sin configurar, no disponible, con errores o que requieren iniciar sesión); consulta esos estados en el Dashboard.
- Mantiene su escala compacta, independientemente de la ampliación del Widget.
- Se arrastra fuera de sus controles. Activa el botón con forma de pin para mantenerla encima de una barra de tareas y colócala en una zona libre de esa barra.
- No reserva espacio de trabajo. La superposición se aparta cuando la barra se oculta automáticamente o hay otra aplicación a pantalla completa.

Widget y Strip recuerdan **posiciones separadas**. **Abrir Dashboard** conserva la visibilidad y la fijación; **Ocultar (Hide)** o desmarcar la opción de bandeja oculta la vista. Ambas reutilizan los datos del Dashboard sin hacer consultas adicionales.

<a id="tray"></a>
## Bandeja e inicio con Windows

El clic izquierdo en el icono de bandeja alterna la visibilidad del Dashboard. El clic derecho ofrece **Abrir Dashboard**, **Mostrar Widget**, **Mostrar Strip**, **Bloquear posición**, **Iniciar con Windows (Launch at startup)** y **Salir**.

Activa **Iniciar con Windows** si lo deseas, y selecciona Widget o Strip antes de salir si quieres que esa vista vuelva al iniciar sesión. El arranque usa `--hidden`: no abre el Dashboard y restaura el modo, escala y posición guardados con reintentos mientras se inicializan escritorio/monitores. Si no hay una vista de escritorio habilitada, es normal que solo aparezca el icono de bandeja.

<a id="appearance"></a>
## Apariencia e idioma

- **Tema:** claro y oscuro; sigue el sistema hasta seleccionar uno explícitamente. Widget conserva su estilo Neon y transparencia, sin atenuar texto o controles.
- **Dirección de cuota:** elige **Usado (Used)** o **Restante (Remaining)** para Dashboard, Estadísticas, Widget y Strip.
- **Idiomas de interfaz:** **English, Español, Português, Italiano y Deutsch**. Cambia **Idioma (Language)** arriba a la derecha o con el acceso lateral/de Configuración. Se recuerda y también actualiza la bandeja.
- Al primer inicio se detecta un idioma de Windows compatible; si no lo es, se utiliza inglés. Los nombres de proveedores y diagnósticos técnicos originales no se traducen.

La documentación está en inglés, español, portugués, italiano, alemán y chino tradicional; disponer de un README chino **no** significa que la interfaz china esté implementada actualmente.

<a id="privacy"></a>
## Privacidad, datos locales y compatibilidad de marca

Sin telemetría, analítica ni cuenta de AgentMeter en la nube. Las consultas contactan a los proveedores utilizando sesiones locales compatibles; no existe un servicio de subida/sincronización de AgentMeter.

- AgentMeter lee las credenciales de acceso locales necesarias para consultar cuotas, pero no utiliza los refresh tokens de los proveedores. Tras un `401` de Claude, solicita recuperación mediante `claude update` y vuelve a leer el access token; ese comando puede actualizar Claude Code.
- Antigravity se consulta mediante el servidor local del IDE/`agy`, sin gestionar una sesión de Google.
- El access token de corta duración de Grok Bot se desbloquea localmente con Windows DPAPI para la consulta; AgentMeter no descifra, usa, guarda en caché ni envía su refresh token.
- Agregar un perfil no copia credenciales y quitarlo no elimina sus archivos.

La carpeta de datos es **`%LOCALAPPDATA%\stackly-agent-manager`**. Los directorios externos de las CLI no cambian:


| Ubicación / identidad | Uso |
|---|---|
| `accounts.json` | Alias, rutas de configuración y selección para Strip, no credenciales. |
| `accounts/<provider>/<id>` | Directorios por defecto para perfiles aislados; las CLI oficiales gestionan sus sesiones. |
| `widget.json` | Preferencias de vista/idioma y posiciones guardadas. |
| `provider-cache` | Instantáneas de cuota/reintentos y diagnósticos acotados. |

<a id="troubleshooting"></a>
## Solución de problemas

| Problema | Qué comprobar |
|---|---|
| Falta un proveedor/cuenta en Widget | Habilita el proveedor en Servicios e inicia sesión. Widget necesita lecturas utilizables; Inicio puede mostrar configuración/error. |
| Widget/Strip no vuelve al iniciar sesión | Activa **Iniciar con Windows** y guarda el modo de vista deseado, no solo Dashboard. Espera la recuperación de escritorio/monitores; abre la vista desde la bandeja si hace falta. |
| Grok ausente o pide iniciar sesión | Instala/abre Grok Build, inicia sesión y actualiza la tarjeta. AgentMeter no renueva por sí mismo el token de la CLI. |
| Claude limitado por el servidor | Respeta la cuenta atrás. Actualizar o **Comprobar cuentas** no salta las esperas del servidor; reiniciar tampoco las borra. |
| Claude no actualiza con Windows inactivo/bloqueado | Pausa intencionada; al volver se retrasa la consulta para evitar una ráfaga de peticiones. Siguen aplicándose las esperas existentes. |
| Claude rechaza el access token | Se intenta recuperar con la CLI oficial; si falla, abre Claude Code y revisa/inicia sesión. |
| Antigravity pide un cliente | Mantén abierto el IDE autenticado o una sesión de `agy`. Instalarlo o ejecutar solo `agy --help` no basta. |
| Grok Bot pide iniciar sesión | Vuelve a abrir Grok Bot; AgentMeter leerá el access token renovado en una consulta posterior. |
| Windows avisa de editor desconocido | Las compilaciones no están firmadas; usa versiones confiables o compila el código. |

<a id="limitations"></a>
## Limitaciones

- **Solo Windows**; el proyecto no ofrece actualmente compilaciones compatibles para macOS/Linux.
- Las APIs de los proveedores no son públicas; sus formatos, planes y disponibilidad pueden cambiar por separado.
- Estadísticas muestra una instantánea actual, no un historial guardado, informe de facturación de tokens ni predicción.
- Los perfiles multicuenta son solo para Claude/Codex; no hay rotación automática.
- Hay una única ventana de vista de escritorio: puedes moverla entre monitores, pero Widget/Strip **no se duplica automáticamente en cada monitor/barra de tareas**.
- La caché se identifica explícitamente y no garantiza una cuota en tiempo real.

<a id="development"></a>
## Compilar y probar desde el código

### Requisitos

- Windows 10/11 y WebView2 Runtime.
- **Node.js 22+** y npm, también para las pruebas nativas opcionales.
- **Rust estable** con la toolchain MSVC para Windows.
- Visual Studio / Build Tools con **Desarrollo para el escritorio con C++** y Windows SDK 10/11.

Desde la raíz del repositorio:

```powershell
npm ci
npm run tauri -- dev
```

Generar el instalador de Windows:

```powershell
npm run tauri -- build --bundles nsis -- --locked
```

Salidas para 0.0.1:

```text
src-tauri/target/release/agentmeter.exe
src-tauri/target/release/bundle/nsis/AgentMeter_0.0.1_x64-setup.exe
```

Publicación: `npm run release` (o `pwsh scripts/release.ps1 -DryRun` para ensayar) ejecuta las pruebas, genera el instalador NSIS, crea la etiqueta `v<versión>` y publica el GitHub Release con el instalador y su SHA-256. Requiere `gh auth login`.

Ejecutar pruebas automáticas:

```powershell
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

Las pruebas nativas opcionales de [Dashboard](./tests/smoke/dashboard.smoke.mjs) y [cuentas](./tests/smoke/accounts.smoke.mjs) requieren **CDP temporal limitado a loopback**; no es necesario para usar la aplicación y no debe dejarse habilitado. Consulta la [arquitectura](./docs/architecture.md) para detalles de implementación, políticas de consulta e integración nativa.

<a id="project"></a>
## Proyecto y licencia

- [Arquitectura](./docs/architecture.md)
- [Arquitectura Tauri + Rust + Windows](./docs/tauri-rust-windows-architecture.md)
- [Reportar un problema](https://github.com/carlos-mto/AgentMeter/issues)
- Inspirado en varios proyectos y herramientas de la comunidad.

Distribuido bajo la [licencia MIT](./LICENSE).
