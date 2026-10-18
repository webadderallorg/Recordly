Idioma: [EN](RELEASING.md) | Español

# Publicación de versiones de Recordly

Este repositorio utiliza `electron-builder` y `electron-updater` para las actualizaciones automáticas en macOS, Windows y Linux.

Para esta aplicación Electron, ese es el enfoque adecuado en lugar de integrar Sparkle.framework directamente. En macOS, `electron-updater` se encarga de los metadatos de publicación y del flujo de actualización que Sparkle cubriría en una aplicación nativa, y comparte el mismo proceso de GitHub Releases que utilizan Windows y Linux.

## Qué hace el flujo de publicación

Cuando publicas una versión de GitHub con una etiqueta como `v1.2.3`, `.github/workflows/release.yml`:

- valida que la versión de `package.json` también sea `1.2.3`
- compila artefactos firmados de macOS para x64 y arm64
- notariza las compilaciones de macOS
- combina los metadatos de ambas arquitecturas de `latest-mac.yml` en un único archivo de la versión
- compila y firma el instalador NSIS de Windows
- compila la AppImage de Linux
- publica los instaladores y los archivos de metadatos de actualización automática en la versión de GitHub
- inicia el flujo del tap de Homebrew después de que los archivos de la versión estén disponibles

La aplicación empaquetada consulta GitHub Releases para obtener:

- `latest-mac.yml`
- `latest.yml`
- `latest-linux.yml`

## Secretos de GitHub requeridos

### Firma y notarización de macOS

Configura estos secretos del repositorio:

- `APPLE_SIGNING_CERTIFICATE_P12_BASE64`
- `APPLE_SIGNING_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

`APPLE_SIGNING_CERTIFICATE_P12_BASE64` debe contener una exportación `.p12`, codificada en base64, de un certificado `Developer ID Application`.

Si el certificado que tienes es únicamente `Apple Development`, no es suficiente para publicar versiones notarizadas ni distribuir actualizaciones automáticas. Necesitas `Developer ID Application`.

Para exportar y codificar el certificado:

```bash
security export -k ~/Library/Keychains/login.keychain-db -t identities -f pkcs12 -P "YOUR_P12_PASSWORD" -o recordly-mac-signing.p12
base64 < recordly-mac-signing.p12 | pbcopy
```

Pega el contenido base64 copiado en `APPLE_SIGNING_CERTIFICATE_P12_BASE64` y la contraseña de exportación en `APPLE_SIGNING_CERTIFICATE_PASSWORD`.

### Firma de Windows

Configura estos secretos del repositorio:

- `WINDOWS_SIGNING_CERTIFICATE_P12_BASE64`
- `WINDOWS_SIGNING_CERTIFICATE_PASSWORD`

Estos valores deben corresponder a un certificado de firma de código Authenticode exportado como `.p12` y después codificado en base64.

### Automatización del tap de Homebrew

Configura este secreto del repositorio si quieres que el PR del cask se abra automáticamente:

- `HOMEBREW_TAP_TOKEN`

Variables opcionales del repositorio:

- `HOMEBREW_TAP_REPO`
- `HOMEBREW_TAP_AUTO_MERGE`

## Flujo de publicación

1. Actualiza `package.json` con la versión que quieres publicar.
2. Crea un commit con esa versión y súbelo al repositorio.
3. Crea una etiqueta de Git con el formato `vX.Y.Z`.
4. Crea y publica una versión de GitHub para esa etiqueta. Utiliza preferentemente el comando auxiliar, para que las notas personalizadas aparezcan al principio y GitHub siga generando la sección de colaboradores:

```bash
npm run release:create -- --tag v1.2.3 --title "v1.2.3" --notes-file ./release-notes.md
```

Para versiones preliminares:

```bash
npm run release:create -- --tag v1.2.0-beta.2 --title "v1.2.0 beta-2" --prerelease --notes-file ./release-notes.md
```

Esto utiliza `gh release create --generate-notes`, que conserva el resumen de cambios y la lista de colaboradores generados por GitHub, en lugar de reemplazarlos por una descripción de la versión escrita completamente a mano.

5. El flujo `Publish Release` compila, firma, notariza, sube los archivos y publica los metadatos de actualización.

Este es el procedimiento habitual si quieres «crear una versión nueva y dejar que la integración continua (CI) se encargue del resto».

## Reconstrucción de una versión existente

Si necesitas repetir la publicación de una etiqueta existente, ejecuta manualmente `.github/workflows/release.yml` e indica esa etiqueta.

## Notas

- Las actualizaciones automáticas de macOS requieren el formato `zip` además de `dmg`, porque `latest-mac.yml` se genera a partir de la compilación comprimida en zip.
- Las compilaciones de macOS para arm64 y x64 publican archivos zip para el actualizador, y el flujo de publicación los combina en un único `latest-mac.yml`, para que `electron-updater` pueda elegir automáticamente la arquitectura correcta.
- El flujo de publicación utiliza nombres de artefactos que incluyen la versión, para que los metadatos de actualización generados coincidan con los archivos subidos.
- `build.yml` utiliza deliberadamente `--publish never`, para que las compilaciones ocasionales de CI no suban archivos por accidente a una versión en borrador.
