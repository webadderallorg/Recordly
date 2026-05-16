// presets-modal.jsx — Device gallery + scenes
const { useState } = React;

const DEVICES = [
  { id: 'iphone15pro', cat: 'phone', name: 'iPhone 15 Pro',    sub: '6.1″ · Natural Ti', cur: true },
  { id: 'iphone15',    cat: 'phone', name: 'iPhone 15',        sub: '6.1″ · Pink' },
  { id: 'iphone15max', cat: 'phone', name: 'iPhone 15 Pro Max',sub: '6.7″ · Blue Ti' },
  { id: 'pixel8',      cat: 'phone', name: 'Pixel 8 Pro',      sub: '6.7″ · Porcelain' },
  { id: 'galaxy24',    cat: 'phone', name: 'Galaxy S24 Ultra', sub: '6.8″ · Titanium Gray' },
  { id: 'iphone15plus',cat: 'phone', name: 'iPhone 15 Plus',   sub: '6.7″ · Black' },

  { id: 'mbp14',  cat: 'laptop', name: 'MacBook Pro 14″',  sub: 'Space Black' },
  { id: 'mbp16',  cat: 'laptop', name: 'MacBook Pro 16″',  sub: 'Silver' },
  { id: 'mba13',  cat: 'laptop', name: 'MacBook Air 13″',  sub: 'Midnight' },

  { id: 'ipadpro', cat: 'tablet', name: 'iPad Pro 12.9″',  sub: 'Space Gray' },
  { id: 'ipadair', cat: 'tablet', name: 'iPad Air',        sub: 'Blue' },
  { id: 'ipadmini',cat: 'tablet', name: 'iPad mini',       sub: 'Purple' },

  { id: 'studio',  cat: 'desktop', name: 'Studio Display', sub: '27″ 5K' },
  { id: 'imac',    cat: 'desktop', name: 'iMac 24″',       sub: 'Blue' },
  { id: 'xdr',     cat: 'desktop', name: 'Pro Display XDR',sub: '32″ 6K' },

  { id: 'watch9',  cat: 'wearable', name: 'Apple Watch S9', sub: '45mm · Midnight' },
  { id: 'watchu',  cat: 'wearable', name: 'Apple Watch Ultra', sub: '49mm · Titanium' },
];

const SCENES = [
  { id: 'studio',  name: 'Studio',   bg: 'radial-gradient(60% 60% at 50% 50%, #1a1a22, #0a0a0c 70%)' },
  { id: 'sunset',  name: 'Sunset',   bg: 'linear-gradient(180deg, #FF7B5B, #6C2DA8 60%, #110820)' },
  { id: 'mesh',    name: 'Mesh',     bg: 'radial-gradient(60% 60% at 30% 30%, #4a78ff, #0a0a0c 60%), radial-gradient(60% 60% at 80% 70%, #c93dff, transparent 60%)' },
  { id: 'paper',   name: 'Paper',    bg: 'radial-gradient(70% 70% at 50% 50%, #f5f1ea, #d8d2c5)' },
  { id: 'gradient',name: 'Gradient', bg: 'linear-gradient(135deg, #7C5CFF, #25B5A0)' },
  { id: 'noir',    name: 'Noir',     bg: 'linear-gradient(180deg, #1a1a1f, #000)' },
  { id: 'beach',   name: 'Beach',    bg: 'linear-gradient(180deg, #B5E0FF, #FFE0B5 80%)' },
  { id: 'office',  name: 'Office',   bg: 'linear-gradient(135deg, #2C3E50, #4A6680)' },
];

function PresetsModal({ onClose, onPick, currentDevice, currentScene }) {
  const [tab, setTab] = useState('phone');
  const [picked, setPicked] = useState(currentDevice || 'iphone15pro');
  const [pickedScene, setPickedScene] = useState(currentScene || 'studio');

  const filtered = DEVICES.filter(d => d.cat === tab);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: 'min(820px, 92vw)' }} onClick={e => e.stopPropagation()}>
        <div className="modal-hd">
          <div>
            <h2>Devices & scenes</h2>
            <p>Choose the device frame and background scene for your mockup.</p>
          </div>
          <button className="modal-x" onClick={onClose}><window.I name="x" /></button>
        </div>
        <div className="modal-bd">
          <div className="dev-tabs">
            {['phone','laptop','tablet','desktop','wearable'].map(c => (
              <button key={c} className={'dev-tab' + (tab === c ? ' on' : '')} onClick={() => setTab(c)}>
                {c === 'phone' ? 'Phones'
                  : c === 'laptop' ? 'Laptops'
                  : c === 'tablet' ? 'Tablets'
                  : c === 'desktop' ? 'Displays'
                  : 'Wearables'}
              </button>
            ))}
          </div>

          <div className="dev-grid">
            {filtered.map(d => (
              <button key={d.id} className={'dev-card' + (picked === d.id ? ' on' : '')}
                onClick={() => setPicked(d.id)}>
                <div className="dv-art"><DeviceArt cat={d.cat} /></div>
                <div className="dv-nm">{d.name}</div>
                <div className="dv-sub">{d.sub}</div>
              </button>
            ))}
          </div>

          <div style={{ marginTop: 22, fontSize: 11, color: 'var(--fg-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>Scene</div>
          <div className="scene-grid">
            {SCENES.map(s => (
              <button key={s.id} className={'scene-card' + (pickedScene === s.id ? ' on' : '')}
                onClick={() => setPickedScene(s.id)}
                style={{ background: s.bg }}>
                <div className="nm">{s.name}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="modal-ft">
          <span style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
            {filtered.find(d => d.id === picked)?.name} · {SCENES.find(s => s.id === pickedScene)?.name} scene
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={() => onPick(picked, pickedScene)}>Apply</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeviceArt({ cat }) {
  if (cat === 'phone') return (
    <svg width="44" height="74" viewBox="0 0 44 74">
      <rect x="2" y="2" width="40" height="70" rx="8" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.25)"/>
      <rect x="6" y="6" width="32" height="62" rx="5" fill="url(#sg1)"/>
      <defs><linearGradient id="sg1" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stopColor="#FFB199"/><stop offset="0.6" stopColor="#8E6BFF"/><stop offset="1" stopColor="#3D2D8C"/>
      </linearGradient></defs>
    </svg>
  );
  if (cat === 'laptop') return (
    <svg width="78" height="54" viewBox="0 0 78 54">
      <rect x="6" y="6" width="66" height="40" rx="3" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.25)"/>
      <rect x="9" y="9" width="60" height="34" rx="1.5" fill="url(#sg1)"/>
      <rect x="2" y="46" width="74" height="4" rx="1.5" fill="rgba(255,255,255,0.15)"/>
    </svg>
  );
  if (cat === 'tablet') return (
    <svg width="60" height="74" viewBox="0 0 60 74">
      <rect x="3" y="3" width="54" height="68" rx="5" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.25)"/>
      <rect x="6" y="6" width="48" height="62" rx="2" fill="url(#sg1)"/>
    </svg>
  );
  if (cat === 'desktop') return (
    <svg width="84" height="64" viewBox="0 0 84 64">
      <rect x="4" y="4" width="76" height="46" rx="2" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.25)"/>
      <rect x="7" y="7" width="70" height="40" rx="1" fill="url(#sg1)"/>
      <path d="M30 50 L42 60 L54 50z" fill="rgba(255,255,255,0.15)"/>
    </svg>
  );
  if (cat === 'wearable') return (
    <svg width="50" height="74" viewBox="0 0 50 74">
      <rect x="14" y="3" width="22" height="6" rx="1.5" fill="rgba(255,255,255,0.15)"/>
      <rect x="14" y="65" width="22" height="6" rx="1.5" fill="rgba(255,255,255,0.15)"/>
      <rect x="6" y="14" width="38" height="46" rx="9" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.25)"/>
      <rect x="9" y="18" width="32" height="38" rx="7" fill="url(#sg1)"/>
    </svg>
  );
  return null;
}

window.PresetsModal = PresetsModal;
