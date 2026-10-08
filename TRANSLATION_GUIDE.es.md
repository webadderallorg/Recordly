Idioma: [EN](TRANSLATION_GUIDE.md) | Español

# Guía de traducción

Este proyecto utiliza una configuración de internacionalización (i18n) basada en espacios de nombres, para que los colaboradores puedan traducir la aplicación de forma segura sin cambiar su lógica.

## Archivos de idioma

Todos los archivos de idioma se encuentran en:

- `src/i18n/locales/en/`
- `src/i18n/locales/es/`
- `src/i18n/locales/fr/`
- `src/i18n/locales/de/`
- `src/i18n/locales/it/`
- `src/i18n/locales/nl/`
- `src/i18n/locales/ko/`
- `src/i18n/locales/pt-BR/`
- `src/i18n/locales/zh-CN/`
- `src/i18n/locales/zh-TW/`

Cada idioma tiene los mismos archivos de espacios de nombres:

- `common.json`
- `launch.json`
- `editor.json`
- `timeline.json`
- `settings.json`
- `dialogs.json`
- `shortcuts.json`

El inglés (`en`) es la referencia para la estructura de las claves.

## Reglas para las claves

- Mantén las mismas rutas de claves en todos los idiomas.
- No cambies el nombre de las claves existentes, salvo que se haga de forma coordinada con cambios en el código.
- Agrega las claves nuevas primero a `en` y después replícalas en todos los demás idiomas.
- Prefiere claves descriptivas y estables. Por ejemplo: `app.editorTitle`.
- Se admite interpolación mediante marcadores como `{{name}}`.

## Cómo se obtiene una traducción

- Las claves con un prefijo de espacio de nombres, como `settings.export.title`, utilizan ese espacio de nombres.
- Las claves sin un espacio de nombres explícito utilizan `common` de forma predeterminada.
- Si falta una traducción, se utiliza primero el inglés, después el texto alternativo proporcionado y, por último, la propia clave.

## Validación de la estructura de los idiomas

Ejecuta:

```bash
npm run i18n:check
```

Esto comprueba:

- Archivos de espacios de nombres que faltan
- Claves que faltan respecto de `en`
- Claves adicionales que no existen en `en`

## Flujo de trabajo para colaboradores

1. Obtén la versión más reciente de `main`.
2. Actualiza `en/<namespace>.json` con las claves nuevas, si es necesario.
3. Agrega las mismas claves a los archivos de los otros idiomas.
4. Ejecuta `npm run i18n:check`.
5. Ejecuta la aplicación localmente (`npm run dev`) y revisa algunos textos de la interfaz.
6. Abre un PR con un resumen breve de los espacios de nombres modificados.

## Notas sobre el alcance

La estructura actual cubre toda la aplicación y está preparada para una localización completa.
Todavía no se han migrado todos los textos de la interfaz. La migración debe hacerse de forma gradual por espacio de nombres, para que los PR sean fáciles de revisar y de bajo riesgo.
