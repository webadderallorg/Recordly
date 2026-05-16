// modals.jsx — AI Generate panel + Device gallery + Export dialog
// Three components, all share the same .modal-bg backdrop except AI which can also live
// as a sidebar or floating dock (driven by tweak).

const { useState } = React;

// ─── AI Generate ───────────────────────────────────────────────────────────
const AI_PRESETS = [
  { id: 'hero',    name: 'Hero shot',      sub: 'Front, slow rotate, hold', tone: 'linear-gradient(135deg, #7C5CFF, #4A2DD6)' },
  { id: 'reveal',  name: 'Product reveal', sub: 'Spin-in from behind',      tone: 'linear-gradient(135deg, #FF7B8B, #C93DFF)' },
  { id: 'demo',    name: 'Feature demo',   sub: 'Tilt + push-in on screen', tone: 'linear-gradient(135deg, #5C9CFF, #25B5A0)' },
  { id: 'float',   name: 'Floating',       sub: 'Idle bob and yaw',         tone: 'linear-gradient(135deg, #FFC857, #FF7B5B)' },
  { id: 'compare', name: 'Side-by-side',   sub: 'Two devices, parallax',    tone: 'linear-gradient(135deg, #65D49C, #25B5A0)' },
  { id: 'orbit',   name: 'Full orbit',     sub: '360° around device',       tone: 'linear-gradient(135deg, #B5A1FF, #7C5CFF)' },
];

function AIPanel({ shape = 'modal', onClose, onGenerate, placement }) {
  const [prompt, setPrompt] = useState('Show the home screen, then rotate to reveal the side button, ending in a clean hero shot.');
  const [pickedPreset, setPickedPreset] = useState('demo');

  const Wrap = shape === 'sidebar' ? 'div' : shape === 'float' ? 'div' : 'div';
  const wrapCls = shape === 'sidebar' ? 'ai-side' : shape === 'float' ? 'ai-float' : null;

  const content = (
    <React.Fragment>
      <div className="modal-hd">
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 22, height: 22, borderRadius: 6,
              background: 'linear-gradient(135deg, #B5A1FF, #7C5CFF 50%, #4A2DD6)',
              display: 'grid', placeItems: 'center',
              boxShadow: '0 0 14px rgba(124,92,255,0.5)',
            }}>
              <window.I name="spark" size={13} color="#fff" />
            </span>
            Generate animation
          </h2>
          <p style={{ marginTop: 2 }}>Describe the motion or pick a preset. Refine in plain language.</p>
        </div>
        <button className="modal-x" onClick={onClose}><window.I name="x" /></button>
      </div>

      <div className="modal-bd" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="ai-prompt">
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="e.g. Start spinning from the side, settle on front, push in on the screen…" />
          <div className="ai-prompt-row">
            <div style={{ display: 'flex', gap: 6 }}>
              <span className="ai-tag">📱 iPhone 15 Pro</span>
              <span className="ai-tag">⏱ 6.0s</span>
              <span className="ai-tag">🌅 Studio</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-4)' }}>⌘ ↵ to generate</div>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>Presets</div>
          <div className="ai-presets">
            {AI_PRESETS.map(p => (
              <button key={p.id} className="ai-preset"
                onClick={() => setPickedPreset(p.id)}
                style={pickedPreset === p.id ? { borderColor: 'var(--accent)', background: 'rgba(124,92,255,0.08)' } : {}}>
                <div className="thumb" style={{ background: p.tone }}>
                  <PresetSvg id={p.id} />
                </div>
                <div className="nm">{p.name}</div>
                <div className="sub">{p.sub}</div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>Refinements</div>
          <div className="ai-chat-msg ai">
            <div className="who"><window.I name="spark" size={11} /></div>
            <div className="what">
              Set a 6-second animation: <b>spin-in from -90°</b>, settle on front at 2s, then <b>push in on the screen</b> until 4.5s, end on a quarter turn.
              <div className="chip-row">
                <button className="ai-chip">↺ Make rotation slower</button>
                <button className="ai-chip">＋ Add a subtle bob</button>
                <button className="ai-chip">⤬ Remove push-in</button>
                <button className="ai-chip">↗ End on hero pose</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="modal-ft">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11.5, color: 'var(--fg-3)' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34D399', boxShadow: '0 0 6px #34D399' }} />
          Refract Motion · v2
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={onGenerate}>
            <window.I name="spark" size={12} /> Generate
          </button>
        </div>
      </div>
    </React.Fragment>
  );

  if (shape === 'sidebar' || shape === 'float') {
    return <div className={wrapCls}>{content}</div>;
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>{content}</div>
    </div>
  );
}

function PresetSvg({ id }) {
  // Stylized iconographic preview of the motion.
  const stroke = 'rgba(255,255,255,0.9)';
  switch (id) {
    case 'hero': return (
      <svg viewBox="0 0 100 60" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <rect x="42" y="14" width="16" height="32" rx="3" fill="rgba(255,255,255,0.95)" />
        <circle cx="50" cy="30" r="20" stroke={stroke} fill="none" strokeDasharray="2 3" />
      </svg>
    );
    case 'reveal': return (
      <svg viewBox="0 0 100 60" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <rect x="22" y="14" width="10" height="32" rx="2" fill="rgba(255,255,255,0.4)" transform="rotate(-25 27 30)" />
        <rect x="42" y="14" width="14" height="32" rx="3" fill="rgba(255,255,255,0.7)" transform="rotate(-12 49 30)" />
        <rect x="64" y="14" width="16" height="32" rx="3" fill="rgba(255,255,255,0.95)" />
      </svg>
    );
    case 'demo': return (
      <svg viewBox="0 0 100 60" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <rect x="42" y="14" width="16" height="32" rx="3" fill="rgba(255,255,255,0.95)" transform="rotate(8 50 30)" />
        <path d="M70 20 L84 14 M70 40 L84 46 M70 30 L84 30" stroke={stroke} strokeLinecap="round" />
      </svg>
    );
    case 'float': return (
      <svg viewBox="0 0 100 60" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <rect x="42" y="14" width="16" height="32" rx="3" fill="rgba(255,255,255,0.95)" transform="rotate(-4 50 30)" />
        <path d="M20 50 Q40 40 50 50 T80 50" stroke={stroke} fill="none" strokeLinecap="round" />
      </svg>
    );
    case 'compare': return (
      <svg viewBox="0 0 100 60" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <rect x="20" y="16" width="14" height="28" rx="3" fill="rgba(255,255,255,0.8)" transform="rotate(-10 27 30)" />
        <rect x="62" y="16" width="14" height="28" rx="3" fill="rgba(255,255,255,0.95)" transform="rotate(10 69 30)" />
      </svg>
    );
    case 'orbit': return (
      <svg viewBox="0 0 100 60" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <ellipse cx="50" cy="30" rx="30" ry="10" stroke={stroke} fill="none" />
        <rect x="42" y="14" width="16" height="32" rx="3" fill="rgba(255,255,255,0.95)" />
      </svg>
    );
    default: return null;
  }
}

window.AIPanel = AIPanel;
