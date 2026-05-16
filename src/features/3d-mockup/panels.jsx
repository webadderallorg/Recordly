// panels.jsx — Left scene tree + Right properties inspector
// Exposes window.PanelLeft, window.PanelRight

const { useState } = React;

// Tiny icon helper
function I({ name, size = 14, color }) {
  const s = size;
  const c = color || 'currentColor';
  switch (name) {
    case 'phone':   return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><rect x="4" y="1.5" width="8" height="13" rx="2" stroke={c} /><path d="M7 13h2" stroke={c} strokeLinecap="round"/></svg>;
    case 'camera':  return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><rect x="1.5" y="4" width="13" height="9" rx="1.5" stroke={c}/><circle cx="8" cy="8.5" r="2.5" stroke={c}/><path d="M6 4l1-1.5h2L10 4" stroke={c} strokeLinecap="round"/></svg>;
    case 'sun':     return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke={c}/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3" stroke={c} strokeLinecap="round"/></svg>;
    case 'music':   return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M6 13V3l7-1.5v10" stroke={c}/><circle cx="4.5" cy="13" r="1.5" stroke={c}/><circle cx="11.5" cy="11.5" r="1.5" stroke={c}/></svg>;
    case 'eye':     return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" stroke={c}/><circle cx="8" cy="8" r="2" stroke={c}/></svg>;
    case 'lock':    return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke={c}/><path d="M5 7V5a3 3 0 0 1 6 0v2" stroke={c}/></svg>;
    case 'plus':    return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke={c} strokeLinecap="round"/></svg>;
    case 'kf':      return <svg width={s} height={s} viewBox="0 0 16 16"><rect x="5" y="5" width="6" height="6" transform="rotate(45 8 8)" fill={c}/></svg>;
    case 'menu':    return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><circle cx="8" cy="3" r="1.2" fill={c}/><circle cx="8" cy="8" r="1.2" fill={c}/><circle cx="8" cy="13" r="1.2" fill={c}/></svg>;
    case 'play':    return <svg width={s} height={s} viewBox="0 0 16 16" fill={c}><path d="M5 3.5v9l8-4.5z"/></svg>;
    case 'pause':   return <svg width={s} height={s} viewBox="0 0 16 16" fill={c}><rect x="4" y="3" width="3" height="10" rx="0.5"/><rect x="9" y="3" width="3" height="10" rx="0.5"/></svg>;
    case 'prev':    return <svg width={s} height={s} viewBox="0 0 16 16" fill={c}><path d="M4 3v10M5 8l7-4.5v9z"/></svg>;
    case 'next':    return <svg width={s} height={s} viewBox="0 0 16 16" fill={c}><path d="M12 3v10M11 8L4 3.5v9z"/></svg>;
    case 'orbit':   return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5" stroke={c}/><ellipse cx="8" cy="8" rx="5" ry="2" stroke={c}/></svg>;
    case 'pan':     return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10M5 5l-2 3 2 3M11 5l2 3-2 3" stroke={c} strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case 'zoom':    return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4" stroke={c}/><path d="M10 10l3.5 3.5M5 7h4M7 5v4" stroke={c} strokeLinecap="round"/></svg>;
    case 'frame':   return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.5" width="11" height="11" rx="1" stroke={c}/><path d="M2.5 5h11M5 2.5v11" stroke={c} opacity=".5"/></svg>;
    case 'export':  return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M8 10V2M5 5l3-3 3 3M3 11v2.5h10V11" stroke={c} strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case 'share':   return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><circle cx="4" cy="8" r="1.8" stroke={c}/><circle cx="12" cy="4" r="1.8" stroke={c}/><circle cx="12" cy="12" r="1.8" stroke={c}/><path d="M5.5 7l5-2.5M5.5 9l5 2.5" stroke={c}/></svg>;
    case 'spark':   return <svg width={s} height={s} viewBox="0 0 16 16" fill={c}><path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z"/></svg>;
    case 'gallery': return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke={c}/><rect x="9" y="2" width="5" height="5" rx="1" stroke={c}/><rect x="2" y="9" width="5" height="5" rx="1" stroke={c}/><rect x="9" y="9" width="5" height="5" rx="1" stroke={c}/></svg>;
    case 'x':       return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke={c} strokeLinecap="round"/></svg>;
    default: return null;
  }
}
window.I = I;

// ─── Left panel — scene tree ───────────────────────────────────────────────
function PanelLeft({ selected, onSelect, onOpenPresets }) {
  return (
    <div className="panel-left">
      <div className="ph">
        <span>Scene</span>
        <div className="ph-acts">
          <button className="ph-icon" title="Add" onClick={onOpenPresets}><I name="plus" /></button>
          <button className="ph-icon" title="More"><I name="menu" /></button>
        </div>
      </div>
      <div className="tree">
        <div className={'tree-row' + (selected === 'device' ? ' active' : '')}
          onClick={() => onSelect('device')}>
          <span className="chev">▾</span>
          <span className="ico"><I name="phone" /></span>
          <span className="row-name">iPhone 15 Pro</span>
          <span className="row-vis"><I name="eye" size={12} /></span>
        </div>
        <div className="tree-row indent-1" onClick={() => onSelect('screen')}>
          <span className="chev"></span>
          <span className="ico" style={{ color: 'var(--accent)' }}>●</span>
          <span className="row-name">Screen recording.mp4</span>
          <span className="row-vis"><I name="eye" size={12} /></span>
        </div>
        <div className="tree-row indent-1 locked">
          <span className="chev"></span>
          <span className="ico">○</span>
          <span className="row-name">Body · Titanium</span>
          <span className="row-vis"><I name="lock" size={12} /></span>
        </div>

        <div className={'tree-row' + (selected === 'camera' ? ' active' : '')}
          onClick={() => onSelect('camera')}>
          <span className="chev">▸</span>
          <span className="ico"><I name="camera" /></span>
          <span className="row-name">Camera · Main</span>
          <span className="row-vis"><I name="eye" size={12} /></span>
        </div>

        <div className="tree-row" onClick={() => onSelect('scene')}>
          <span className="chev">▸</span>
          <span className="ico"><I name="sun" /></span>
          <span className="row-name">Scene · Studio</span>
          <span className="row-vis"><I name="eye" size={12} /></span>
        </div>

        <div className="tree-row locked">
          <span className="chev"></span>
          <span className="ico"><I name="music" /></span>
          <span className="row-name">Audio · Background</span>
          <span className="row-vis"><I name="lock" size={12} /></span>
        </div>

        <div className="tree-section">Project</div>
        <div className="tree-row">
          <span className="chev"></span>
          <span className="ico">⏱</span>
          <span className="row-name">6.0s · 60fps</span>
        </div>
        <div className="tree-row">
          <span className="chev"></span>
          <span className="ico">⛶</span>
          <span className="row-name">1920 × 1080</span>
        </div>
      </div>

      <div style={{ padding: 10, borderTop: '1px solid var(--line)' }}>
        <button className="btn" style={{ width: '100%', justifyContent: 'center' }}
          onClick={onOpenPresets}>
          <I name="gallery" /> Browse devices & scenes
        </button>
      </div>
    </div>
  );
}

// ─── Right panel — properties inspector ────────────────────────────────────
function PanelRight({ selected, time, accent }) {
  const isDevice = selected === 'device' || selected === 'screen';
  const isCamera = selected === 'camera';
  const isScene = selected === 'scene';

  return (
    <div className="panel-right">
      <div className="ph">
        <span>{isCamera ? 'Camera · Main' : isScene ? 'Scene · Studio' : 'iPhone 15 Pro'}</span>
        <div className="ph-acts">
          <button className="ph-icon"><I name="menu" /></button>
        </div>
      </div>
      <div className="insp">
        {isDevice && <DeviceInspector time={time} />}
        {isCamera && <CameraInspector time={time} />}
        {isScene && <SceneInspector />}
      </div>
    </div>
  );
}

function NumField({ ax, val, unit, kf, color }) {
  return (
    <div className={'numinput' + (kf ? ' kf' : '')}>
      {kf && <span className="kf-dot" />}
      {ax && <span className="ax">{ax}</span>}
      <input defaultValue={val} />
      {unit && <span className="unit">{unit}</span>}
    </div>
  );
}

function DeviceInspector({ time }) {
  const [easing, setEasing] = useState('out');
  return (
    <React.Fragment>
      <div className="insp-sec">
        <h4>Transform <span className="h-act"><I name="kf" color="var(--accent)" /></span></h4>
        <div className="field">
          <span className="field-lbl">Position</span>
          <div className="grp">
            <NumField ax="X" val="0.00" unit="cm" kf />
            <NumField ax="Y" val="0.15" unit="cm" />
            <NumField ax="Z" val="0.00" unit="cm" />
          </div>
        </div>
        <div className="field">
          <span className="field-lbl">Rotation</span>
          <div className="grp">
            <NumField ax="X" val="0" unit="°" />
            <NumField ax="Y" val={Math.round(20 - time * 5)} unit="°" kf />
            <NumField ax="Z" val={Math.round(-time * 2)} unit="°" kf />
          </div>
        </div>
        <div className="field">
          <span className="field-lbl">Scale</span>
          <div className="grp">
            <NumField ax="U" val="1.00" kf />
          </div>
        </div>
      </div>

      <div className="insp-sec">
        <h4>Easing</h4>
        <div className="curve-pick">
          {[
            { id: 'lin', path: 'M2 28 L26 4' },
            { id: 'in',  path: 'M2 28 C2 28 22 28 26 4' },
            { id: 'out', path: 'M2 28 C2 28 12 4 26 4' },
            { id: 'io',  path: 'M2 28 C12 28 16 4 26 4' },
          ].map(c => (
            <button key={c.id} className={'curve-cell' + (easing === c.id ? ' on' : '')}
              onClick={() => setEasing(c.id)}>
              <svg viewBox="0 0 28 32"><path d={c.path} stroke="currentColor" fill="none" strokeWidth="1.5"/></svg>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--fg-3)' }}>
          Applied to selected keyframe
        </div>
      </div>

      <div className="insp-sec">
        <h4>Material</h4>
        <div className="field">
          <span className="field-lbl">Finish</span>
          <div className="seg">
            <button className="on">Titanium</button>
            <button>Glass</button>
            <button>Gold</button>
          </div>
        </div>
        <div className="field">
          <span className="field-lbl">Color</span>
          <div className="swatchrow">
            <div className="swatch on" style={{ background: 'linear-gradient(135deg, #4a4a52, #2a2a30)' }}/>
            <div className="swatch" style={{ background: 'linear-gradient(135deg, #d0d0d6, #888892)' }}/>
            <div className="swatch" style={{ background: 'linear-gradient(135deg, #f7e6c9, #b89a6a)' }}/>
            <div className="swatch" style={{ background: 'linear-gradient(135deg, #2c4575, #1a2840)' }}/>
            <div className="swatch" style={{ background: 'linear-gradient(135deg, #6b1f2e, #3d0e18)' }}/>
          </div>
        </div>
        <div className="field">
          <span className="field-lbl">Reflect</span>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="range" min="0" max="100" defaultValue="62" style={{ flex: 1 }} />
            <span style={{ color: 'var(--fg-3)', fontSize: 11.5, width: 28, textAlign: 'right' }}>62</span>
          </div>
        </div>
      </div>

      <div className="insp-sec">
        <h4>Screen recording</h4>
        <div style={{
          height: 70, borderRadius: 8, border: '1px solid var(--line-2)',
          background: 'linear-gradient(135deg, #FFB199, #8E6BFF, #3D2D8C)',
          position: 'relative', overflow: 'hidden', marginBottom: 8,
        }}>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 500, textShadow: '0 1px 4px rgba(0,0,0,0.4)' }}>
            screen-recording.mp4 · 0:06
          </div>
        </div>
        <div className="field">
          <span className="field-lbl">Trim</span>
          <div className="grp">
            <NumField ax="In" val="0.00" unit="s" />
            <NumField ax="Out" val="6.00" unit="s" />
          </div>
        </div>
      </div>
    </React.Fragment>
  );
}

function CameraInspector({ time }) {
  return (
    <React.Fragment>
      <div className="insp-sec">
        <h4>Transform</h4>
        <div className="field">
          <span className="field-lbl">Position</span>
          <div className="grp">
            <NumField ax="X" val={(-9 + time * 0.5).toFixed(2)} unit="cm" kf />
            <NumField ax="Y" val={(4 - time * 0.3).toFixed(2)} unit="cm" kf />
            <NumField ax="Z" val={(36 + time).toFixed(2)} unit="cm" kf />
          </div>
        </div>
        <div className="field">
          <span className="field-lbl">Target</span>
          <div className="grp">
            <NumField ax="X" val="0.00" />
            <NumField ax="Y" val="0.00" />
            <NumField ax="Z" val="0.00" />
          </div>
        </div>
      </div>
      <div className="insp-sec">
        <h4>Lens</h4>
        <div className="field">
          <span className="field-lbl">Focal</span>
          <div className="grp"><NumField val="28" unit="mm" kf /></div>
        </div>
        <div className="field">
          <span className="field-lbl">Aperture</span>
          <div className="grp"><NumField val="f/2.8" /></div>
        </div>
        <div className="field">
          <span className="field-lbl">Focus</span>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="range" min="0" max="100" defaultValue="55" style={{ flex: 1 }} />
            <span style={{ color: 'var(--fg-3)', fontSize: 11.5, width: 28, textAlign: 'right' }}>55</span>
          </div>
        </div>
        <div className="field">
          <span className="field-lbl">DOF</span>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="range" min="0" max="100" defaultValue="20" style={{ flex: 1 }} />
            <span style={{ color: 'var(--fg-3)', fontSize: 11.5, width: 28, textAlign: 'right' }}>20</span>
          </div>
        </div>
      </div>
      <div className="insp-sec">
        <h4>Look at</h4>
        <div className="seg">
          <button className="on">Device</button>
          <button>Origin</button>
          <button>Free</button>
        </div>
      </div>
    </React.Fragment>
  );
}

function SceneInspector() {
  return (
    <React.Fragment>
      <div className="insp-sec">
        <h4>Environment</h4>
        <div className="field">
          <span className="field-lbl">HDRI</span>
          <div className="seg">
            <button className="on">Studio</button>
            <button>Sunset</button>
            <button>Bay</button>
          </div>
        </div>
        <div className="field">
          <span className="field-lbl">Intensity</span>
          <div style={{ flex: 1 }}>
            <input type="range" min="0" max="200" defaultValue="100" style={{ width: '100%' }} />
          </div>
        </div>
        <div className="field">
          <span className="field-lbl">Rotation</span>
          <div className="grp"><NumField val="42" unit="°" /></div>
        </div>
      </div>
      <div className="insp-sec">
        <h4>Background</h4>
        <div className="swatchrow">
          <div className="swatch on" style={{ background: '#0a0a0c' }}/>
          <div className="swatch" style={{ background: 'linear-gradient(135deg, #6c2da8, #ff7b5b)' }}/>
          <div className="swatch" style={{ background: 'linear-gradient(135deg, #4a78ff, #c93dff)' }}/>
          <div className="swatch" style={{ background: '#f5f1ea' }}/>
          <div className="swatch" style={{ background: 'linear-gradient(135deg, #25b5a0, #18524a)' }}/>
        </div>
      </div>
      <div className="insp-sec">
        <h4>Ground</h4>
        <div className="field">
          <span className="field-lbl">Type</span>
          <div className="seg">
            <button>None</button>
            <button className="on">Shadow</button>
            <button>Mirror</button>
          </div>
        </div>
      </div>
    </React.Fragment>
  );
}

window.PanelLeft = PanelLeft;
window.PanelRight = PanelRight;
