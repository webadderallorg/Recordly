Idioma: [EN](EXTENSIONS.md) | Español

# API de extensiones de Recordly

La documentación completa, actualizada periódicamente, está disponible en el [Marketplace de Recordly](https://marketplace.recordly.dev/extensions). Si el sitio no está disponible, puedes consultar esta guía.

Las extensiones de Recordly se ejecutan en el renderizador del editor y utilizan una API de la aplicación anfitriona cuyo acceso depende de permisos. Pueden dibujar dentro del proceso de renderizado, reaccionar a eventos de reproducción y exportación, registrar efectos del cursor, agregar paneles de configuración y aportar recursos empaquetados, como marcos, fondos de pantalla y estilos de cursor.

## Inicio rápido

Para las extensiones instaladas localmente por el usuario, utiliza `Extensions -> Open Directory` (Extensiones → Abrir directorio) en la aplicación. Recordly las almacena en el directorio `userData/extensions` de la aplicación. Este repositorio también incluye paquetes de ejemplo instalables en `extension-examples/`.

### Extensión mínima

```text
my-extension/
  recordly-extension.json
  index.js
```

```json
{
  "id": "com.example.my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "description": "A short description",
  "author": "Your Name",
  "license": "MIT",
  "main": "index.js",
  "permissions": ["render"]
}
```

```js
export function activate(api) {
  api.log("Hello from my extension");
}

export function deactivate() {}
```

### TypeScript

Puedes crear extensiones en TypeScript. Importa el tipo `RecordlyExtensionAPI` desde `types.ts` en este repositorio para obtener autocompletado completo en el IDE y comprobaciones durante la compilación:

```ts
import type { RecordlyExtensionAPI } from "./types";

export function activate(api: RecordlyExtensionAPI) {
  api.registerRenderHook("final", (ctx) => {
    ctx.ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.ctx.fillRect(0, 0, ctx.width, 30);
  });
}

export function deactivate() {}
```

Recordly carga el punto de entrada `main` del manifiesto, que debe ser un archivo `.js`. Si utilizas TypeScript, compila o empaqueta el código como JavaScript antes de crear el paquete de la extensión. Un archivo `tsconfig.json` con `"module": "ESNext"` y `"target": "ESNext"` funciona bien, ya que las extensiones se ejecutan en un renderizador de Chromium.

### Capturas de pantalla en el manifiesto

Las extensiones pueden incluir `screenshots` en el manifiesto para mostrar imágenes de vista previa en el Marketplace:

```json
{
  "id": "com.example.my-extension",
  "screenshots": [
    "screenshots/preview-1.png",
    "screenshots/preview-2.png"
  ]
}
```

Las rutas son relativas a la raíz de la extensión. El Marketplace muestra las capturas en un carrusel, tanto en el cuadro de diálogo de detalles de la aplicación como en la página de detalles de la web.

## Manifiesto

`recordly-extension.json` se valida al cargar la extensión y al subir un archivo zip al Marketplace.

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `id` | `string` | Sí | Identificador único, por ejemplo `yourname.cool-effect` |
| `name` | `string` | Sí | Nombre legible que se muestra en la interfaz |
| `version` | `string` | Sí | Versión que cumple estrictamente el versionado semántico (semver), por ejemplo `1.0.0` |
| `description` | `string` | Sí | Resumen de una línea |
| `author` | `string` | No | Autor u organización |
| `homepage` | `string` | No | URL HTTPS del sitio web o del repositorio |
| `license` | `string` | No | Identificador de licencia SPDX |
| `engine` | `string` | No | Versión mínima compatible de Recordly |
| `icon` | `string` | No | Ruta relativa a un icono PNG |
| `screenshots` | `string[]` | No | Rutas relativas a las imágenes de vista previa que se muestran en el Marketplace |
| `main` | `string` | Sí | Ruta relativa al archivo JS que sirve como punto de entrada |
| `permissions` | `string[]` | Sí | Capacidades requeridas |
| `contributes` | `object` | No | Metadatos de los marcos, estilos de cursor, sonidos, fondos de pantalla y marcos de cámara web empaquetados |

Actualmente, `contributes` solo contiene metadatos. Recordly no registra automáticamente comportamientos en tiempo de ejecución desde el manifiesto. Utiliza `activate()` para llamar a API como `registerFrame()`, `registerWallpaper()`, `registerCursorStyle()`, `registerSettingsPanel()` y `playSound()`.

## Permisos

| Permiso | Concede acceso a |
|---------|------------------|
| `render` | Registro de hooks de renderizado |
| `cursor` | Telemetría del cursor y registro de efectos del cursor |
| `audio` | Reproducción de sonidos incluidos en el paquete |
| `timeline` | Eventos de reproducción y de la línea de tiempo |
| `ui` | Paneles de configuración y registro de marcos de dispositivos |
| `assets` | Resolución de recursos incluidos en el paquete y registro de fondos de pantalla y estilos de cursor |
| `export` | Eventos del ciclo de exportación |

## Proceso de renderizado

Los hooks de renderizado son puntos de integración que permiten dibujar en fases específicas utilizando `hookCtx.ctx`, un `CanvasRenderingContext2D`.

| Fase | Vista previa | Exportación | Notas |
|------|--------------|-------------|-------|
| `background` | Reservada | Reservada | Existe en la definición de tipos, pero todavía no se ejecuta |
| `post-video` | Sí | Sí | Se ejecuta dentro de la transformación de la escena |
| `post-zoom` | Sí | Sí | Se ejecuta dentro de la transformación de la escena |
| `post-cursor` | Sí | Sí | Se ejecuta dentro de la transformación de la escena |
| `post-webcam` | Sí | Sí | Se ejecuta después de la transformación integrada |
| `post-annotations` | Sí | Sí | Se ejecuta después de la transformación integrada |
| `final` | Sí | Sí | Última pasada para capas superpuestas de tipo HUD |

### Dentro y fuera de la transformación de la escena

- `post-video`, `post-zoom` y `post-cursor` ya siguen el zoom y el movimiento en la vista previa y en la exportación.
- `post-webcam`, `post-annotations` y `final` se ejecutan después de que Recordly restaura la transformación del lienzo. Aplica `sceneTransform` manualmente si quieres que esas capas superpuestas se muevan con la escena.

### RenderHookContext

```ts
{
  width: number;
  height: number;
  timeMs: number;
  durationMs: number;
  cursor: { cx: number; cy: number; interactionType?: string } | null;
  smoothedCursor?: {
    cx: number;
    cy: number;
    trail: Array<{ cx: number; cy: number }>;
  } | null;
  ctx: CanvasRenderingContext2D;
  videoLayout?: {
    maskRect: { x: number; y: number; width: number; height: number };
    borderRadius: number;
    padding: number;
  };
  zoom?: { scale: number; focusX: number; focusY: number; progress: number };
  sceneTransform?: { scale: number; x: number; y: number };
  shadow?: { enabled: boolean; intensity: number };
  getPixelColor(x: number, y: number): { r: number; g: number; b: number; a: number };
  getAverageSceneColor(): { r: number; g: number; b: number; a: number };
  getEdgeAverageColor(edgeWidth?: number): { r: number; g: number; b: number; a: number };
  getDominantColors(count?: number): Array<{ r: number; g: number; b: number; frequency: number }>;
}
```

Utiliza `videoLayout.maskRect` y `videoLayout.borderRadius` para calcular tamaños relativos a la escena. Así obtienes los bordes reales de la escena y esquinas redondeadas con la forma correcta, en lugar de capas superpuestas que abarcan todo el lienzo.

## Efectos del cursor

Las funciones de efectos del cursor se ejecutan en cada fotograma después de un clic, hasta que devuelven `false`.

```js
api.registerCursorEffect((ctx) => {
  const progress = ctx.elapsedMs / 400;
  if (progress >= 1) return false;

  const sceneWidth = ctx.videoLayout?.maskRect.width ?? ctx.width;
  const x = ctx.cx * ctx.width;
  const y = ctx.cy * ctx.height;
  const radius = sceneWidth * 0.03 * progress;

  ctx.ctx.beginPath();
  ctx.ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.ctx.stroke();
  return true;
});
```

`CursorEffectContext` ahora incluye `videoLayout`, `zoom` y `sceneTransform`, para que los efectos puedan ajustar su tamaño respecto de la escena en lugar de hacerlo respecto de todo el lienzo.

## Funciones de la API

### Registro

```js
api.registerRenderHook(phase, hook);
api.registerCursorEffect(effect);
api.registerFrame(frame);
api.registerWallpaper(wallpaper);
api.registerCursorStyle(cursorStyle);
api.registerSettingsPanel(panel);
api.on(event, handler);
```

Cada registro devuelve una función para eliminarlo y liberar sus recursos.

### Configuración

```js
api.getSetting(settingId);
api.setSetting(settingId, value);
api.onSettingChange((settingId, value) => {});
api.getAllSettings();
```

Los tipos de campo de configuración admitidos son `toggle`, `slider`, `select`, `color` y `text`.

### Recursos y audio

```js
api.resolveAsset("images/overlay.png");
api.playSound("sounds/click.mp3", { volume: 0.8 });
api.log("hello", payload);
```

### Consultas de solo lectura

```js
api.getVideoInfo();
api.getVideoLayout();
api.getCursorAt(timeMs);
api.getSmoothedCursor();
api.getZoomState();
api.getShadowConfig();
api.getKeystrokesInRange(startMs, endMs);
api.getAspectRatio();
api.getActiveFrame();
api.isExtensionActive(extensionId);
api.getPlaybackState();
api.getCanvasDimensions();
api.drawIcon(ctx, "Sparkle", 100, 100, 20, "#2563EB", "regular");
```

### Dibujar iconos

Las extensiones pueden dibujar iconos del conjunto Phosphor incluido en Recordly directamente sobre un contexto de lienzo:

```js
api.drawIcon(
  ctx,
  "ArrowClockwise", // nombre del icono en @phosphor-icons/react
  120,              // x (centro)
  80,               // y (centro)
  18,               // tamaño en píxeles
  "#ffffff",        // color
  "bold",           // grosor opcional: thin | light | regular | bold | fill
);
```

Esto resulta útil para capas superpuestas ligeras y evita tener que incluir tus propios recursos de iconos en el paquete.

## Paneles de configuración

```js
api.registerSettingsPanel({
  id: "my-settings",
  label: "My Extension",
  icon: "sparkles",
  parentSection: "cursor",
  fields: [
    { id: "enabled", label: "Enable", type: "toggle", defaultValue: true },
    { id: "size", label: "Size", type: "slider", defaultValue: 1, min: 0.1, max: 3, step: 0.1 },
    {
      id: "style",
      label: "Style",
      type: "select",
      defaultValue: "ripple",
      options: [{ label: "Ripple", value: "ripple" }, { label: "Pulse", value: "pulse" }],
    },
    { id: "color", label: "Color", type: "color", defaultValue: "#2563EB" },
  ],
});
```

Utiliza `parentSection` para ubicar tu panel dentro de un área existente, como `cursor` o `scene`.

## Eventos

| Evento | Permiso | Descripción |
|--------|---------|-------------|
| `playback:timeupdate` | `timeline` | Se emite en cada actualización de la reproducción |
| `playback:play` | `timeline` | La reproducción comenzó |
| `playback:pause` | `timeline` | La reproducción se pausó |
| `cursor:click` | `cursor` | Se detectó un clic del cursor |
| `cursor:move` | `cursor` | Se detectó un movimiento del cursor |
| `timeline:region-added` | `timeline` | Se agregó una región |
| `timeline:region-removed` | `timeline` | Se eliminó una región |
| `export:start` | `export` | La exportación comenzó |
| `export:frame` | `export` | Se renderizó un fotograma durante la exportación |
| `export:complete` | `export` | La exportación finalizó |

## Marcos, fondos de pantalla y estilos de cursor

- `registerFrame()` es la API de tiempo de ejecución para marcos de dispositivos. Utiliza una función `draw(ctx, width, height)` siempre que sea posible para obtener una salida independiente de la resolución.
- `registerWallpaper()` aporta fondos para la escena.
- `registerCursorStyle()` aporta paquetes de imágenes de cursor.
- Las tres utilizan archivos empaquetados con rutas relativas a la raíz de la extensión.

## Ciclo de vida

1. Descubrimiento: Recordly examina las extensiones integradas y el directorio de extensiones del usuario.
2. Activación: se ejecuta `activate(api)` y registras hooks, efectos, paneles y recursos.
3. Ejecución: las funciones registradas se ejecutan en la vista previa y en la exportación según su fase.
4. Desactivación: se ejecuta `deactivate()` y se eliminan automáticamente todos los registros.

## Ejemplos

- `extension-examples/webadderall.more-wallpapers` muestra un paquete de fondos de pantalla instalable por el usuario que registra 180 fondos incluidos mediante `registerWallpaper()`.
