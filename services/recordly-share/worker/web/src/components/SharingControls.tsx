import { Button, Modal, Spinner } from '@heroui/react';
import { useEffect, useRef, useState } from 'react';
import { deleteModerationComment, fetchModeration, fetchModerationComments, updateModeration, type Comment, type ModerationSettings } from '../scripts/api';
import { Notice } from './ShareUI';

export default function SharingControls({ code, title, accessToken, onClose }: { code: string; title: string; accessToken: string; onClose: () => void }) {
  const [settings, setSettings] = useState<ModerationSettings | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const busy = useRef(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchModeration(code, accessToken), fetchModerationComments(code, accessToken)])
      .then(([state, result]) => {
        if (cancelled) return;
        setSettings(state); setComments(result.comments); setTotal(result.total);
      }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load sharing controls.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [code, accessToken]);
  async function perform(action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update this recording. Please try again.'); }
    finally { busy.current = false; setPending(false); }
  }
  async function loadComments(nextPage: number) {
    const result = await fetchModerationComments(code, accessToken, nextPage);
    setComments(result.comments); setTotal(result.total); setPage(nextPage);
  }
  return <Modal isOpen onOpenChange={(open) => { if (!open && !busy.current) onClose(); }}>
    <Modal.Backdrop><Modal.Container><Modal.Dialog>
      <Modal.Header><Modal.Heading>Manage sharing</Modal.Heading></Modal.Header>
      <Modal.Body className="space-y-5">
        <p className="truncate font-medium">{title}</p>
        {error && <Notice>{error}</Notice>}
        {loading ? <Spinner aria-label="Loading sharing controls" /> : settings ? <>
          <section className="space-y-3" aria-label="Sharing controls">
            <div className="flex items-center justify-between gap-3"><p>{settings.sharingBlocked ? 'Sharing is unavailable while this recording is under review.' : <>Sharing is {settings.sharingEnabled ? 'enabled' : 'paused'}. Pausing makes the link unavailable to viewers.</>}</p>
              <Button size="sm" variant="secondary" isDisabled={pending || settings.sharingBlocked} onPress={() => void perform(async () => { setSettings(await updateModeration(code, accessToken, { sharingEnabled: !settings.sharingEnabled })); })}>{settings.sharingEnabled ? 'Pause sharing' : 'Resume sharing'}</Button>
            </div>
            <div className="flex items-center justify-between gap-3"><p>New comments and reactions are {settings.feedbackEnabled ? 'enabled' : 'disabled'}. Existing feedback stays visible.</p>
              <Button size="sm" variant="secondary" isDisabled={pending} onPress={() => void perform(async () => { setSettings(await updateModeration(code, accessToken, { feedbackEnabled: !settings.feedbackEnabled })); })}>{settings.feedbackEnabled ? 'Disable feedback' : 'Enable feedback'}</Button>
            </div>
          </section>
          <section aria-label="Manage comments" className="space-y-3">
            <h3 className="font-medium">Comments ({total})</h3>
            <p className="text-sm text-muted">Deleted comments cannot be restored.</p>
            {!comments.length && <p>No comments on this page.</p>}
            <ul className="max-h-64 space-y-3 overflow-y-auto">
              {comments.map((comment) => <li key={comment.id} className="flex items-start justify-between gap-3 rounded-lg bg-default/30 p-3">
                <div className="min-w-0"><strong>{comment.author_name}</strong><p className="whitespace-pre-wrap break-words">{comment.text}</p></div>
                <Button size="sm" variant="danger" isDisabled={pending} aria-label={`Delete comment by ${comment.author_name}`} onPress={() => void perform(async () => {
                  await deleteModerationComment(code, accessToken, comment.id);
                  setComments((current) => current.filter((item) => item.id !== comment.id));
                  setTotal((current) => Math.max(0, current - 1));
                  await loadComments(comments.length === 1 && page > 1 ? page - 1 : page);
                })}>Delete</Button>
              </li>)}
            </ul>
            <div className="flex items-center gap-3">
              <Button size="sm" variant="ghost" isDisabled={pending || page === 1} onPress={() => void perform(() => loadComments(page - 1))}>Previous</Button>
              <span className="text-sm">Page {page}</span>
              <Button size="sm" variant="ghost" isDisabled={pending || page * 50 >= total} onPress={() => void perform(() => loadComments(page + 1))}>Next</Button>
            </div>
          </section>
        </> : <Button variant="secondary" onPress={onClose}>Close and try again</Button>}
      </Modal.Body>
      <Modal.Footer><Button isDisabled={pending} onPress={onClose}>Done</Button></Modal.Footer>
    </Modal.Dialog></Modal.Container></Modal.Backdrop>
  </Modal>;
}
