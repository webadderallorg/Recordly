Idioma: [EN](README.md) | [简中](README.zh-CN.md) | Español

<p align="center">
  <img width="220" alt="Logotipo de Recordly" src="https://github.com/user-attachments/assets/414b8838-6731-45d4-a815-6e3c0aa1fe52" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-111827?style=for-the-badge" alt="macOS Windows Linux" />
  <img src="https://img.shields.io/badge/open%20source-AGPL3.0-2563eb?style=for-the-badge" alt="Licencia AGPL 3.0" />
</p>

### Crea videos de demostración con un acabado profesional en minutos
[Recordly](https://www.recordly.dev) es un **grabador de pantalla de código abierto** y un editor para crear **tutoriales, demostraciones, videos de productos** y mucho más.
**Se aceptan pull requests (PR).**

<img width="1280" height="720" alt="Exportación de MP4 a GIF (4)" src="https://github.com/user-attachments/assets/e6d68606-5fc0-4f70-99cd-7521982dc13b" />

---

### Con el apoyo de la comunidad
<a href="https://coderabbit.link/recordly"><img width="400" alt="Logotipo de CodeRabbit" src="https://github.com/user-attachments/assets/3926ecfd-8652-4f2d-8da8-ac7641017cf5" /></a>

---

## ¿Qué es Recordly?

Recordly es una aplicación de escritorio para grabar y editar capturas de pantalla, con herramientas integradas para presentar contenido mediante efectos de movimiento. En lugar de enviar el material sin editar a un especialista en animación solo para agregar zoom, mejorar el cursor o diseñar un fondo, Recordly permite completar ese flujo de trabajo en un solo lugar y de forma gratuita.

Recordly funciona en:

- **macOS** 14.0+
- **Windows** 10, compilación 19041+
- **Linux**, en distribuciones modernas

Notas por plataforma:

- **macOS** utiliza programas auxiliares de captura nativos basados en ScreenCaptureKit.
- **Windows** utiliza un programa auxiliar nativo de Windows Graphics Capture (WGC) en las compilaciones compatibles, con soporte nativo de audio WASAPI.
- **Linux** graba mediante las API de captura de Electron. Actualmente no se puede ocultar el cursor en Linux.

---

# Funciones principales

## Zoom automático, mejoras del cursor y marcos personalizados
Recordly puede destacar automáticamente la actividad con sugerencias de zoom, suavizar el movimiento del cursor, agregar efectos de movimiento y colocar la composición final dentro de un marco con fondos de pantalla, colores, degradados, desenfoque, márgenes internos y sombras.

<p>
  <img src="./docs/media/feature1.gif" width="450" alt="Video de demostración del cursor y el zoom de Recordly">
</p>

## Superposición dinámica de la cámara web en una burbuja
Agrega una grabación de la cámara web como una burbuja superpuesta, ubícala mediante posiciones predefinidas o coordenadas personalizadas, aplica un efecto espejo y ajusta la sombra y la redondez. También puedes hacer que reaccione al zoom para mantener el equilibrio visual durante el movimiento.

<p>
  <img src="./docs/media/feature2.gif" width="450" alt="Video de demostración de la superposición de cámara web de Recordly">
</p>

## Edición en la línea de tiempo pensada para demostraciones
Utiliza herramientas de arrastrar y soltar en la línea de tiempo para ajustar el zoom, eliminar segmentos, cambiar la velocidad, agregar anotaciones y regiones de audio adicionales, y editar teniendo en cuenta el recorte del encuadre. Guarda y vuelve a abrir tu trabajo como archivos de proyecto `.recordly`.

<p>
  <img width="450" alt="Editor de la línea de tiempo" src="https://github.com/user-attachments/assets/3692bd8f-7b8d-4a93-b696-d17c828487ea" />
</p>

## Extensiones y Marketplace

Recordly cuenta con un sistema de extensiones impulsado por la comunidad. Cualquier persona puede crear y publicar extensiones que agreguen nuevas funciones: sonidos de clic del cursor, marcos de dispositivos, maquetas de navegadores, fondos de pantalla, puntos de integración con el renderizado, paneles de configuración y mucho más.

Explora e instala extensiones de la comunidad desde el [Marketplace de Recordly](https://marketplace.recordly.dev/extensions).

Si el Marketplace no está disponible, consulta la [guía de extensiones en español](EXTENSIONS.es.md).

---

## Todas las funciones

### Grabación

- Graba una pantalla completa o una sola ventana de aplicación
- Pasa directamente de la grabación al editor
- Captura el audio del micrófono y del sistema
- Utiliza sistemas de captura nativos donde estén disponibles
- Continúa la edición desde archivos de proyecto `.recordly` guardados
- Abre grabaciones o archivos de proyecto existentes desde la aplicación

### Línea de tiempo y edición

- Edita en la línea de tiempo con arrastrar y soltar
- Elimina los segmentos que no necesitas
- Agrega regiones de zoom manualmente
- Utiliza sugerencias de zoom automático basadas en la actividad del cursor
- Agrega regiones de aceleración y cámara lenta
- Agrega anotaciones de texto, imágenes y figuras
- Agrega regiones de audio adicionales en la línea de tiempo
- Recorta el encuadre de la grabación
- Guarda y vuelve a abrir proyectos conservando el estado del editor

### Controles del cursor

- Muestra u oculta la capa superpuesta del cursor renderizado
- Ajusta el tamaño del cursor
- Suaviza el movimiento del cursor
- Aplica desenfoque de movimiento al cursor
- Agrega un efecto de rebote al hacer clic
- Agrega un efecto de balanceo al cursor
- Utiliza el modo de bucle del cursor para exportaciones en bucle más fluidas
- Utiliza recursos de cursor con estilo macOS para la capa superpuesta renderizada

### Superposición de la cámara web

- Activa o desactiva la grabación superpuesta de la cámara web
- Carga, reemplaza o elimina la grabación de la cámara web
- Aplica un efecto espejo a la imagen de la cámara web
- Ajusta el tamaño
- Utiliza posiciones predefinidas o coordenadas X/Y personalizadas
- Ajusta los márgenes
- Ajusta la redondez
- Ajusta la sombra
- Activa opcionalmente el cambio de tamaño de la cámara web en respuesta al zoom

### Estilo del marco y fondos

- Fondos de pantalla incluidos
- Detección de fondos de pantalla en tiempo de ejecución desde el directorio de fondos
- Carga de fondos personalizados
- Fondos de color sólido
- Fondos degradados
- Márgenes internos del marco
- Esquinas redondeadas
- Desenfoque del fondo
- Sombras proyectadas
- Relaciones de aspecto predefinidas para el encuadre final

### Exportación

- Exportación a MP4
- Exportación a GIF
- Selección de la calidad de exportación
- Selección de la tasa de fotogramas del GIF
- Activación o desactivación del bucle del GIF
- Tamaños predefinidos para GIF
- Controles de relación de aspecto y dimensiones de salida
- Localización de los archivos exportados en el administrador de archivos del sistema

### Flujo de trabajo y facilidad de uso

- Atajos de teclado personalizables
- Referencia de atajos dentro de la aplicación
- Enlaces para enviar comentarios y reportar problemas desde el editor
- Conservación de las preferencias del editor en el proyecto
- Recuperación más rápida de la vista previa después de exportar

---

# Capturas de pantalla

<p align="center">
  <img src="https://i.postimg.cc/8CrQtGJf/Screenshot-2026-04-30-at-5-11-52-pm.png" width="700" alt="Captura de la interfaz de grabación de Recordly">
</p>

<p align="center">
  <img src="https://i.postimg.cc/pLSMfrTM/Screenshot-2026-04-30-at-5-11-45-pm.png" width="700" alt="Captura del editor de Recordly">
</p>

<p align="center">
  <img src="https://i.postimg.cc/Zn9VY6bg/Screenshot-2026-03-18-at-6-32-59-pm.png" width="700" alt="Captura de la línea de tiempo de Recordly">
</p>

---

# Instalación

## Descarga una versión compilada

Las versiones ya compiladas están disponibles en:

https://github.com/webadderallorg/Recordly/releases

---

## Arch Linux / Manjaro (yay)

Instala desde AUR ([recordly-bin](https://aur.archlinux.org/packages/recordly-bin)):

```bash
yay -S recordly-bin
```

PKGBUILD, el archivo de entrada de escritorio, la sincronización de versiones y el empaquetado opcional **desde el código fuente local** se mantienen en **[recordly-aur](https://github.com/firtoz/recordly-aur)**, para que este repositorio no tenga que encargarse del mantenimiento de las versiones de Arch. Consulta ese repositorio o la página del paquete en AUR para contactar al responsable y conocer cómo se actualiza el paquete.

---

## Compila desde el código fuente

### Requisitos previos

**macOS:** Xcode Command Line Tools (`xcode-select --install`).

**Linux (Ubuntu/Debian):**

```bash
sudo apt install build-essential cmake libx11-dev libxtst-dev libxrandr-dev libxt-dev
```

**Windows:** Visual Studio 2022 (o Build Tools), con la carga de trabajo de C++ y CMake.

### Pasos

```bash
git clone https://github.com/webadderallorg/Recordly.git recordly
cd recordly
npm install
npm run dev
```

Para generar versiones empaquetadas:

```bash
npm run build
```

También están disponibles comandos de compilación por plataforma:

- `npm run build:mac`
- `npm run build:win`
- `npm run build:linux`

---

## macOS: «No se puede abrir la aplicación» ("App cannot be opened")

macOS puede poner en cuarentena las aplicaciones compiladas localmente.

Elimina la marca de cuarentena con:

```bash
xattr -rd com.apple.quarantine /Applications/Recordly.app
```

---

# Requisitos del sistema

| Plataforma | Versión mínima | Notas |
|---|---|---|
| **macOS** | macOS 14.0 (Sonoma) | Necesaria para capturar el audio y el micrófono con ScreenCaptureKit. |
| **Windows** | Windows 10 20H1 (compilación 19041, mayo de 2020) | Necesaria para el programa auxiliar nativo de Windows Graphics Capture (WGC) y para obtener los mejores resultados al ocultar el cursor. |
| **Linux** | Cualquier distribución moderna | La grabación funciona mediante la captura de Electron. El audio del sistema generalmente requiere PipeWire. |

> [!IMPORTANT]
> En compilaciones de Windows anteriores a la 19041, la grabación puede funcionar mediante un método de captura alternativo, pero el cursor real del sistema operativo podría seguir apareciendo en las grabaciones.

---

# Uso

## Graba

1. Abre Recordly.
2. Selecciona una pantalla o ventana.
3. Elige las opciones del micrófono y del audio del sistema.
4. Inicia la grabación.
5. Detén la grabación para abrir el editor.

## Edita

Dentro del editor puedes:

- eliminar segmentos y agregar zoom, regiones de velocidad y anotaciones
- ajustar el comportamiento del cursor y el volumen de la vista previa
- personalizar el marco con fondos de pantalla, colores, degradados, desenfoque, márgenes internos y esquinas
- agregar o ajustar la grabación superpuesta de la cámara web
- agregar regiones de audio adicionales
- recortar el encuadre y elegir una relación de aspecto

Guarda tu trabajo en cualquier momento como un proyecto `.recordly`.

## Exporta

Las opciones de exportación incluyen:

- **MP4** para la salida de video estándar
- **GIF** para compartir archivos ligeros y animaciones en bucle

Antes de exportar, puedes ajustar las opciones de cada formato, como la calidad, la tasa de fotogramas del GIF, la reproducción en bucle y el tamaño de salida.

---

# Limitaciones

### Captura del cursor

Recordly renderiza una capa superpuesta con un cursor de acabado mejorado sobre la grabación. La posibilidad de ocultar el cursor de cada plataforma depende del soporte del sistema operativo.

**macOS**
- ScreenCaptureKit puede excluir el cursor real sin que aparezca en la grabación.

**Windows**
- Los mejores resultados requieren Windows 10, compilación 19041+, y el programa auxiliar de captura nativo.
- Las compilaciones anteriores recurren a la captura de Electron, por lo que el cursor real podría seguir siendo visible.

**Linux**
- La captura de escritorio de Electron actualmente no permite ocultar el cursor.
- Si también activas la capa superpuesta del cursor renderizado, las exportaciones podrían mostrar tanto el cursor real como el cursor personalizado.

### Audio del sistema

El soporte de audio del sistema varía según la plataforma.

**Windows**
- Soporte nativo de WASAPI

**Linux**
- Generalmente requiere PipeWire

**macOS**
- Requiere macOS 14.0+ y el flujo de trabajo basado en ScreenCaptureKit

---

# Cómo funciona

Recordly combina una capa de captura específica de cada plataforma con un editor y un proceso de exportación gestionados desde el renderizador.

**Captura**
- Electron coordina la grabación y el flujo de la aplicación
- macOS utiliza programas auxiliares nativos de ScreenCaptureKit
- Windows utiliza un programa auxiliar nativo de Windows Graphics Capture (WGC) y programas auxiliares de audio nativos cuando están disponibles

**Edición**
- Las regiones de la línea de tiempo definen el zoom, los segmentos que se eliminan, los cambios de velocidad, las superposiciones de audio y las anotaciones
- El estilo del cursor y de la cámara web se aplica en el estado del editor

**Renderizado**
- **PixiJS** se encarga de la composición de la escena

**Exportación**
- La misma lógica de escena utilizada en la vista previa se renderiza en la salida exportada a MP4 o GIF

**Proyectos**
- Los archivos `.recordly` guardan la ruta del contenido multimedia de origen y el estado del editor para poder volver a abrir el trabajo más adelante

---

# Contribuciones

Las contribuciones son bienvenidas.

Áreas donde la ayuda es especialmente útil:

- Captura y comportamiento del cursor en Linux
- Rendimiento y estabilidad de la exportación
- Mejoras de la interfaz y la experiencia de uso (UI y UX)
- Localización a otros idiomas
- Herramientas adicionales de edición y mejoras del flujo de trabajo

Mantén cada pull request centrado en su objetivo, prueba los flujos de grabación, edición y exportación, y evita refactorizaciones que no estén relacionadas.

Consulta las directrices en [CONTRIBUTING.es.md](CONTRIBUTING.es.md).

Documentación para colaboradores:

- [Guía de traducción](TRANSLATION_GUIDE.es.md)
- [Publicación de versiones](RELEASING.es.md)

---

# Comunidad

Reportes de errores y solicitudes de nuevas funciones:

https://github.com/webadderallorg/Recordly/issues

Los pull requests son bienvenidos.

---

# Reconocimiento a quienes nos apoyan

[![Ko-Fi](https://img.shields.io/badge/Ko--fi-F16061?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/webadderall)

- Tom Egan @tomegan en X
- Robin Ebers @robinebers en X
- Tadees
- buildwithfur
- piccinato
- Tobias
- Colaborador anónimo
- Tandava Appadoo
- Digitalfastmind
- Roberto Marcelino
- Tony
- Rajan RK
- Francesco
- Erwan
- Colaborador anónimo

---

# Licencia

Recordly se distribuye bajo la licencia **AGPL 3.0**.

Consulta también los [avisos de terceros](THIRD_PARTY_NOTICES.es.md).

---

# Créditos

## Agradecimientos

Recordly comenzó como un fork de [OpenScreen](https://github.com/siddharthvaddem/openscreen). Desde entonces, más del 80 % del código ha seguido un desarrollo distinto.
Muchas funciones de OpenScreen, como sus animaciones de zoom, se trasladaron directamente desde versiones tempranas de Recordly.

Creado por
[@webadderall](https://x.com/webadderall)

---
