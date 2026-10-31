import {
  Avatar,
  Button,
  Card,
  Chip,
  Input,
  Label,
  Spinner,
  Tabs,
  TextArea,
  TextField,
  toast,
} from '@heroui/react';
import {
  ChatCircleIcon,
  ClockIcon,
  LinkSimpleIcon,
  PaperPlaneTiltIcon,
} from '@phosphor-icons/react';
import { useEffect, useState, type Dispatch, type SetStateAction, type RefObject } from 'react';
import {
  fetchComments,
  formatDate,
  formatTimestamp,
  postComment,
  type Comment,
  type ShareData,
} from '../scripts/api';
import { timestampParts } from '../scripts/shareModel';
import { copyLink, Notice } from './ShareUI';
import PagedPanel from './PagedPanel';

interface Props {
  data: ShareData;
  time: number;
  duration: number;
  comments: Comment[];
  setComments: Dispatch<SetStateAction<Comment[]>>;
  seek: (time: number) => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  selectedTab: string;
  setSelectedTab: (tab: string) => void;
}

export default function ShareFeedback({
  data,
  time,
  duration,
  comments,
  setComments,
  seek,
  composerRef,
  selectedTab,
  setSelectedTab,
}: Props) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [lockedTime, setLockedTime] = useState<number | null>(null);
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [moreLoading, setMoreLoading] = useState(false);
  const activeIndex = comments.reduce(
    (found, comment, i) => (comment.timestamp <= time + 0.3 ? i : found),
    -1,
  );

  useEffect(() => {
    try {
      setName(localStorage.getItem('recordly-comment-name') || '');
    } catch {
      /* Storage can be disabled. */
    }
    let cancelled = false;
    fetchComments(data.shareCode)
      .then((result) => {
        if (cancelled) return;
        setComments([...result.comments].sort((a, b) => a.timestamp - b.timestamp));
        setTotal(result.total);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Comments could not be loaded. Reload the page to try again.');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [data.shareCode, setComments]);

  async function loadMore() {
    setMoreLoading(true);
    try {
      const result = await fetchComments(data.shareCode, page + 1);
      setComments((current) => [...new Map([...current, ...result.comments].map((comment) => [comment.id, comment])).values()].sort((a, b) => a.timestamp - b.timestamp || a.id - b.id));
      setTotal(result.total);
      setPage(page + 1);
    } catch {
      toast.danger('Could not load more comments. Try again.');
    } finally {
      setMoreLoading(false);
    }
  }

  async function submit() {
    if (posting || !name.trim() || !text.trim()) return;
    const timestamp = lockedTime ?? time;
    setPosting(true);
    setError('');
    try {
      const id = await postComment(data.shareCode, timestamp, name.trim(), text.trim());
      setComments((current) =>
        [
          ...current,
          {
            id,
            timestamp,
            author_name: name.trim(),
            text: text.trim(),
            created_at: new Date().toISOString().slice(0, 19),
          },
        ].sort((a, b) => a.timestamp - b.timestamp),
      );
      setTotal(total + 1);
      setText('');
      setLockedTime(null);
      try {
        localStorage.setItem('recordly-comment-name', name.trim());
      } catch {
        /* Posting does not require storage. */
      }
      toast.success(`Comment posted at ${formatTimestamp(timestamp)}`);
    } catch {
      setError('Could not post your comment. Your draft is saved here—please try again.');
    } finally {
      setPosting(false);
    }
  }

  return (
    <Card className="feedback-card">
      <Tabs
        selectedKey={selectedTab}
        onSelectionChange={(key) => setSelectedTab(String(key))}
        className="feedback-tabs"
      >
        <Tabs.ListContainer>
          <Tabs.List aria-label="Recording feedback">
            <Tabs.Tab id="comments">
              Comments
              {total > 0 && (
                <Chip size="sm" variant="soft">
                  {total}
                </Chip>
              )}
              <Tabs.Indicator />
            </Tabs.Tab>
            {data.segments.length > 0 && (
              <Tabs.Tab id="transcript">
                Transcript
                <Tabs.Indicator />
              </Tabs.Tab>
            )}
            {(data.video.summary || data.chapters.length > 0) && (
              <Tabs.Tab id="details">
                Details
                <Tabs.Indicator />
              </Tabs.Tab>
            )}
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="comments">
          <PagedPanel label="Comments">
            {loading ? (
              <div className="empty-feedback">
                <Spinner aria-label="Loading comments" />
              </div>
            ) : !comments.length ? (
              <div className="empty-feedback">
                <ChatCircleIcon size={28} />
                <h2>Start the conversation</h2>
                <p>Leave feedback at the exact moment you’re watching.</p>
              </div>
            ) : (
              comments.map((comment, i) => (
                <article
                  className="comment-item"
                  data-active={i === activeIndex}
                  key={comment.id}
                >
                  <div className="comment-heading">
                    <Avatar size="sm">
                      <Avatar.Fallback>
                        {comment.author_name.slice(0, 2).toUpperCase()}
                      </Avatar.Fallback>
                    </Avatar>
                    <strong>{comment.author_name}</strong>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Jump to ${formatTimestamp(comment.timestamp)}`}
                      onPress={() => seek(comment.timestamp)}
                    >
                      <span className="timestamp">{formatTimestamp(comment.timestamp)}</span>
                    </Button>
                  </div>
                  <p>
                    {timestampParts(comment.text, duration).map((part, n) =>
                      part.time === undefined ? (
                        part.text
                      ) : (
                        <Button
                          key={n}
                          size="sm"
                          variant="ghost"
                          className="inline-timestamp timestamp"
                          onPress={() => seek(part.time!)}
                        >
                          {part.text}
                        </Button>
                      ),
                    )}
                  </p>
                  <span className="comment-date">{formatDate(comment.created_at)}</span>
                </article>
              ))
            )}
            {comments.length < total && (
              <Button
                size="sm"
                variant="ghost"
                isPending={moreLoading}
                onPress={() => void loadMore()}
              >
                Load more comments
              </Button>
            )}
          </PagedPanel>
        </Tabs.Panel>
        {data.segments.length > 0 && (
          <Tabs.Panel id="transcript">
            <PagedPanel label="Transcript">
              {data.segments.map((segment, i) => (
                <article
                  key={i}
                  className="transcript-item"
                  data-active={time >= segment.start_time && time < segment.end_time}
                >
                  <div className="transcript-heading">
                    <Button size="sm" variant="ghost" onPress={() => seek(segment.start_time)}>
                      <span className="timestamp">{formatTimestamp(segment.start_time)}</span>
                    </Button>
                    {segment.speaker && <span>{segment.speaker}</span>}
                    <Button
                      size="sm"
                      variant="ghost"
                      isIconOnly
                      className="copy-timestamp"
                      aria-label={`Copy link to ${formatTimestamp(segment.start_time)}`}
                      onPress={() => void copyLink(segment.start_time)}
                    >
                      <LinkSimpleIcon size={15} />
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    className="transcript-seek"
                    onPress={() => seek(segment.start_time)}
                  >
                    {segment.text}
                  </Button>
                </article>
              ))}
            </PagedPanel>
          </Tabs.Panel>
        )}
        {(data.video.summary || data.chapters.length > 0) && (
          <Tabs.Panel id="details">
            <PagedPanel label="Details">
              <section className="recording-details">
                <h2>Recording</h2>
                <p>{data.video.title}</p>
              </section>
              {data.video.summary && (
                <section className="recording-details">
                  <h2>Summary</h2>
                  <p>{data.video.summary}</p>
                </section>
              )}
              {data.chapters.length > 0 && (
                <section className="recording-details">
                  <h2>Chapters</h2>
                  <div className="chapter-list">
                    {data.chapters.map((chapter, index) => (
                      <Button
                        key={index}
                        size="sm"
                        variant="ghost"
                        onPress={() => seek(chapter.timestamp)}
                      >
                        <span className="timestamp">{formatTimestamp(chapter.timestamp)}</span>
                        {chapter.title}
                      </Button>
                    ))}
                  </div>
                </section>
              )}
            </PagedPanel>
          </Tabs.Panel>
        )}
      </Tabs>
      <form
        className="composer"
        hidden={selectedTab !== 'comments'}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error && <Notice>{error}</Notice>}
        <TextField name="author" value={name} onChange={setName} isRequired isDisabled={posting}>
          <Label>Name</Label>
          <Input maxLength={100} autoComplete="name" placeholder="Name" />
        </TextField>
        <TextField
          name="comment"
          value={text}
          onChange={(value) => {
            setText(value);
            setLockedTime(value.trim() ? (lockedTime ?? time) : null);
          }}
          isRequired
          isDisabled={posting}
        >
          <Label>Comment</Label>
          <TextArea
            ref={composerRef}
            maxLength={2000}
            placeholder="Share your thoughts…"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
          />
        </TextField>
        <div className="composer-footer">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Comment timestamp ${formatTimestamp(lockedTime ?? time)}. Use current video time`}
            onPress={() => setLockedTime(time)}
          >
            <ClockIcon size={14} />
            <span className="timestamp">{formatTimestamp(lockedTime ?? time)}</span>
          </Button>
          <Button
            type="submit"
            size="sm"
            isPending={posting}
            isDisabled={!name.trim() || !text.trim() || posting}
          >
            <PaperPlaneTiltIcon size={15} />
            {posting ? 'Posting…' : 'Post'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
