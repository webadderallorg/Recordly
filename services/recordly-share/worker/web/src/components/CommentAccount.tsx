import { Button, Input, Label, Modal, Spinner, TextField } from '@heroui/react';
import { useEffect, useState } from 'react';
import {
  createCommentAccount, fetchCommentUser, signInForComments, signOutFromComments,
  type CommentAccountState, type CommentUser,
} from '../scripts/api';
import CloudLibrary from './CloudLibrary';
import { Notice } from './ShareUI';

interface Props {
  canComment: boolean;
  onChange: (account: CommentAccountState | null) => void;
  reauthenticate: number;
  returnTo: () => string;
}

export default function CommentAccount(props: Props) {
  const [config, setConfig] = useState<{ url: string; publishableKey: string } | null>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    fetch('/cloud/config', { signal: AbortSignal.timeout(10000) }).then(async (response) => {
      if (response.status === 404) { if (active) setConfig(null); return; }
      if (!response.ok) throw new Error();
      const value = await response.json();
      if (!value.url || !value.publishableKey) throw new Error();
      if (active) setConfig(value);
    }).catch(() => { if (active) setError('Sign-in is unavailable. Please try again.'); });
    return () => { active = false; };
  }, [retry]);
  if (error) return <div className="p-4"><Notice>{error}</Notice><Button size="sm" onPress={() => setRetry(retry + 1)}>Retry sign-in</Button></div>;
  if (config === undefined) return <div className="p-4"><Spinner size="sm" aria-label="Checking account" /></div>;
  if (config) return <CloudLibrary authConfig={config} commentAccount={props} />;
  return <LocalCommentAccount {...props} />;
}

// Self-hosted instances keep their existing local accounts separate from Recordly Cloud.
function LocalCommentAccount({ onChange, reauthenticate, canComment }: Props) {
  const [user, setUser] = useState<CommentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetchCommentUser().then((next) => { if (active) setUser(next); })
      .catch(() => { if (active) setError('Could not check your account. Please sign in again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => { onChange(user ? { key: `local:${user.email}`, displayName: user.displayName, getAccessToken: async () => undefined } : null); }, [user, onChange]);
  useEffect(() => { if (reauthenticate) setOpen(true); }, [reauthenticate]);
  async function submit() {
    if (pending) return;
    setPending(true); setError('');
    try {
      setUser(await (register ? createCommentAccount(name, email, password) : signInForComments(email, password)));
      setPassword(''); setOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not sign in.'); }
    finally { setPending(false); }
  }
  return <>
    <div className="space-y-2 p-4 text-sm">
      {loading ? <Spinner size="sm" aria-label="Checking account" /> : user ? <>
        <p>Commenting as <strong>{user.displayName}</strong></p>
        <Button size="sm" variant="ghost" onPress={() => {
          void signOutFromComments().then(() => setUser(null)).catch(() => setError('Could not sign out. Try again.'));
        }}>Sign out</Button>
      </> : <><p>{canComment ? "Sign in to comment on this recording." : "Sign in to manage your comments."}</p><Button size="sm" onPress={() => setOpen(true)}>Sign in or create account</Button></>}
      {error && !open && <Notice>{error}</Notice>}
    </div>
    <Modal isOpen={open} onOpenChange={setOpen}>
      <Modal.Backdrop><Modal.Container><Modal.Dialog className="space-y-4 p-6" aria-label="Sign in to comment">
        <Modal.CloseTrigger />
        <Modal.Header><Modal.Heading>{register ? 'Create account' : 'Sign in to comment'}</Modal.Heading></Modal.Header>
        <p className="text-sm text-muted">This account belongs to this self-hosted instance.</p>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          {register && <TextField value={name} onChange={setName} isRequired isDisabled={pending}><Label>Display name</Label><Input autoComplete="name" minLength={2} maxLength={100} /></TextField>}
          <TextField value={email} onChange={setEmail} isRequired isDisabled={pending}><Label>Email</Label><Input type="email" autoComplete="email" maxLength={254} /></TextField>
          <TextField value={password} onChange={setPassword} isRequired isDisabled={pending}><Label>Password</Label><Input type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 8 : undefined} maxLength={256} /></TextField>
          {error && <Notice>{error}</Notice>}
          <Button type="submit" isPending={pending}>{register ? 'Create account' : 'Sign in'}</Button>
          <Button variant="ghost" isDisabled={pending} onPress={() => { setRegister(!register); setError(''); }}>{register ? 'Already have an account?' : 'Create an account'}</Button>
        </form>
      </Modal.Dialog></Modal.Container></Modal.Backdrop>
    </Modal>
  </>;
}
