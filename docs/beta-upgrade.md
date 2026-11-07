# Trying Recordly 2.0 beta safely

Before installing the beta, quit Recordly and back up your projects, their original media, and your Recordly settings. Keep the v1.4 installer if you may need to return to it.

A `.recordly` project references media files on disk; it does not contain them. Include the screen recording, webcam recording, imported audio, and any accompanying audio, cursor, or session files in your backup. Preserve their folder locations, or retain a backup that can be restored to those locations. Include a custom recordings folder if you chose one.

The default settings and recordings folder is:

- macOS: `~/Library/Application Support/Recordly/`
- Windows: `%APPDATA%\Recordly\`
- Linux: `~/.config/Recordly/` (or `$XDG_CONFIG_HOME/Recordly/` if configured)

Copy the whole folder while Recordly is closed. Keep that backup outside the folder the beta will use. Also back up projects and media stored elsewhere.

## Open a v1.4 project in the beta

1. Open the existing project and check its clip timing, audio, webcam, captions, and effects.
2. Before making edits, choose **File → Save Project As…** (⌘⇧S on macOS; Ctrl+Shift+S on Windows/Linux) and save the beta copy under a new name, separate from the original v1.4 project. Keep the original unchanged.
3. Edit and export the beta copy. Check the exported video before relying on it for important work.

The beta changes how clip timing is stored. Both versions can label a project as schema version 2; that number does not mean a beta-saved project is safe to reopen in v1.4. In particular, v1.4 ignores the beta's `sourceStartMs` field, which can make a clip use a different part of the source recording. Keep using the beta for beta-saved copies.

## Return to v1.4

1. Quit the beta and keep a separate copy of any beta projects or recordings you want to retain.
2. Reinstall your trusted v1.4 installer.
3. Restore the settings backup while Recordly is closed, then open the original v1.4 project with its original media.

Do not overwrite your original project with a beta-saved copy or expect v1.4 to preserve beta edits. An automatic downgrade or a settings backup alone does not convert beta projects back to v1.4.
