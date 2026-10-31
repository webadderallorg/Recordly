import { Button } from '@heroui/react';
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Flow long content into viewport-sized pages instead of a scroll container. */
export default function PagedPanel({ children, label }: { children: ReactNode; label: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const flow = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [stride, setStride] = useState(0);

  useLayoutEffect(() => {
    const frame = viewport.current;
    const content = flow.current;
    if (!frame || !content) return;
    const measure = () => {
      const width = frame.clientWidth;
      if (!width) return;
      const step = width + 24;
      const count = Math.max(1, Math.ceil((content.scrollWidth + 24 - 1) / step));
      setStride(step);
      setPages(count);
      setPage((current) => Math.min(current, count - 1));
    };
    const resize = new ResizeObserver(measure);
    const mutation = new MutationObserver(measure);
    resize.observe(frame);
    mutation.observe(content, { childList: true, subtree: true, characterData: true });
    measure();
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, []);

  return (
    <div className="paged-panel" aria-label={label}>
      <div
        ref={viewport}
        className="page-viewport"
        onFocusCapture={(event) => {
          if (!stride || !viewport.current) return;
          const frame = viewport.current;
          const offset =
            (event.target as HTMLElement).getBoundingClientRect().left -
            frame.getBoundingClientRect().left +
            page * stride +
            frame.scrollLeft;
          setPage(Math.max(0, Math.min(pages - 1, Math.floor((offset + 1) / stride))));
          frame.scrollLeft = 0;
        }}
      >
        <div
          ref={flow}
          className="page-flow"
          style={{ transform: `translateX(-${page * stride}px)` }}
        >
          {children}
        </div>
      </div>
      <nav hidden={pages === 1} className="page-navigation" aria-label={`${label} pages`}>
        <Button
          size="sm"
          variant="ghost"
          isIconOnly
          aria-label={`Previous ${label.toLowerCase()} page`}
          isDisabled={page === 0}
          onPress={() => setPage(page - 1)}
        >
          <CaretLeftIcon size={16} />
        </Button>
        <span aria-live="polite">
          {page + 1} / {pages}
        </span>
        <Button
          size="sm"
          variant="ghost"
          isIconOnly
          aria-label={`Next ${label.toLowerCase()} page`}
          isDisabled={page >= pages - 1}
          onPress={() => setPage(page + 1)}
        >
          <CaretRightIcon size={16} />
        </Button>
      </nav>
    </div>
  );
}
