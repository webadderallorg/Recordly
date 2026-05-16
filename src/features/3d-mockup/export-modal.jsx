// export-modal.jsx — Export / render dialog
const { useState } = React;

function ExportModal({ onClose, onStart }) {
  const [format, setFormat] = useState('mp4');
  const [preset, setPreset] = useState('1080p');
  const [transparent, setTransparent] = useState(false);
  const [fps, setFps] = useState(60);

  const sizes = {
    '1080p': { w: 1920, h: 1080, label: '1080p · Full HD' },
    '4k':    { w: 3840, h: 2160, label: '4K · Ultra HD' },
    'sq':    { w: 1080, h: 1080, label: 'Square · 1:1' },
    '9x16':  { w: 1080, h: 1920, label: 'Vertical · 9:16' },
  };
  const sz = sizes[preset];
  const est = (sz.w * sz.h * fps * 6 / 1e8).toFixed(1);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: 'min(560px, 92vw)' }} onClick={e => e.stopPropagation()}>
        <div className="modal-hd">
          <div>
            <h2>Export</h2>
            <p>Render the timeline to video.</p>
          </div>
          <button className="modal-x" onClick={onClose}><window.I name="x" /></button>
        </div>
        <div className="modal-bd" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Row label="Format">
            <div className="seg" style={{ width: '100%' }}>
              {['mp4', 'mov', 'webm', 'gif'].map(f => (
                <button key={f} className={format === f ? 'on' : ''} onClick={() => setFormat(f)}
                  style={{ flex: 1, padding: '6px 0', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {f}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Size">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
              {Object.entries(sizes).map(([id, s]) => (
                <button key={id} onClick={() => setPreset(id)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 10px',
                    border: `1px solid ${preset === id ? 'var(--accent)' : 'var(--line-2)'}`,
                    borderRadius: 8,
                    background: preset === id ? 'rgba(124,92,255,0.10)' : 'var(--bg-2)',
                    color: 'var(--fg)', fontSize: 12,
                  }}>
                  <span>{s.label}</span>
                  <span style={{ color: 'var(--fg-4)', fontVariantNumeric: 'tabular-nums' }}>{s.w}×{s.h}</span>
                </button>
              ))}
            </div>
          </Row>
          <Row label="Frame rate">
            <div className="seg" style={{ width: '100%' }}>
              {[24, 30, 60].map(f => (
                <button key={f} className={fps === f ? 'on' : ''} onClick={() => setFps(f)} style={{ flex: 1 }}>
                  {f}fps
                </button>
              ))}
            </div>
          </Row>
          <Row label="Background">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--fg-2)' }}>
              <input type="checkbox" checked={transparent} onChange={e => setTransparent(e.target.checked)} />
              Transparent (PNG sequence)
            </label>
          </Row>

          <div style={{
            border: '1px solid var(--line)', borderRadius: 10,
            padding: 12, background: 'rgba(0,0,0,0.2)',
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
            fontSize: 12, fontVariantNumeric: 'tabular-nums',
          }}>
            <span style={{ color: 'var(--fg-3)' }}>Duration</span>
            <span style={{ textAlign: 'right' }}>6.0 s</span>
            <span style={{ color: 'var(--fg-3)' }}>Total frames</span>
            <span style={{ textAlign: 'right' }}>{fps * 6}</span>
            <span style={{ color: 'var(--fg-3)' }}>Est. file size</span>
            <span style={{ textAlign: 'right' }}>~{est} MB</span>
            <span style={{ color: 'var(--fg-3)' }}>Est. render</span>
            <span style={{ textAlign: 'right' }}>~{Math.round(sz.w * sz.h * fps / 4e6)} s</span>
          </div>
        </div>
        <div className="modal-ft">
          <span style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>Rendered locally with WebCodecs</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={onStart}>
              <window.I name="export" size={12} /> Start render
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--fg-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

window.ExportModal = ExportModal;
