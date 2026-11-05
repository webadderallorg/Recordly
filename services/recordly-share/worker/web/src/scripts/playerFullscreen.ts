export type FullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};

type FullscreenShell = HTMLElement & { webkitRequestFullscreen?: () => void | Promise<void> };
type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element;
  webkitExitFullscreen?: () => void | Promise<void>;
};

// Keep the initial request in the button's user activation, including on iPhone.
export async function togglePlayerFullscreen(shell: FullscreenShell, video: FullscreenVideo) {
  const doc = shell.ownerDocument as FullscreenDocument;
  if (doc.fullscreenElement) return doc.exitFullscreen();
  if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) return doc.webkitExitFullscreen();
  if (video.webkitDisplayingFullscreen && video.webkitExitFullscreen) return video.webkitExitFullscreen();
  if (shell.requestFullscreen && doc.fullscreenEnabled !== false) {
    try {
      await shell.requestFullscreen();
      return;
    } catch (error) {
      if (!video.webkitEnterFullscreen) throw error;
    }
  } else if (shell.webkitRequestFullscreen) {
    try {
      await shell.webkitRequestFullscreen();
      return;
    } catch (error) {
      if (!video.webkitEnterFullscreen) throw error;
    }
  }
  if (video.webkitEnterFullscreen) return video.webkitEnterFullscreen();
  throw new Error('Fullscreen is unavailable');
}
