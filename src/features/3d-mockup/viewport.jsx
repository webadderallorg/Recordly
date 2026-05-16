// viewport.jsx — Three.js viewport with procedural iPhone + animated screen texture
// Exposes a single global <Viewport /> component. Keeps a render loop alive
// for the whole app lifetime.

const { useEffect, useRef, useState } = React;

// ─── Procedural "screen recording" — canvas texture ─────────────────────────
// Draws a fake iOS-style app on a 1170×2532 canvas (real iPhone ratio).
// Has a slow scrolling animation so the texture genuinely *feels* like a recording.
function makeScreenCanvas() {
  const W = 1170, H = 2532;
  const cvs = document.createElement('canvas');
  cvs.width = W; cvs.height = H;
  const ctx = cvs.getContext('2d');

  let t = 0;
  function draw() {
    // Background — warm sunrise gradient
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#FFB199');
    g.addColorStop(0.35, '#FF7B8B');
    g.addColorStop(0.7,  '#8E6BFF');
    g.addColorStop(1,    '#3D2D8C');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Soft "sun" highlight
    const sun = ctx.createRadialGradient(W*0.78, H*0.18, 0, W*0.78, H*0.18, 800);
    sun.addColorStop(0, 'rgba(255,240,200,0.55)');
    sun.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H);

    // Status bar
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.font = '600 52px -apple-system, "SF Pro Display", system-ui';
    ctx.textBaseline = 'top';
    ctx.fillText('9:41', 95, 60);
    // Right side: signal/wifi/battery — simple glyphs
    // wifi
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(W - 380 + i*22, 90 - i*12, 16, 12 + i*12);
    }
    ctx.fill();
    // battery
    ctx.strokeStyle = 'rgba(255,255,255,0.96)'; ctx.lineWidth = 5;
    ctx.strokeRect(W - 195, 70, 130, 56);
    ctx.fillRect(W - 60, 84, 6, 28);
    ctx.fillRect(W - 190, 75, 100, 46);

    // Dynamic island
    ctx.fillStyle = 'rgba(0,0,0,0.92)';
    roundRect(ctx, W/2 - 175, 50, 350, 110, 55, true, false);

    // Greeting block
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = '500 44px -apple-system, system-ui';
    ctx.fillText('Tuesday, October 14', 80, 240);
    ctx.font = '700 110px -apple-system, "SF Pro Display", system-ui';
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.fillText('Good morning,', 80, 300);
    ctx.fillText('Alex', 80, 430);

    // Scrolling card stack
    const cardY = 640 - (t * 0.6) % 200;
    drawCard(cardY +    0, 'Today\u2019s focus', 'Design review at 2:00 PM', '#FFC7B5', '#FF7B8B');
    drawCard(cardY +  330, 'Weather',         '72° · Sunny in Brooklyn',   '#9BD6FF', '#5390FF');
    drawCard(cardY +  660, 'Now playing',     'Tycho — Awake (Live)',      '#C9F0E0', '#39B58B');
    drawCard(cardY +  990, 'Steps',           '4,288 of 8,000 today',      '#FFE2A6', '#F0A030');
    drawCard(cardY + 1320, 'Calendar',        '3 events · 2 messages',     '#E2D2FF', '#7C5CFF');
    drawCard(cardY + 1650, 'Inbox',           '12 unread · 4 important',   '#FFD2EF', '#E36CB0');

    // Bottom dock
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    roundRect(ctx, 70, H - 260, W - 140, 180, 38, true, false);
    for (let i = 0; i < 4; i++) {
      const x = 130 + i * ((W - 260) / 4);
      const colors = ['#FF6B6B', '#5C9CFF', '#65D49C', '#FFC857'];
      ctx.fillStyle = colors[i];
      roundRect(ctx, x, H - 220, 100, 100, 24, true, false);
    }
    // Home indicator
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    roundRect(ctx, W/2 - 140, H - 30, 280, 10, 5, true, false);

    function drawCard(y, title, body, c1, c2) {
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      roundRect(ctx, 75, y + 8, W - 150, 300, 44, true, false);
      // glassy card
      const cg = ctx.createLinearGradient(0, y, 0, y + 300);
      cg.addColorStop(0, c1);
      cg.addColorStop(1, c2);
      ctx.fillStyle = cg;
      roundRect(ctx, 70, y, W - 140, 300, 44, true, false);

      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '600 42px -apple-system, system-ui';
      ctx.fillText(title, 130, y + 60);
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.font = '700 64px -apple-system, "SF Pro Display", system-ui';
      ctx.fillText(body, 130, y + 130);

      // small icon stub
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(W - 200, y + 150, 70, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  function roundRect(c, x, y, w, h, r, fill, stroke) {
    if (typeof r === 'number') r = { tl: r, tr: r, br: r, bl: r };
    c.beginPath();
    c.moveTo(x + r.tl, y);
    c.lineTo(x + w - r.tr, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r.tr);
    c.lineTo(x + w, y + h - r.br);
    c.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
    c.lineTo(x + r.bl, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r.bl);
    c.lineTo(x, y + r.tl);
    c.quadraticCurveTo(x, y, x + r.tl, y);
    c.closePath();
    if (fill) c.fill();
    if (stroke) c.stroke();
  }

  draw();
  return {
    canvas: cvs,
    tick(dt) { t += dt * 60; draw(); }, // 60 "units/sec"
  };
}

// ─── iPhone geometry — rounded box with screen, dynamic island, camera bump ─
function makeIPhone(THREE, screenTexture) {
  const group = new THREE.Group();

  // Real iPhone 15 Pro is ~146.6mm × 70.6mm × 8.25mm
  // Use scene units = cm so values are readable. 1 unit = 1 cm.
  const W = 7.06, H = 14.66, D = 0.825;
  const R = 1.10; // corner radius (front profile)

  // Body: extruded rounded rect with bevel for the rounded edges
  const shape = new THREE.Shape();
  const r = R;
  const x = -W/2, y = -H/2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + W - r, y);
  shape.quadraticCurveTo(x + W, y, x + W, y + r);
  shape.lineTo(x + W, y + H - r);
  shape.quadraticCurveTo(x + W, y + H, x + W - r, y + H);
  shape.lineTo(x + r, y + H);
  shape.quadraticCurveTo(x, y + H, x, y + H - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);

  const extrudeSettings = {
    depth: D - 0.3,
    bevelEnabled: true,
    bevelThickness: 0.15,
    bevelSize: 0.15,
    bevelSegments: 8,
    curveSegments: 24,
  };
  const bodyGeom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  bodyGeom.center();

  // Titanium-ish material
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x2c2c30,
    metalness: 0.85,
    roughness: 0.32,
  });
  const body = new THREE.Mesh(bodyGeom, bodyMat);
  body.castShadow = true; body.receiveShadow = true;
  group.add(body);

  // Front bezel (slightly inset, deep black)
  const bezelShape = new THREE.Shape();
  const bw = W - 0.2, bh = H - 0.2, br = R - 0.05;
  const bx = -bw/2, by = -bh/2;
  bezelShape.moveTo(bx + br, by);
  bezelShape.lineTo(bx + bw - br, by);
  bezelShape.quadraticCurveTo(bx + bw, by, bx + bw, by + br);
  bezelShape.lineTo(bx + bw, by + bh - br);
  bezelShape.quadraticCurveTo(bx + bw, by + bh, bx + bw - br, by + bh);
  bezelShape.lineTo(bx + br, by + bh);
  bezelShape.quadraticCurveTo(bx, by + bh, bx, by + bh - br);
  bezelShape.lineTo(bx, by + br);
  bezelShape.quadraticCurveTo(bx, by, bx + br, by);
  const bezelGeom = new THREE.ShapeGeometry(bezelShape, 24);
  const bezelMat = new THREE.MeshStandardMaterial({
    color: 0x06060a, metalness: 0.4, roughness: 0.55,
  });
  const bezel = new THREE.Mesh(bezelGeom, bezelMat);
  bezel.position.z = D/2 + 0.001;
  group.add(bezel);

  // Screen plane — slightly inset from bezel
  const screenW = W - 0.5, screenH = H - 0.55;
  const sShape = new THREE.Shape();
  const sr = R - 0.25;
  const sx = -screenW/2, sy = -screenH/2;
  sShape.moveTo(sx + sr, sy);
  sShape.lineTo(sx + screenW - sr, sy);
  sShape.quadraticCurveTo(sx + screenW, sy, sx + screenW, sy + sr);
  sShape.lineTo(sx + screenW, sy + screenH - sr);
  sShape.quadraticCurveTo(sx + screenW, sy + screenH, sx + screenW - sr, sy + screenH);
  sShape.lineTo(sx + sr, sy + screenH);
  sShape.quadraticCurveTo(sx, sy + screenH, sx, sy + screenH - sr);
  sShape.lineTo(sx, sy + sr);
  sShape.quadraticCurveTo(sx, sy, sx + sr, sy);
  const screenGeom = new THREE.ShapeGeometry(sShape, 24);
  // Map UVs so the canvas covers the screen
  const sBox = new THREE.Box3().setFromBufferAttribute(screenGeom.attributes.position);
  const sW = sBox.max.x - sBox.min.x, sH = sBox.max.y - sBox.min.y;
  const uvAttr = screenGeom.attributes.uv;
  const pos = screenGeom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), py = pos.getY(i);
    uvAttr.setXY(i, (px - sBox.min.x) / sW, (py - sBox.min.y) / sH);
  }
  uvAttr.needsUpdate = true;

  const screenMat = new THREE.MeshBasicMaterial({
    map: screenTexture,
    toneMapped: false,
  });
  const screen = new THREE.Mesh(screenGeom, screenMat);
  screen.position.z = D/2 + 0.003;
  group.add(screen);

  // Glossy glass overlay on screen (transparent, just for highlight)
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0.0,
    roughness: 0.05,
    transmission: 0.0,
    transparent: true,
    opacity: 0.04,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
  });
  const glass = new THREE.Mesh(screenGeom.clone(), glassMat);
  glass.position.z = D/2 + 0.004;
  group.add(glass);

  // Camera bump (back). Two lenses + flash.
  const bumpGroup = new THREE.Group();
  const bumpGeom = new THREE.BoxGeometry(2.6, 2.6, 0.45);
  bumpGeom.translate(0, 0, 0.225);
  // round corners faked via scale (cheap)
  const bumpMat = new THREE.MeshStandardMaterial({
    color: 0x202024, metalness: 0.7, roughness: 0.35,
  });
  const bump = new THREE.Mesh(bumpGeom, bumpMat);
  bump.position.set(-W/2 + 2.0, H/2 - 2.0, -D/2 - 0.001);
  bump.rotation.y = Math.PI; // back side
  bumpGroup.add(bump);

  const lensMat = new THREE.MeshStandardMaterial({
    color: 0x0a0a0e, metalness: 0.5, roughness: 0.2,
  });
  const lensGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0x1a1a26, metalness: 0.2, roughness: 0.15,
    clearcoat: 1.0, clearcoatRoughness: 0.05,
  });
  function makeLens(cx, cy) {
    const lg = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 32), lensMat);
    ring.rotation.x = Math.PI/2;
    lg.add(ring);
    const glass2 = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.42, 32), lensGlassMat);
    glass2.rotation.x = Math.PI/2;
    lg.add(glass2);
    lg.position.set(cx, cy, -D/2 - 0.45);
    bumpGroup.add(lg);
  }
  makeLens(-W/2 + 1.4, H/2 - 1.4);
  makeLens(-W/2 + 2.6, H/2 - 1.4);
  makeLens(-W/2 + 2.0, H/2 - 2.6);

  // Small flash dot
  const flash = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.32, 24),
    new THREE.MeshStandardMaterial({ color: 0xfffae0, metalness: 0.1, roughness: 0.4, emissive: 0x222018 })
  );
  flash.rotation.x = Math.PI/2;
  flash.position.set(-W/2 + 2.6, H/2 - 2.6, -D/2 - 0.35);
  bumpGroup.add(flash);
  group.add(bumpGroup);

  // Side buttons (volume + side button) — pure aesthetic
  const btnMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, metalness: 0.85, roughness: 0.3 });
  const sideBtn = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2, 0.4), btnMat);
  sideBtn.position.set( W/2 + 0.04, 1.0, 0);
  group.add(sideBtn);
  const vol1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 0.4), btnMat);
  vol1.position.set(-W/2 - 0.04, 1.6, 0);
  group.add(vol1);
  const vol2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 0.4), btnMat);
  vol2.position.set(-W/2 - 0.04, -0.2, 0);
  group.add(vol2);
  const muteSwitch = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.3), btnMat);
  muteSwitch.position.set(-W/2 - 0.02, 3.4, 0);
  group.add(muteSwitch);

  return group;
}

// ─── Main Viewport component ───────────────────────────────────────────────
function Viewport({ time, playing, accent, scene }) {
  const mountRef = useRef(null);
  const stateRef = useRef(null);

  useEffect(() => {
    const THREE = window.THREE;
    const mount = mountRef.current;
    if (!THREE || !mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const scene3 = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 1000);
    camera.position.set(0, 0, 38);
    camera.lookAt(0, 0, 0);

    // Screen texture
    const screenSrc = makeScreenCanvas();
    const tex = new THREE.CanvasTexture(screenSrc.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy?.() || 8;
    tex.needsUpdate = true;

    // iPhone
    const phone = makeIPhone(THREE, tex);
    phone.position.set(0, 0, 0);
    scene3.add(phone);

    // Lighting — Apple product photography look
    scene3.add(new THREE.AmbientLight(0xffffff, 0.25));

    const hemi = new THREE.HemisphereLight(0xfff5ee, 0x202030, 0.55);
    scene3.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(-8, 12, 14);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1; key.shadow.camera.far = 60;
    key.shadow.camera.left = -15; key.shadow.camera.right = 15;
    key.shadow.camera.top = 15; key.shadow.camera.bottom = -15;
    key.shadow.bias = -0.0005;
    scene3.add(key);

    const rim = new THREE.DirectionalLight(0xb5a1ff, 0.9);
    rim.position.set(12, -4, -6);
    scene3.add(rim);

    const fill = new THREE.DirectionalLight(0x88aaff, 0.4);
    fill.position.set(8, 6, 10);
    scene3.add(fill);

    // Ground — for soft contact shadow + reflection vibe
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.ShadowMaterial({ opacity: 0.35 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -9;
    ground.receiveShadow = true;
    scene3.add(ground);

    // Animation state — driven by parent via stateRef
    stateRef.current = {
      camYaw: -0.25, camPitch: 0.12, camDist: 38,
      phoneRotY: 0.35, phoneRotX: 0.0,
      time: 0, playing: false,
      accent: '#7C5CFF',
      scene: 'studio',
    };

    // Drag-to-orbit on the canvas (manual)
    let dragging = null;
    function onDown(e) {
      dragging = { x: e.clientX, y: e.clientY,
        yaw: stateRef.current.camYaw, pitch: stateRef.current.camPitch };
    }
    function onMove(e) {
      if (!dragging) return;
      const dx = (e.clientX - dragging.x) / 200;
      const dy = (e.clientY - dragging.y) / 200;
      stateRef.current.camYaw = dragging.yaw - dx;
      stateRef.current.camPitch = Math.max(-0.6, Math.min(0.8, dragging.pitch + dy));
    }
    function onUp() { dragging = null; }
    function onWheel(e) {
      e.preventDefault();
      stateRef.current.camDist = Math.max(18, Math.min(70, stateRef.current.camDist + e.deltaY * 0.04));
    }
    renderer.domElement.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    // Resize
    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(mount);

    // Render loop
    let last = performance.now();
    let raf = 0;
    function loop() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const s = stateRef.current;
      // Continuously update screen texture for that "recording" feel
      screenSrc.tick(dt * 0.5);
      tex.needsUpdate = true;

      // Soft idle drift + animation when "playing"
      if (s.playing) {
        s.time += dt;
      }

      // Keyframed motion — a simple choreographed animation:
      // 0–2s: rotate-in from -45°; 2–4s: settle; 4–6s: tilt + dolly; loops.
      const t = (s.time % 6.0);
      const ease = (x) => 1 - Math.pow(1 - x, 3);
      let kfYaw = 0.35, kfPitch = 0.05, kfDist = 38, kfRotZ = 0;
      if (t < 2.0) {
        const u = ease(t / 2.0);
        kfYaw = -0.9 + u * 1.25;
        kfPitch = 0.3 - u * 0.25;
        kfDist = 50 - u * 12;
      } else if (t < 4.0) {
        const u = ease((t - 2.0) / 2.0);
        kfYaw = 0.35 - u * 0.05;
        kfPitch = 0.05 + u * 0.08;
        kfDist = 38 - u * 4;
      } else {
        const u = ease((t - 4.0) / 2.0);
        kfYaw = 0.30 + u * 0.4;
        kfPitch = 0.13 - u * 0.08;
        kfDist = 34 + u * 6;
        kfRotZ = u * -0.12;
      }

      // Blend keyframed motion with user drag (drag wins more when active)
      const finalYaw = s.playing ? kfYaw : s.camYaw;
      const finalPitch = s.playing ? kfPitch : s.camPitch;
      const finalDist = s.playing ? kfDist : s.camDist;

      camera.position.x = Math.sin(finalYaw) * Math.cos(finalPitch) * finalDist;
      camera.position.y = Math.sin(finalPitch) * finalDist;
      camera.position.z = Math.cos(finalYaw) * Math.cos(finalPitch) * finalDist;
      camera.lookAt(0, 0, 0);

      phone.rotation.z = kfRotZ;
      // small ambient float
      phone.position.y = Math.sin(now / 1800) * 0.15;

      // Accent rim light
      try {
        const c = new THREE.Color(s.accent);
        rim.color.copy(c);
      } catch (e) {}

      renderer.render(scene3, camera);
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  // Sync props → state ref
  useEffect(() => {
    if (!stateRef.current) return;
    stateRef.current.playing = !!playing;
    stateRef.current.time = (time ?? 0);
    if (accent) stateRef.current.accent = accent;
    if (scene) stateRef.current.scene = scene;
  }, [time, playing, accent, scene]);

  // Scene background based on selected scene preset
  const bg = (() => {
    switch (scene) {
      case 'studio':
        return 'radial-gradient(60% 60% at 50% 50%, #1a1a22 0%, #0a0a0c 70%)';
      case 'sunset':
        return 'radial-gradient(80% 60% at 50% 100%, #ff7b5b 0%, #6c2da8 60%, #110820 100%)';
      case 'mesh':
        return 'radial-gradient(60% 60% at 30% 30%, #4a78ff 0%, #0a0a0c 60%), radial-gradient(60% 60% at 80% 70%, #c93dff 0%, #0a0a0c 60%)';
      case 'paper':
        return 'radial-gradient(70% 70% at 50% 50%, #f5f1ea 0%, #d8d2c5 100%)';
      default:
        return 'radial-gradient(60% 60% at 50% 50%, #1a1a22 0%, #0a0a0c 70%)';
    }
  })();

  return (
    <div className="vp-wrap" style={{ background: bg }}>
      <div className="vp-grid" />
      <div ref={mountRef} className="vp-canvas" />
    </div>
  );
}

window.Viewport = Viewport;
