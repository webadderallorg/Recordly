// app.jsx — Refract 3D Mockup Animator main shell
// Brings together: header + left tree + 3D viewport + right inspector + timeline
// + AI panel (modal/sidebar/float) + Devices modal + Export modal + Tweaks panel.

const { useState, useEffect, useRef } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#7C5CFF",
  "timelineStyle": "ae",
  "aiPlacement": "modal"
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = window.useTweaks(TWEAK_DEFAULTS);
  const [time, setTime] = useState(2.2);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState('device');
  const [aiOpen, setAIOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [scene, setScene] = useState('studio');
  const [device, setDevice] = useState('iphone15pro');
  const [toast, setToast] = useState(null);

  // Apply accent globally
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', t.accent);
    // Derive soft + glow from accent
    const hex = t.accent.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    document.documentElement.style.setProperty('--accent-soft', `rgba(${r},${g},${b},0.18)`);
    document.documentElement.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.55)`);
  }, [t.accent]);

  // Playback ticker
  useEffect(() => {
    if (!playing) return;
    let raf, last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      setTime(prev => {
        let n = prev + dt;
        if (n >= 6.0) n = 0;
        return n;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Keyboard
  useEffect(() => {
    const fn = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p); }
      if (e.key === 'g' || e.key === 'G') setAIOpen(true);
      if (e.key === 'Escape') { setAIOpen(false); setPresetsOpen(false); setExportOpen(false); }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const fmtTime = (s) => {
    const m = Math.floor(s / 60), sec = (s % 60);
    return `${m}:${sec.toFixed(2).padStart(5, '0')}`;
  };

  const onGenerate = () => {
    setAIOpen(false);
    setToast({ msg: 'Generated animation · 18 keyframes · 6.0s', icon: 'spark' });
    setTime(0); setPlaying(true);
    setTimeout(() => setToast(null), 3200);
  };
  const onExportStart = () => {
    setExportOpen(false);
    setToast({ msg: 'Rendering 360 frames at 1920×1080…', icon: 'export' });
    setTimeout(() => setToast({ msg: '✓ refract-hero.mp4 · 4.2 MB saved', icon: 'export' }), 2600);
    setTimeout(() => setToast(null), 5400);
  };

  return (
    <div className={'app smooth-accent ' + (t.aiPlacement === 'sidebar' && aiOpen ? 'with-side-ai' : '')}>
      {/* Header */}
      <header className="hdr">
        <div className="hdr-l">
          <div className="brand">
            <div className="brand-mark" />
            <div className="brand-name">Refract <span>· 3D Mockup</span></div>
          </div>
          <button className="crumb">
            <span>Hero shot</span>
            <span className="crumb-sep">/</span>
            <b>Untitled animation</b>
          </button>
        </div>

        <div className="hdr-c">
          <div className="transport">
            <button className="t-btn" onClick={() => setTime(0)} title="Start"><window.I name="prev" size={12} /></button>
            <button className="t-btn play" onClick={() => setPlaying(p => !p)} title="Play (space)">
              <window.I name={playing ? 'pause' : 'play'} size={12} />
            </button>
            <button className="t-btn" onClick={() => setTime(6)} title="End"><window.I name="next" size={12} /></button>
            <span className="t-time">{fmtTime(time)} / 0:06.00</span>
          </div>
        </div>

        <div className="hdr-r">
          <button className="btn ghost"><window.I name="share" size={12} /> Share</button>
          <button className="btn" onClick={() => setAIOpen(true)} style={{ position: 'relative' }}>
            <span style={{
              width: 14, height: 14, borderRadius: 4,
              background: 'linear-gradient(135deg, #B5A1FF, #7C5CFF)',
              display: 'grid', placeItems: 'center',
            }}><window.I name="spark" size={9} color="#fff" /></span>
            Generate <span className="kbd">G</span>
          </button>
          <button className="btn primary" onClick={() => setExportOpen(true)}>
            <window.I name="export" size={12} /> Export
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="body">
        <window.PanelLeft
          selected={selected}
          onSelect={setSelected}
          onOpenPresets={() => setPresetsOpen(true)} />

        <div className="panel-viewport">
          <window.Viewport time={time} playing={playing} accent={t.accent} scene={scene} />

          {/* Floating viewport overlays */}
          <div className="vp-overlay">
            <div className="vp-topbar">
              <div className="vp-chip-row">
                <div className="vp-chip"><span className="dot" />Live · 60fps</div>
                <div className="vp-chip">📐 Camera <b>· Main</b></div>
              </div>
              <div className="vp-chip-row">
                <div className="vp-chip">{(time / 6 * 100).toFixed(0)}% · <b>Frame {Math.round(time * 60)}</b></div>
              </div>
            </div>

            <div className="vp-floater left-m">
              <button className="vp-tool on" title="Orbit"><window.I name="orbit" /></button>
              <button className="vp-tool" title="Pan"><window.I name="pan" /></button>
              <button className="vp-tool" title="Zoom"><window.I name="zoom" /></button>
              <button className="vp-tool" title="Frame"><window.I name="frame" /></button>
            </div>

            <div className="vp-floater bottom-c">
              <button className="vp-tool" title="Front view">F</button>
              <button className="vp-tool on" title="3/4 view">¾</button>
              <button className="vp-tool" title="Top view">T</button>
              <button className="vp-tool" title="Left view">L</button>
              <div style={{ width: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 2px' }} />
              <button className="vp-tool" title="Add keyframe" style={{ color: 'var(--accent)' }}>
                <window.I name="kf" color="currentColor" />
              </button>
            </div>

            <div className="vp-hint">
              <span><kbd>⌥</kbd>drag · orbit</span>
              <span><kbd>⇧</kbd>drag · pan</span>
              <span><kbd>K</kbd> · keyframe</span>
            </div>

            {/* AI FAB — only shown when AI panel closed */}
            {!aiOpen && (
              <button className="vp-fab" onClick={() => setAIOpen(true)}>
                <span className="spark"><window.I name="spark" size={14} color="#fff" /></span>
                Generate with AI
              </button>
            )}
          </div>

          {/* AI as sidebar / floating dock */}
          {aiOpen && t.aiPlacement === 'sidebar' && (
            <window.AIPanel shape="sidebar" onClose={() => setAIOpen(false)} onGenerate={onGenerate} />
          )}
          {aiOpen && t.aiPlacement === 'float' && (
            <window.AIPanel shape="float" onClose={() => setAIOpen(false)} onGenerate={onGenerate} />
          )}
        </div>

        <window.PanelRight selected={selected} time={time} accent={t.accent} />

        <div className="panel-timeline">
          <window.Timeline time={time} setTime={setTime} playing={playing} style={t.timelineStyle} />
        </div>
      </div>

      {/* Modals */}
      {aiOpen && t.aiPlacement === 'modal' && (
        <window.AIPanel shape="modal" onClose={() => setAIOpen(false)} onGenerate={onGenerate} />
      )}
      {presetsOpen && (
        <window.PresetsModal
          onClose={() => setPresetsOpen(false)}
          currentDevice={device}
          currentScene={scene}
          onPick={(d, s) => { setDevice(d); setScene(s); setPresetsOpen(false); }} />
      )}
      {exportOpen && (
        <window.ExportModal onClose={() => setExportOpen(false)} onStart={onExportStart} />
      )}

      {/* Toast */}
      {toast && (
        <div className="toast">
          <span className="pulse" />
          {toast.msg}
        </div>
      )}

      {/* Tweaks panel */}
      <window.TweaksPanel title="Tweaks">
        <window.TweakSection label="Accent" />
        <window.TweakColor
          label="Color"
          value={t.accent}
          options={['#7C5CFF', '#5C9CFF', '#FF7B5B', '#34D399', '#E6FF3D', '#FF5C9C']}
          onChange={(v) => setTweak('accent', v)} />
        <window.TweakSection label="Timeline" />
        <window.TweakRadio
          label="Style"
          value={t.timelineStyle}
          options={[
            { value: 'ae', label: 'AE' },
            { value: 'screenstudio', label: 'Clips' },
            { value: 'novel', label: 'Radial' },
          ]}
          onChange={(v) => setTweak('timelineStyle', v)} />
        <window.TweakSection label="AI panel" />
        <window.TweakRadio
          label="Placement"
          value={t.aiPlacement}
          options={[
            { value: 'modal', label: 'Modal' },
            { value: 'sidebar', label: 'Side' },
            { value: 'float', label: 'Float' },
          ]}
          onChange={(v) => setTweak('aiPlacement', v)} />
      </window.TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
