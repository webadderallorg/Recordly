// timeline.jsx — AE-style timeline + Screen Studio style + Novel style (toggled by tweak)
// Exposes window.Timeline

const { useMemo, useRef, useEffect } = React;

// 6-second timeline. Width is dynamic from container.
const DURATION = 6.0;

// Track data — one per row. Bars give Screen Studio-style segment fallback.
const TRACKS = [
  { kind: 'head', name: 'Device · iPhone 15 Pro', icon: '📱', open: true },
  { kind: 'prop', name: 'Position',  kf: [0.0, 2.0, 4.0, 6.0], bar: [0, 6] },
  { kind: 'prop', name: 'Rotation',  kf: [0.0, 2.0, 4.0, 6.0], bar: [0, 6], active: true,
    curve: [
      { t: 0.00, v: -52 }, { t: 0.45, v: -32 }, { t: 1.0, v: -10 },
      { t: 2.00, v:  20 }, { t: 3.0, v: 20 },   { t: 4.0, v: 20 },
      { t: 5.00, v:  45 }, { t: 6.0, v: 55 },
    ] },
  { kind: 'prop', name: 'Scale',     kf: [0.0, 2.0, 4.0], bar: [0, 6] },
  { kind: 'head', name: 'Camera · Main', icon: '🎥', open: true },
  { kind: 'prop', name: 'Position',  kf: [0.0, 1.2, 3.6, 6.0], bar: [0, 6] },
  { kind: 'prop', name: 'Focal length', kf: [0.0, 3.0, 6.0], bar: [0, 6] },
  { kind: 'prop', name: 'Focus',     kf: [], bar: [] },
  { kind: 'head', name: 'Scene · Studio', icon: '🌅', open: false },
  { kind: 'head', name: 'Audio · Background', icon: '🎵', open: false, audio: true },
];

function Timeline({ time, setTime, playing, style }) {
  if (style === 'screenstudio') return <ScreenStudioTimeline time={time} setTime={setTime} />;
  if (style === 'novel') return <NovelTimeline time={time} setTime={setTime} />;
  return <AETimeline time={time} setTime={setTime} />;
}

// ─── AE-style timeline ─────────────────────────────────────────────────────
function AETimeline({ time, setTime }) {
  const gridRef = useRef(null);

  const onScrub = (e) => {
    const el = gridRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = Math.max(0, Math.min(DURATION, (x / rect.width) * DURATION));
    setTime(t);
  };
  const onScrubStart = (e) => {
    onScrub(e);
    const move = (ev) => onScrub(ev);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Ticks every 0.25s major every 1s
  const ticks = [];
  for (let t = 0; t <= DURATION; t += 0.25) {
    const isMajor = Math.abs(t - Math.round(t)) < 0.001;
    ticks.push({ t, major: isMajor });
  }

  const playheadPct = (time / DURATION) * 100;

  return (
    <React.Fragment>
      {/* Track list */}
      <div className="tl-tracks">
        <div className="tl-tracks-hd">
          <span>TIMELINE</span>
          <div className="seg" style={{ fontSize: 11 }}>
            <button className="on">Layers</button>
            <button>Curves</button>
          </div>
        </div>
        <div className="tl-tracks-list">
          {TRACKS.map((tr, i) => (
            <div key={i} className={
              'tl-row ' + (tr.kind === 'head' ? 'head ' : 'indent ') +
              (tr.active ? 'active' : '')
            }>
              {tr.kind === 'head' ? (
                <React.Fragment>
                  <span className="chev">{tr.open ? '▾' : '▸'}</span>
                  <span className="ico">{tr.icon}</span>
                  <span className="nm">{tr.name}</span>
                </React.Fragment>
              ) : (
                <React.Fragment>
                  <span className="ico">
                    <KFIcon active={tr.active} />
                  </span>
                  <span className="nm">{tr.name}</span>
                  <span className="val">{(tr.kf?.length || 0)} kf</span>
                </React.Fragment>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Timeline grid */}
      <div className="tl-grid">
        <div className="tl-ruler" ref={gridRef} onPointerDown={onScrubStart}>
          {ticks.map((tk, i) => (
            <div key={i}
              className={'tl-ruler-tick ' + (tk.major ? 'major' : '')}
              style={{ left: `${(tk.t / DURATION) * 100}%` }}>
              {tk.major && <div className="lab">{tk.t.toFixed(0)}s</div>}
            </div>
          ))}
          <div className="tl-playhead" style={{ left: `${playheadPct}%` }} />
        </div>
        <div className="tl-body">
          {TRACKS.map((tr, i) => (
            <div key={i} className={
              'tl-lane ' + (tr.kind === 'head' ? 'head ' : '') +
              (tr.active ? 'active' : '')
            }>
              {tr.bar?.length === 2 && tr.kind !== 'head' && (
                <div className="tl-bar"
                  style={{
                    left:  `${(tr.bar[0] / DURATION) * 100}%`,
                    width: `${((tr.bar[1] - tr.bar[0]) / DURATION) * 100}%`,
                  }}
                />
              )}
              {tr.active && tr.curve && (
                <CurveOverlay curve={tr.curve} />
              )}
              {tr.kf?.map((k, j) => (
                <div key={j} className={'tl-kf ' + (tr.active ? '' : 'dim')}
                  style={{ left: `${(k / DURATION) * 100}%` }}
                />
              ))}
              {tr.audio && <AudioWave />}
            </div>
          ))}
          <div className="tl-playhead" style={{ left: `${playheadPct}%` }} />
        </div>
      </div>
    </React.Fragment>
  );
}

function KFIcon({ active }) {
  return (
    <svg viewBox="0 0 14 14" width="12" height="12">
      <rect x="4" y="4" width="6" height="6" transform="rotate(45 7 7)"
        fill={active ? 'var(--accent)' : 'var(--fg-3)'} />
    </svg>
  );
}

function CurveOverlay({ curve }) {
  // Map curve values into the lane (vertically). Values [-60..60] roughly.
  const minV = Math.min(...curve.map(p => p.v));
  const maxV = Math.max(...curve.map(p => p.v));
  const norm = (v) => 1 - ((v - minV) / (maxV - minV || 1));
  const pts = curve.map(p => `${(p.t / DURATION) * 100},${4 + norm(p.v) * 20}`).join(' ');
  return (
    <svg className="tl-curve" viewBox={`0 0 100 28`} preserveAspectRatio="none">
      <polyline points={pts}
        fill="none" stroke="rgba(124,92,255,0.85)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function AudioWave() {
  const bars = [];
  for (let i = 0; i < 120; i++) {
    const h = 4 + Math.abs(Math.sin(i * 0.45)) * 14 * (0.5 + 0.5 * Math.sin(i * 0.13));
    bars.push(h);
  }
  return (
    <div style={{ position: 'absolute', inset: '4px 6px', display: 'flex', alignItems: 'center', gap: 1, opacity: 0.6 }}>
      {bars.map((h, i) => (
        <div key={i} style={{
          width: 2, height: h, borderRadius: 1,
          background: 'rgba(124,92,255,0.55)',
        }} />
      ))}
    </div>
  );
}

// ─── Screen Studio style — single track of named clips ─────────────────────
function ScreenStudioTimeline({ time, setTime }) {
  const ref = useRef(null);
  const clips = [
    { t: 0,   d: 1.4, name: 'Spin in',   c: '#5C9CFF' },
    { t: 1.4, d: 1.2, name: 'Pause',     c: '#7C5CFF' },
    { t: 2.6, d: 1.6, name: 'Tilt right',c: '#FF7B8B' },
    { t: 4.2, d: 1.0, name: 'Hold',      c: '#65D49C' },
    { t: 5.2, d: 0.8, name: 'Push out',  c: '#FFC857' },
  ];
  const onScrub = (e) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    setTime(Math.max(0, Math.min(DURATION, ((e.clientX - r.left) / r.width) * DURATION)));
  };
  const onDown = (e) => {
    onScrub(e);
    const mv = (ev) => onScrub(ev);
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };

  return (
    <React.Fragment>
      <div className="tl-tracks" style={{ flexBasis: 200 }}>
        <div className="tl-tracks-hd"><span>ANIMATION</span></div>
        <div className="tl-tracks-list">
          <div className="tl-row head"><span className="ico">📱</span><span className="nm">Device</span></div>
          <div className="tl-row indent"><span className="nm">Transform</span><span className="val">5 clips</span></div>
          <div className="tl-row head"><span className="ico">🎥</span><span className="nm">Camera</span></div>
          <div className="tl-row indent"><span className="nm">Move</span><span className="val">3 clips</span></div>
          <div className="tl-row head"><span className="ico">🎵</span><span className="nm">Audio</span></div>
        </div>
      </div>
      <div className="tl-grid">
        <div className="tl-ruler" ref={ref} onPointerDown={onDown}>
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="tl-ruler-tick major" style={{ left: `${(i / DURATION) * 100}%` }}>
              <div className="lab">{i}s</div>
            </div>
          ))}
          <div className="tl-playhead" style={{ left: `${(time / DURATION) * 100}%` }} />
        </div>
        <div className="tl-body" style={{ padding: '14px 4px' }}>
          {[clips, clips.slice(0,3).map(c=>({...c, c:'#5C9CFF'})), [{t:0,d:6,name:'Background.mp3',c:'#444'}]].map((row, r) => (
            <div key={r} style={{ position: 'relative', height: 44, marginBottom: 8 }}>
              {row.map((cl, i) => (
                <div key={i} style={{
                  position: 'absolute',
                  left: `${(cl.t / DURATION) * 100}%`,
                  width: `${(cl.d / DURATION) * 100}%`,
                  top: 2, bottom: 2,
                  background: `linear-gradient(180deg, ${cl.c}cc, ${cl.c}77)`,
                  border: `0.5px solid ${cl.c}`,
                  borderRadius: 8,
                  padding: '4px 10px',
                  fontSize: 11.5,
                  fontWeight: 500,
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 1px 0 rgba(255,255,255,0.18) inset, 0 2px 8px rgba(0,0,0,0.3)',
                }}>{cl.name}</div>
              ))}
            </div>
          ))}
          <div className="tl-playhead" style={{ left: `${(time / DURATION) * 100}%` }} />
        </div>
      </div>
    </React.Fragment>
  );
}

// ─── Novel timeline — radial keyframe wheel ────────────────────────────────
function NovelTimeline({ time, setTime }) {
  // A circular timeline with keyframes around the rim. Click to scrub.
  const ringRef = useRef(null);
  const angle = (time / DURATION) * Math.PI * 2 - Math.PI/2;
  const onClick = (e) => {
    const el = ringRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width/2, cy = r.top + r.height/2;
    const dx = e.clientX - cx, dy = e.clientY - cy;
    let a = Math.atan2(dy, dx) + Math.PI/2;
    if (a < 0) a += Math.PI * 2;
    setTime((a / (Math.PI * 2)) * DURATION);
  };

  const kfList = [
    { t: 0,   layer: 'Rotation', c: '#7C5CFF' },
    { t: 1.0, layer: 'Position', c: '#5C9CFF' },
    { t: 2.0, layer: 'Rotation', c: '#7C5CFF' },
    { t: 3.4, layer: 'Camera',   c: '#FF7B8B' },
    { t: 4.2, layer: 'Scale',    c: '#65D49C' },
    { t: 5.0, layer: 'Rotation', c: '#7C5CFF' },
    { t: 5.6, layer: 'Camera',   c: '#FF7B8B' },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 24, padding: 24, minWidth: 0 }}>
      <div ref={ringRef} onClick={onClick}
        style={{
          width: 200, height: 200, position: 'relative', flex: '0 0 200px',
        }}>
        <svg viewBox="0 0 200 200" style={{ width: '100%', height: '100%' }}>
          <defs>
            <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--accent)" />
              <stop offset="1" stopColor="#5C9CFF" />
            </linearGradient>
          </defs>
          <circle cx="100" cy="100" r="86" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          <circle cx="100" cy="100" r="86" fill="none" stroke="url(#ring-grad)" strokeWidth="2"
            strokeDasharray={`${(time/DURATION)*540} 540`}
            transform="rotate(-90 100 100)"
            strokeLinecap="round" />
          {kfList.map((k, i) => {
            const a = (k.t / DURATION) * Math.PI * 2 - Math.PI/2;
            const x = 100 + Math.cos(a) * 86;
            const y = 100 + Math.sin(a) * 86;
            return <rect key={i} x={x-4} y={y-4} width="8" height="8" transform={`rotate(45 ${x} ${y})`} fill={k.c} />;
          })}
          <circle cx={100 + Math.cos(angle) * 86} cy={100 + Math.sin(angle) * 86} r="7"
            fill="#fff" stroke="var(--accent)" strokeWidth="2" />
        </svg>
        <div style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          pointerEvents: 'none', fontVariantNumeric: 'tabular-nums',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' }}>{time.toFixed(2)}s</div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>of {DURATION.toFixed(1)}s</div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--fg-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>Keyframes</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
          {kfList.map((k, i) => (
            <button key={i} onClick={() => setTime(k.t)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 10px', borderRadius: 8,
                background: Math.abs(time - k.t) < 0.05 ? 'var(--bg-3)' : 'var(--bg-2)',
                border: `0.5px solid ${Math.abs(time - k.t) < 0.05 ? k.c : 'var(--line-2)'}`,
                color: 'var(--fg)', fontSize: 12, textAlign: 'left',
              }}>
              <span style={{ width: 8, height: 8, background: k.c, transform: 'rotate(45deg)', boxShadow: `0 0 6px ${k.c}99` }} />
              <span style={{ flex: 1 }}>{k.layer}</span>
              <span style={{ color: 'var(--fg-4)', fontVariantNumeric: 'tabular-nums' }}>{k.t.toFixed(2)}s</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

window.Timeline = Timeline;
