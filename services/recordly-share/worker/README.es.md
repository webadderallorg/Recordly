Idioma: [EN](README.md) | Español

# Recordly Share

Recordly Share es el servicio de publicación y revisión de videos que utiliza Recordly y que puedes alojar en tu propia infraestructura. Se ejecuta como un Cloudflare Worker con almacenamiento de videos en R2, metadatos en D1, transmisión por rangos, un visor adaptable a distintos tamaños de pantalla, comentarios con marcas de tiempo, reacciones, contraseñas, vencimiento y una biblioteca privada de grabaciones.

## Desarrollo local

```sh
cp .dev.vars.example .dev.vars
npm install
npm --prefix web install
npm --prefix web run build
npm run dev
```

Configura `OWNER_USER_ID` con el ID de usuario de Supabase del propietario del despliegue. Solo ese usuario puede administrar esta biblioteca de un único propietario. En `.dev.vars`, configura `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` con la misma configuración pública del proyecto que utiliza la aplicación de escritorio. Recordly envía el token de acceso del usuario que inició sesión al publicar en:

- Endpoint: `http://localhost:8787/api/upload`

El Worker valida los tokens de acceso de Supabase para las cargas. En instalaciones autoalojadas, las solicitudes `POST /api/upload` también pueden autenticarse con una cookie de sesión válida del panel (`voom_session`), sin un token de acceso de Supabase. `API_SECRET` sigue siendo una contraseña del servidor para administrar la biblioteca. Solo para pruebas locales aisladas se puede habilitar una alternativa de carga mediante ese secreto, configurando `ALLOW_API_SECRET_UPLOADS=true`; no la habilites en producción.

Cualquier persona con un enlace válido puede ver el video y dejar comentarios con marcas de tiempo utilizando un nombre visible; no se requiere una cuenta para comentar. Se mantienen activos los límites de frecuencia por IP y los límites de longitud de los comentarios.

## Despliegue

```sh
npm install
npm --prefix web install
npm --prefix web run build
npx wrangler secret put API_SECRET
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npm run deploy
```

Configura `SUPABASE_URL` como una variable del Worker. La configuración sin identificadores aprovisiona `recordly-share-db` y `recordly-videos` para un despliegue nuevo. Actualmente, las compilaciones de escritorio solo realizan cargas a localhost; la integración del servicio en producción queda pendiente.

## Atribución

Este servicio es una adaptación de un proyecto de código abierto con licencia MIT. El aviso original de derechos de autor y permisos requerido se conserva en [`../LICENSE`](../LICENSE) y en los [avisos de terceros en español](../../../THIRD_PARTY_NOTICES.es.md), que incluyen el texto original de la licencia. Las páginas del producto utilizan la marca Recordly; la atribución legal debe mantenerse en las copias distribuidas.

## Organización del código fuente del Worker

`src/index.js` contiene los puntos de entrada de solicitudes y tareas programadas, así como los límites de manejo de errores. `router.js` dirige las solicitudes y aplica las comprobaciones de acceso a las rutas. La implementación se organiza en módulos específicos:

- `schema.js`: inicialización de la base de datos y migraciones.
- `auth.js` y `accounts.js`: acceso del propietario y al panel, contraseñas de videos y cuentas opcionales de espectadores.
- `uploads.js`: creación de cargas, transferencias multipartes y metadatos.
- `media.js`: transmisión, subtítulos, datos compartidos y vistas previas para redes sociales.
- `feedback.js`: comentarios y reacciones.
- `library.js`: listado, renovación, eliminación, conteo de visualizaciones y limpieza de contenido vencido.
- `crypto.js`, `http.js` y `video.js`: funciones auxiliares compartidas para criptografía, respuestas y metadatos de videos.

Ejecuta `npm test` en este directorio para probar estos módulos mediante los endpoints del Worker y las migraciones de la base de datos.
