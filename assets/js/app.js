/**
 * Pulsar Galaxy Explorer — Three.js Frontend v2.0
 * Fetches data from /api/stars, renders with InstancedMesh per class
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { PPdotDiagram } from './ppdot.js';
import { TourEngine, TOUR_DEFS } from './tours.js';

// ── Class definitions ─────────────────────────────────────────────────────────
const CLASS_DEF = {
  CANONICAL:     { color: 0x4488ff, size: 0.18, label: 'Canonical Pulsar' },
  RECYCLED_MSP:  { color: 0xffd700, size: 0.14, label: 'Recycled MSP' },
  FAST_MSP:      { color: 0xffaa00, size: 0.13, label: 'Fast MSP' },
  MAGNETAR:      { color: 0xff2244, size: 0.30, label: 'Magnetar' },
  RRAT:          { color: 0xaa44ff, size: 0.22, label: 'RRAT' },
  ISOLATED_NS:   { color: 0xccddee, size: 0.16, label: 'Isolated NS' },
  CCO:           { color: 0x7799aa, size: 0.17, label: 'CCO' },
  BINARY_PULSAR: { color: 0x00ffcc, size: 0.20, label: 'Binary Pulsar' },
};
const CLASS_ORDER = Object.keys(CLASS_DEF);

// The 14 pulsars on the Pioneer plaque / Voyager Golden Record map (Drake, 1972).
// Identification per https://www.johnstonsarchive.net/astro/pulsarmap.html
const VOYAGER_PULSARS = new Set([
  'J1731-4744', // B1727-47
  'J1456-6843', // B1451-68
  'J1243-6423', // B1240-64
  'J0835-4510', // B0833-45  (Vela)
  'J0953+0755', // B0950+08
  'J0826+2637', // B0823+26
  'J0534+2200', // B0531+21  (Crab)
  'J0528+2200', // B0525+21
  'J0332+5434', // B0329+54
  'J2219+4754', // B2217+47
  'J2018+2839', // B2016+28
  'J1935+1616', // B1933+16
  'J1932+1059', // B1929+10
  'J1645-0317', // B1642-03
]);

const CLASS_DESCRIPTIONS = {
  CANONICAL: (s) => `A normal rotation-powered pulsar spinning ${s.p0 ? 'once every ' + s.p0.toFixed(3) + ' seconds' : 'at a typical rate'}. These are the most common neutron stars — collapsed stellar cores left behind after a supernova explosion. They beam radio waves like a cosmic lighthouse.`,
  RECYCLED_MSP: (s) => `A millisecond pulsar spun up by stealing mass from a binary companion, recycled to extraordinary speeds. At ${s.p0 ? (1/s.p0).toFixed(0) + ' rotations per second' : 'millisecond periods'}, it's one of nature's most stable clocks — more regular than an atomic clock.`,
  FAST_MSP: (s) => `A solitary millisecond pulsar — once in a binary system, its companion was likely evaporated by pulsar wind. Now spinning ${s.p0 ? 'at ' + (1/s.p0).toFixed(0) + ' Hz' : 'hundreds of times per second'}, it carries the momentum of its violent past.`,
  MAGNETAR: (s) => `An ultra-magnetized neutron star with fields ${s.bsurf_g ? 'of 10¹⁴–¹⁵ Gauss — trillions of times Earth\'s field' : 'far beyond ordinary pulsars'}. Magnetars occasionally unleash colossal gamma-ray flares visible across the galaxy, releasing more energy in seconds than the Sun emits in centuries.`,
  RRAT: (s) => `A Rotating Radio Transient — a neutron star that only occasionally emits detectable radio pulses, perhaps only a few times per hour. Whether RRATs are a distinct population or an extreme tail of normal pulsars remains an open question.`,
  ISOLATED_NS: (s) => `An X-ray Isolated Neutron Star: thermally cooling and radio-quiet, detected only by its soft X-ray glow as residual heat from the supernova slowly radiates away. These objects give us a direct window into the neutron star cooling equation.`,
  CCO: (s) => `A Central Compact Object — a neutron star at the center of a supernova remnant, quietly cooling without observable radio or gamma-ray emission. Its origin and internal physics remain actively debated.`,
  BINARY_PULSAR: (s) => `A pulsar in orbit with a companion star. Binary pulsars are precision laboratories for testing general relativity: the famous Hulse-Taylor pulsar earned a Nobel Prize by showing the orbit shrinking exactly as Einstein's theory predicts from gravitational wave emission.`,
};

// ── Global state ──────────────────────────────────────────────────────────────
let scene, camera, renderer, controls, composer, bloomPass, clock;
let instancedMeshes = {};      // { CLASS: THREE.InstancedMesh }
let starArrays = {};           // { CLASS: [star, ...] }
let allStars = [];             // flat array of all stars
let visibleFlags = [];         // parallel to allStars
let starIndexMap = new Map();  // jname → {star, classIdx, localIdx}

let selectedStar = null;
let hoveredInfo = null;
let animT = 0;

// P-Ṗ diagram
let ppdotDiagram = null;
let ppdotActive = false;
let ppdotCrosslinkedStar = null;

// Tour engine
let tourEngine = null;
let tourNarrationTimer = null;

// Camera transition
let camTarget = { pos: new THREE.Vector3(), lookAt: new THREE.Vector3() };
let camTransitioning = false;
let camTransitionT = 0;
let camTransitionDuration = 1.8;
let camFromPos = new THREE.Vector3();
let camFromLookAt = new THREE.Vector3();
let camToPos = new THREE.Vector3();
let camToLookAt = new THREE.Vector3();

// Audio
let audioCtx = null;
let audioEnabled = false;
let activeOsc = null;
let hoverOsc = null;

// Filter state (defaults match slider initial values in HTML)
let filterState = {
  classes: new Set(CLASS_ORDER),
  periodMin: 1e-3,    // 10^-3 s
  periodMax: 32,       // 10^1.5 s
  distMin: 0,
  distMax: 100,        // show everything by default (slider display is informational)
  bfieldMin: 1e8,
  bfieldMax: 1e15,
  voyagerOnly: false, // when true, show only the 14 Pioneer/Voyager map pulsars
};

// FPS tracking
let frameCount = 0, lastFPSTime = 0, fps = 0;
let researcherMode = false;

// Dummy for matrix updates
const dummy = new THREE.Object3D();

// ── Init ─────────────────────────────────────────────────────────────────────
let webglOk = false;

async function init() {
  // Step 1: try WebGL — non-fatal if it fails (P-Ṗ diagram works without it)
  setProgress(5, 'Starting Three.js scene...');
  try {
    setupScene();
    webglOk = true;
  } catch (err) {
    console.warn('WebGL unavailable — 3D view disabled, P-Ṗ diagram still works.', err.message);
    // Hide 3D canvas, show placeholder message
    const cw = document.getElementById('canvas-wrap');
    if (cw) {
      cw.style.display = 'flex';
      cw.style.alignItems = 'center';
      cw.style.justifyContent = 'center';
      cw.innerHTML = '<div style="color:#4466aa;font-size:14px;text-align:center;padding:40px">3D view requires WebGL.<br>Use the <strong>P-Ṗ Diagram</strong> tab above.</div>';
    }
  }

  // Step 2: always load data from API
  setProgress(15, 'Fetching pulsar catalogue...');
  try {
    await loadData();
  } catch (err) {
    console.error('Failed to load data:', err);
    setStatus('Error loading data: ' + err.message);
    return;
  }

  // Step 3: 3D-specific setup only if WebGL worked
  if (webglOk) {
    setProgress(85, 'Building galaxy...');
    buildGalaxySurround();
    setProgress(92, 'Finalizing rendering...');
    setupPostProcessing();
  }

  setupUI();
  setupEventListeners();
  if (webglOk) applyFilters();

  setProgress(100, 'Ready!');
  setTimeout(fadeOutLoading, 600);

  if (webglOk) {
    clock = new THREE.Clock();
    animate();
  }

  // Deep-link: ?star=JNAME
  const deepStarName = new URLSearchParams(window.location.search).get('star');
  if (deepStarName) {
    const deepStar = starIndexMap.get(deepStarName);
    if (deepStar) {
      setTimeout(() => {
        if (webglOk) flyTo(deepStar);
        selectStar(deepStar);
      }, 800);
    }
  }
}

// ── Scene setup ───────────────────────────────────────────────────────────────
function setupScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000005);
  scene.fog = new THREE.FogExp2(0x000005, 0.004);

  const canvas = document.getElementById('three-canvas');
  const wrap = document.getElementById('canvas-wrap');

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  camera = new THREE.PerspectiveCamera(55, wrap.clientWidth / wrap.clientHeight, 0.05, 800);
  camera.position.set(0, 25, 55);
  camera.lookAt(0, 0, 0);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxDistance = 350;
  controls.minDistance = 0.5;
  controls.target.set(0, 0, 0);

  window.addEventListener('resize', onResize);
}

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadData() {
  const res = await fetch('/api/stars');
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const { stars, count } = await res.json();

  setStatus(`Building ${count.toLocaleString()} neutron stars...`);
  document.getElementById('loading-count').textContent = `${count.toLocaleString()} objects`;

  // Group by class
  CLASS_ORDER.forEach(cls => { starArrays[cls] = []; });
  allStars = stars;

  stars.forEach((star, idx) => {
    const cls = CLASS_DEF[star.ns_class] ? star.ns_class : 'CANONICAL';
    star._cls = cls;
    star._localIdx = starArrays[cls].length;
    star._globalIdx = idx;
    starArrays[cls].push(star);
    starIndexMap.set(star.jname, star);
  });

  setProgress(50, 'Creating instanced meshes...');

  // Build one InstancedMesh per class
  const baseGeo = new THREE.SphereGeometry(1, 6, 6);

  CLASS_ORDER.forEach((cls, ci) => {
    const arr = starArrays[cls];
    if (!arr.length) return;
    const def = CLASS_DEF[cls];
    setProgress(50 + ci * 4, `Loading ${def.label}...`);

    const mat = new THREE.MeshBasicMaterial({
      color: def.color,
      transparent: true,
      opacity: cls === 'MAGNETAR' ? 0.95 : 0.80,
    });

    const mesh = new THREE.InstancedMesh(baseGeo, mat, arr.length);
    mesh.userData.cls = cls;
    mesh.frustumCulled = false;

    arr.forEach((star, i) => {
      positionDummy(star, def.size, 0);
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = arr.length;

    instancedMeshes[cls] = mesh;
    scene.add(mesh);
  });

  // Update star count badge
  document.getElementById('star-count-badge').textContent = `${count.toLocaleString()} neutron stars`;
  setProgress(80, 'Positioning stars...');
}

function positionDummy(star, size, phase) {
  const x = star.x_kpc || 0;
  const y = star.y_kpc || 0;
  const z = star.z_kpc || 0;
  dummy.position.set(x, y, z);
  dummy.scale.setScalar(size);
  dummy.rotation.set(0, 0, 0);
  dummy.updateMatrix();
}

// ── Galaxy surroundings ───────────────────────────────────────────────────────
function buildGalaxySurround() {
  // Background star field — 60k particles
  const N = 60000;
  const positions = new Float32Array(N * 3);
  const colors = new Float32Array(N * 3);

  for (let i = 0; i < N; i++) {
    // Gaussian distribution in xy, flattened in z
    const u1 = Math.random(), u2 = Math.random();
    const r = Math.sqrt(-2 * Math.log(Math.max(u1, 0.0001)));
    const angle = Math.random() * Math.PI * 2;
    const radius = r * 18;

    positions[i * 3]     = Math.cos(angle) * radius;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 4;
    positions[i * 3 + 2] = Math.sin(angle) * radius;

    // Color gradient: hot blue-white center → warm outer
    const t = Math.min(radius / 30, 1);
    colors[i * 3]     = 0.7 + t * 0.3;
    colors[i * 3 + 1] = 0.75 + t * 0.1;
    colors[i * 3 + 2] = 1.0 - t * 0.5;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.08,
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    sizeAttenuation: true,
    depthWrite: false,
  });

  scene.add(new THREE.Points(geo, mat));

  // Galactic plane disc
  const discGeo = new THREE.CircleGeometry(45, 64);
  const discMat = new THREE.MeshBasicMaterial({
    color: 0x223355,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.rotation.x = Math.PI / 2;
  scene.add(disc);

  // Spiral arm traces (4 arms, parametric)
  const armAngles = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2];
  const armColors = [0x334466, 0x334466, 0x334466, 0x334466];
  armAngles.forEach((startAngle, ai) => {
    const pts = [];
    for (let t = 0; t <= 1; t += 0.01) {
      const r = 3 + t * 38;
      const theta = startAngle + t * 3.5;
      pts.push(new THREE.Vector3(
        Math.cos(theta) * r,
        (Math.random() - 0.5) * 0.3,
        Math.sin(theta) * r
      ));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const armGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(200));
    const armMat = new THREE.LineBasicMaterial({
      color: armColors[ai],
      transparent: true,
      opacity: 0.20,
      depthWrite: false,
    });
    scene.add(new THREE.Line(armGeo, armMat));
  });

  // Sun marker
  const sunGeo = new THREE.SphereGeometry(0.25, 8, 8);
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xffee88 });
  const sun = new THREE.Mesh(sunGeo, sunMat);
  sun.position.set(8.5, 0, 0);  // Sun ~8.5 kpc from GC
  scene.add(sun);
  addLabel('☉ Sun', new THREE.Vector3(8.5, 0.6, 0), 0xffee88);

  // Galactic centre marker
  const gcGeo = new THREE.SphereGeometry(0.5, 8, 8);
  const gcMat = new THREE.MeshBasicMaterial({ color: 0xff8833 });
  scene.add(new THREE.Mesh(gcGeo, gcMat));
  addLabel('Galactic Centre', new THREE.Vector3(0, 1.0, 0), 0xff8833);

  // Galactic coordinate grid (30° spacing)
  buildCoordinateGrid();
}

function addLabel(text, pos, color) {
  // Use a sprite for labels
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.font = 'bold 28px "Space Grotesk", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 32);

  const tex = new THREE.CanvasTexture(canvas);
  const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.8, depthWrite: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.position.copy(pos);
  sprite.scale.set(6, 1.5, 1);
  sprite.userData.isLabel = true;
  scene.add(sprite);
}

function buildCoordinateGrid() {
  const mat = new THREE.LineBasicMaterial({ color: 0x112233, transparent: true, opacity: 0.3, depthWrite: false });
  const R = 50;
  // Longitude lines every 30°
  for (let gl = 0; gl < 360; gl += 30) {
    const rad = gl * Math.PI / 180;
    const pts = [
      new THREE.Vector3(Math.cos(rad) * -R, 0, Math.sin(rad) * -R),
      new THREE.Vector3(Math.cos(rad) * R, 0, Math.sin(rad) * R),
    ];
    scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts), mat
    ));
  }
  // Two latitude circles
  [-10, 10].forEach(gb => {
    const y = R * Math.sin(gb * Math.PI / 180);
    const r = R * Math.cos(gb * Math.PI / 180);
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  });
}

// ── Post-processing ───────────────────────────────────────────────────────────
function setupPostProcessing() {
  const wrap = document.getElementById('canvas-wrap');
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(wrap.clientWidth, wrap.clientHeight),
    0.8, 0.5, 0.1
  );
  composer.addPass(bloomPass);
}

// ── Filters ───────────────────────────────────────────────────────────────────
function applyFilters() {
  let visible = 0;
  CLASS_ORDER.forEach(cls => {
    const mesh = instancedMeshes[cls];
    if (!mesh) return;
    const arr = starArrays[cls];
    const clsOn = filterState.classes.has(cls);

    arr.forEach((star, i) => {
      // Voyager selection overrides every other filter: show exactly those 14
      const show = filterState.voyagerOnly
        ? VOYAGER_PULSARS.has(star.jname)
        : clsOn
        && (star.p0 == null || (star.p0 >= filterState.periodMin && star.p0 <= filterState.periodMax))
        && (star.dist_kpc == null || (star.dist_kpc >= filterState.distMin && star.dist_kpc <= filterState.distMax))
        && (star.bsurf_g == null || (star.bsurf_g >= filterState.bfieldMin && star.bsurf_g <= filterState.bfieldMax));

      const s = show ? CLASS_DEF[cls].size : 0;
      dummy.position.set(star.x_kpc || 0, star.y_kpc || 0, star.z_kpc || 0);
      dummy.scale.setScalar(s);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      star._visible = show;
      if (show) visible++;
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  document.getElementById('visible-count-display').textContent = `Showing ${visible.toLocaleString()} objects`;
}

// ── Animation loop ────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  animT += delta;

  // FPS
  frameCount++;
  if (animT - lastFPSTime >= 1) {
    fps = frameCount;
    frameCount = 0;
    lastFPSTime = animT;
    if (researcherMode) {
      document.getElementById('fps-display').textContent = `${fps} FPS`;
    }
  }

  // Tour engine takes full camera control when active
  if (tourEngine && tourEngine.active) {
    tourEngine.tick(delta);
  } else if (camTransitioning) {
    // Camera transition (flyTo)
    camTransitionT += delta / camTransitionDuration;
    const t = easeInOutCubic(Math.min(camTransitionT, 1));
    camera.position.lerpVectors(camFromPos, camToPos, t);
    const lk = new THREE.Vector3().lerpVectors(camFromLookAt, camToLookAt, t);
    controls.target.copy(lk);
    if (camTransitionT >= 1) {
      camTransitioning = false;
      controls.enabled = true;
    }
  }

  // Animate instanced meshes
  animateClasses(delta);

  controls.update();
  composer.render();
}

function animateClasses(delta) {
  // MAGNETAR: pulsing glow
  const magMesh = instancedMeshes['MAGNETAR'];
  if (magMesh) {
    const pulse = 1.0 + 0.35 * Math.sin(animT * 1.8);
    magMesh.material.opacity = 0.7 + 0.25 * Math.abs(Math.sin(animT * 1.8));
    magMesh.material.needsUpdate = true;
  }

  // RRAT: intermittent visibility
  const rratMesh = instancedMeshes['RRAT'];
  if (rratMesh) {
    const arr = starArrays['RRAT'];
    arr.forEach((star, i) => {
      if (!star._visible) return;
      const phase = i * 2.31 + animT * 0.7;
      const fade = Math.max(0, Math.sin(phase));
      const s = CLASS_DEF['RRAT'].size * fade;
      dummy.position.set(star.x_kpc || 0, star.y_kpc || 0, star.z_kpc || 0);
      dummy.scale.setScalar(s);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      rratMesh.setMatrixAt(i, dummy.matrix);
    });
    rratMesh.instanceMatrix.needsUpdate = true;
  }

  // RECYCLED_MSP: fast spin glow
  const mspMesh = instancedMeshes['RECYCLED_MSP'];
  if (mspMesh) {
    const glow = 0.7 + 0.3 * Math.abs(Math.sin(animT * 3));
    mspMesh.material.opacity = glow;
    mspMesh.material.needsUpdate = true;
  }

  // Highlight selected star
  if (selectedStar) {
    const cls = selectedStar._cls;
    const mesh = instancedMeshes[cls];
    if (mesh) {
      const def = CLASS_DEF[cls];
      const pulseSel = def.size * (2.0 + 0.4 * Math.sin(animT * 4));
      dummy.position.set(selectedStar.x_kpc || 0, selectedStar.y_kpc || 0, selectedStar.z_kpc || 0);
      dummy.scale.setScalar(pulseSel);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(selectedStar._localIdx, dummy.matrix);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ── Raycasting ────────────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
raycaster.params.Points = { threshold: 0.5 };
const pointer = new THREE.Vector2();

function getCanvasPointer(event) {
  const wrap = document.getElementById('canvas-wrap');
  const rect = wrap.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function getHoveredStar(event) {
  getCanvasPointer(event);
  raycaster.setFromCamera(pointer, camera);

  const meshList = CLASS_ORDER.map(c => instancedMeshes[c]).filter(Boolean);
  const hits = raycaster.intersectObjects(meshList);

  if (!hits.length) return null;
  const hit = hits[0];
  const cls = hit.object.userData.cls;
  const star = starArrays[cls]?.[hit.instanceId];
  if (!star || !star._visible) return null;
  return { star, hit };
}

// ── Event listeners ───────────────────────────────────────────────────────────
function setupEventListeners() {
  const canvas = document.getElementById('three-canvas');
  let mouseDownPos = { x: 0, y: 0 };

  // Guard: 3D canvas interactions only available when WebGL works
  if (!webglOk || !canvas) {
    window.addEventListener('resize', onResize);
    document.getElementById('close-panel').addEventListener('click', deselectStar);
    setupSearch();
    setupSliders();
    return;
  }

  canvas.addEventListener('mousedown', e => {
    mouseDownPos = { x: e.clientX, y: e.clientY };
  });

  canvas.addEventListener('click', e => {
    const dx = Math.abs(e.clientX - mouseDownPos.x);
    const dy = Math.abs(e.clientY - mouseDownPos.y);
    if (dx > 4 || dy > 4) return; // was a drag

    const result = getHoveredStar(e);
    if (result) {
      selectStar(result.star);
    } else {
      deselectStar();
    }
  });

  canvas.addEventListener('mousemove', e => {
    const result = getHoveredStar(e);
    const label = document.getElementById('hover-label');

    if (result) {
      const { star } = result;
      label.textContent = `${star.jname}  ·  ${CLASS_DEF[star._cls]?.label || star._cls}`;
      label.style.left = e.clientX - document.getElementById('canvas-wrap').getBoundingClientRect().left + 'px';
      label.style.top = e.clientY - document.getElementById('canvas-wrap').getBoundingClientRect().top + 'px';
      label.classList.add('visible');

      // Update HUD
      document.getElementById('hud-gl').textContent = star.gl != null ? `Gl ${star.gl.toFixed(1)}°` : 'Gl —';
      document.getElementById('hud-gb').textContent = star.gb != null ? `Gb ${star.gb.toFixed(2)}°` : 'Gb —';

      // Hover audio
      if (audioEnabled && star !== hoveredInfo?.star) {
        playHoverTone(star.audio_freq);
      }
      hoveredInfo = result;
    } else {
      label.classList.remove('visible');
      hoveredInfo = null;
      stopHoverTone();
    }
  });

  canvas.addEventListener('mouseleave', () => {
    document.getElementById('hover-label').classList.remove('visible');
    stopHoverTone();
    hoveredInfo = null;
  });
}

// ── Star selection ────────────────────────────────────────────────────────────
function selectStar(star) {
  // Restore previous
  if (selectedStar) restoreStarSize(selectedStar);
  selectedStar = star;
  showDetailPanel(star);
  stopHoverTone();
  if (audioEnabled) playClickTone(star.audio_freq);
  // Cross-link: highlight on P-Ṗ diagram if open
  if (ppdotDiagram) ppdotDiagram.highlight(star.jname);
  // Update URL for shareability
  const url = new URL(window.location.href);
  url.searchParams.set('star', star.jname);
  history.replaceState(null, '', url.toString());
}

function deselectStar() {
  if (selectedStar) {
    restoreStarSize(selectedStar);
    selectedStar = null;
  }
  document.getElementById('detail-panel').classList.remove('open');
  document.getElementById('ppdot-wrap').classList.remove('panel-open');
  stopClickTone();
  // Clear star from URL
  const url = new URL(window.location.href);
  url.searchParams.delete('star');
  history.replaceState(null, '', url.searchParams.toString() ? url.toString() : window.location.pathname);
}

function restoreStarSize(star) {
  const mesh = instancedMeshes[star._cls];
  if (!mesh) return;
  const def = CLASS_DEF[star._cls];
  const show = star._visible ? def.size : 0;
  dummy.position.set(star.x_kpc || 0, star.y_kpc || 0, star.z_kpc || 0);
  dummy.scale.setScalar(show);
  dummy.rotation.set(0, 0, 0);
  dummy.updateMatrix();
  mesh.setMatrixAt(star._localIdx, dummy.matrix);
  mesh.instanceMatrix.needsUpdate = true;
}

// ── Camera fly-to ─────────────────────────────────────────────────────────────
function flyTo(star) {
  if (!star) return;
  const target = new THREE.Vector3(star.x_kpc || 0, star.y_kpc || 0, star.z_kpc || 0);
  const dir = camera.position.clone().sub(target).normalize();
  const newPos = target.clone().addScaledVector(dir, 8);

  camFromPos.copy(camera.position);
  camFromLookAt.copy(controls.target);
  camToPos.copy(newPos);
  camToLookAt.copy(target);
  camTransitionT = 0;
  camTransitioning = true;
  controls.enabled = false;
}

// ── View modes ────────────────────────────────────────────────────────────────
function setViewMode(mode) {
  controls.enabled = true;
  camTransitioning = false;

  camFromPos.copy(camera.position);
  camFromLookAt.copy(controls.target);

  if (mode === 'galaxy') {
    camToPos.set(0, 25, 55);
    camToLookAt.set(0, 0, 0);
  } else if (mode === 'topdown') {
    camToPos.set(0, 80, 0.01);
    camToLookAt.set(0, 0, 0);
  } else if (mode === 'edgeon') {
    camToPos.set(0, 1, 80);
    camToLookAt.set(0, 0, 0);
  }

  camTransitionT = 0;
  camTransitioning = true;
  controls.enabled = false;
}

// ── Detail panel ──────────────────────────────────────────────────────────────
async function showDetailPanel(star) {
  const panel = document.getElementById('detail-panel');
  panel.classList.add('open');
  // Shrink P-Ṗ canvas if it's the active view
  if (ppdotActive) {
    document.getElementById('ppdot-wrap').classList.add('panel-open');
    setTimeout(resizePpdotCanvas, 320); // after CSS transition
  }

  // Basic info from cache
  const cls = star._cls;
  const def = CLASS_DEF[cls];

  document.getElementById('panel-jname').textContent = star.jname;
  const badge = document.getElementById('panel-class-badge');
  badge.textContent = def.label;
  badge.className = `panel-badge badge-${cls}`;

  // PUBLIC view
  fillPublicView(star);

  // Researcher view — fetch full detail
  if (researcherMode) {
    fillResearcherView(star);
    const detail = await fetchStarDetail(star.jname);
    if (detail) fillResearcherView(detail);
  }
}

function fillPublicView(star) {
  const cls = star._cls;

  // Spin stat
  const spinEl = document.getElementById('public-spin-stat');
  if (star.p0) {
    const hz = 1 / star.p0;
    if (hz >= 1) {
      spinEl.textContent = `Spins ${hz.toFixed(1)} times per second`;
    } else {
      spinEl.textContent = `One rotation every ${star.p0.toFixed(2)} seconds`;
    }
  } else {
    spinEl.textContent = 'Period unknown';
  }

  // Distance
  const distEl = document.getElementById('public-distance');
  if (star.dist_kpc) {
    const ly = (star.dist_kpc * 3261.56).toFixed(0);
    const event = getHistoricalEvent(star.dist_kpc);
    distEl.innerHTML = `📍 <strong>${parseFloat(ly).toLocaleString()} light-years away</strong><br>
      <span style="font-size:12px">Light now reaching us left ${event}</span>`;
  } else {
    distEl.textContent = '📍 Distance unknown';
  }

  // B-field
  const bEl = document.getElementById('public-bfield');
  if (star.bsurf_g) {
    const earthRatio = (star.bsurf_g / 0.5).toExponential(1);
    bEl.innerHTML = `🧲 <strong>${earthRatio}× Earth's magnetic field</strong><br>
      <span style="font-size:12px">${star.bsurf_g.toExponential(2)} Gauss</span>`;
  } else {
    bEl.textContent = '🧲 Magnetic field unknown';
  }

  // Discovery year
  const discEl = document.getElementById('public-discovery');
  if (star.discovery_year) {
    discEl.textContent = `🔭 Discovered in ${star.discovery_year}`;
  } else {
    discEl.textContent = '';
  }

  // Description
  const descFn = CLASS_DESCRIPTIONS[cls] || (() => 'A compact neutron star remnant.');
  document.getElementById('public-description').textContent = descFn(star);

  // Magnetar outburst note
  const magEl = document.getElementById('magnetar-outburst');
  if (cls === 'MAGNETAR' && star.last_outburst_year) {
    magEl.textContent = `⚡ Last known outburst: ${star.last_outburst_year}`;
    magEl.classList.remove('hidden');
  } else {
    magEl.classList.add('hidden');
  }
}

function fillResearcherView(star) {
  const fmt = (v, d=4) => v != null ? v.toFixed(d) : '—';
  const sci = (v) => v != null ? v.toExponential(3) : '—';

  document.getElementById('r-p0').textContent = star.p0 != null ? `${(star.p0 * 1000).toFixed(4)} ms` : '—';
  document.getElementById('r-p1').textContent = star.p1 != null ? star.p1.toExponential(3) : '—';
  document.getElementById('r-dm').textContent = star.dm != null ? `${star.dm.toFixed(2)} cm⁻³pc` : '—';
  document.getElementById('r-logb').textContent = star.bsurf_g != null ? Math.log10(star.bsurf_g).toFixed(2) : '—';
  document.getElementById('r-age').textContent = star.age_yr != null ? sci(star.age_yr) + ' yr' : '—';
  document.getElementById('r-edot').textContent = star.edot_ergs != null ? sci(star.edot_ergs) + ' erg/s' : '—';
  document.getElementById('r-dist').textContent = star.dist_kpc != null ? `${star.dist_kpc.toFixed(3)} kpc` : '—';
  document.getElementById('r-nglitch').textContent = star.nglitch != null ? star.nglitch : '—';
  document.getElementById('r-binary').textContent = star.binary_model || '—';
  document.getElementById('r-class').textContent = star.ns_class || star._cls || '—';
  document.getElementById('r-coords').textContent = (star.gl != null && star.gb != null)
    ? `l=${star.gl.toFixed(2)}° b=${star.gb.toFixed(3)}°` : '—';
  document.getElementById('r-assoc').textContent = star.assoc || '—';

  const atnfLink = document.getElementById('atnf-link');
  atnfLink.href = `https://www.atnf.csiro.au/research/pulsar/psrcat/proc_form.php?Type=normal&Name=${encodeURIComponent(star.jname)}`;
}

async function fetchStarDetail(jname) {
  try {
    const res = await fetch(`/api/stars/${encodeURIComponent(jname)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function getHistoricalEvent(dist_kpc) {
  const ly = dist_kpc * 3261.56;
  const yearAgo = Math.round(ly);
  const year = 2024 - yearAgo;

  if (ly < 50) return `just ${yearAgo} years ago`;
  if (ly < 200) return `${yearAgo} years ago — around ${year > 0 ? year + ' CE' : Math.abs(year) + ' BCE'}`;
  if (ly < 800) return `${yearAgo} years ago (${year > 0 ? year + ' CE' : Math.abs(year) + ' BCE'} — Medieval period)`;
  if (ly < 1500) return `${yearAgo} years ago (${year > 0 ? year + ' CE' : Math.abs(year) + ' BCE'} — Age of Antiquity)`;
  if (ly < 4000) return `${yearAgo} years ago — during ancient Egyptian civilization`;
  if (ly < 12000) return `${yearAgo} years ago — dawn of human civilization`;
  if (ly < 40000) return `${yearAgo} years ago — last Ice Age`;
  if (ly < 100000) return `${yearAgo} years ago — early Homo sapiens`;
  return `${(ly / 1000).toFixed(0)}k years ago — deep prehistoric time`;
}

// ── UI Setup ─────────────────────────────────────────────────────────────────
function setupUI() {
  // Fetch stats for class counts
  fetch('/api/stats').then(r => r.json()).then(data => {
    buildClassFilters(data.counts);
  });

  // View tabs
  document.querySelectorAll('.view-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      if (view === 'ppdot') {
        activatePpdot();
      } else {
        deactivatePpdot();
        setViewMode(view);
      }
    });
  });

  // Researcher mode toggle
  document.getElementById('researcher-mode').addEventListener('change', e => {
    researcherMode = e.target.checked;
    document.getElementById('fps-display').classList.toggle('hidden', !researcherMode);
    document.getElementById('public-view').classList.toggle('hidden', researcherMode);
    document.getElementById('researcher-view').classList.toggle('hidden', !researcherMode);
    if (selectedStar && researcherMode) {
      fetchStarDetail(selectedStar.jname).then(d => { if (d) fillResearcherView(d); });
    }
  });

  // Audio toggle
  document.getElementById('audio-toggle').addEventListener('click', () => {
    audioEnabled = !audioEnabled;
    const btn = document.getElementById('audio-toggle');
    btn.textContent = audioEnabled ? '🔊' : '🔇';
    btn.classList.toggle('active', audioEnabled);
    if (audioEnabled) initAudio();
  });

  // Close panel
  document.getElementById('close-panel').addEventListener('click', deselectStar);

  // Share button — copy permalink to clipboard
  document.getElementById('share-btn').addEventListener('click', () => {
    if (!selectedStar) return;
    const url = new URL(window.location.href);
    url.searchParams.set('star', selectedStar.jname);
    navigator.clipboard.writeText(url.toString()).then(() => {
      const btn = document.getElementById('share-btn');
      const toast = document.getElementById('copy-toast');
      btn.textContent = '✓ Copied!';
      btn.classList.add('copied');
      toast.classList.add('visible');
      setTimeout(() => {
        btn.textContent = '🔗 Share';
        btn.classList.remove('copied');
        toast.classList.remove('visible');
      }, 2200);
    }).catch(() => {
      // Fallback: prompt with URL
      prompt('Copy this link:', url.toString());
    });
  });

  // Play audio buttons
  ['play-audio-btn', 'play-audio-btn-r'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      if (!selectedStar) return;
      initAudio();
      audioEnabled = true;
      document.getElementById('audio-toggle').textContent = '🔊';
      playClickTone(selectedStar.audio_freq, 3);
    });
  });

  // Sliders
  setupSliders();

  // Search
  setupSearch();

  // Random
  document.getElementById('random-btn').addEventListener('click', () => {
    const visibleStars = allStars.filter(s => s._visible);
    if (!visibleStars.length) return;
    const star = visibleStars[Math.floor(Math.random() * visibleStars.length)];
    flyTo(star);
    selectStar(star);
  });

  // Reset filters
  document.getElementById('reset-filters').addEventListener('click', resetFilters);

  // Voyager / Pioneer map selection
  document.getElementById('voyager-only').addEventListener('change', e => {
    filterState.voyagerOnly = e.target.checked;
    document.getElementById('sidebar').classList.toggle('voyager-active', e.target.checked);
    applyFilters();
  });

  // Tours
  setupTours();
}

// ── Cinematic Tours ───────────────────────────────────────────────────────────
function setupTours() {
  // Build tour cards
  const container = document.getElementById('tour-cards');
  if (!container) return;
  TOUR_DEFS.forEach(def => {
    const mins = Math.floor(def.duration / 60);
    const secs = def.duration % 60;
    const durLabel = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

    const card = document.createElement('div');
    card.className = 'tour-card';
    card.style.setProperty('--tour-color', def.color);
    card.innerHTML = `
      <div class="tour-card-icon">${def.icon}</div>
      <div class="tour-card-name">${def.name}</div>
      <div class="tour-card-tagline">${def.tagline}</div>
      <p class="tour-card-desc">${def.description}</p>
      <div class="tour-card-footer">
        <span class="tour-card-duration">~${durLabel}</span>
        <button class="tour-start-btn" style="background:${def.color}">Begin Tour</button>
      </div>`;

    card.querySelector('.tour-start-btn').addEventListener('click', e => {
      e.stopPropagation();
      closeTourOverlay();
      if (webglOk) startTour(def.id);
    });
    container.appendChild(card);
  });

  // Open / close tour overlay
  document.getElementById('tours-btn').addEventListener('click', () => {
    document.getElementById('tour-overlay').classList.remove('hidden');
  });
  document.getElementById('tour-overlay-close').addEventListener('click', closeTourOverlay);
  document.getElementById('tour-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('tour-overlay')) closeTourOverlay();
  });

  // HUD controls
  document.getElementById('tour-stop-btn').addEventListener('click', stopTour);
  document.getElementById('tour-pause-btn').addEventListener('click', () => {
    if (!tourEngine) return;
    if (tourEngine.paused) {
      tourEngine.resume();
      document.getElementById('tour-pause-btn').textContent = '⏸';
    } else {
      tourEngine.pause();
      document.getElementById('tour-pause-btn').textContent = '▶';
    }
  });
  document.getElementById('tour-next-btn').addEventListener('click', () => {
    if (tourEngine) tourEngine.skip();
  });
  document.getElementById('tour-prev-btn').addEventListener('click', () => {
    // Restart current tour from beginning
    if (tourEngine && tourEngine._tour) startTour(tourEngine._tour.id);
  });
}

function closeTourOverlay() {
  document.getElementById('tour-overlay').classList.add('hidden');
}

function startTour(tourId) {
  if (!webglOk) return;
  if (!tourEngine) {
    tourEngine = new TourEngine(camera, controls);
  }

  // Ensure we're in galaxy 3D view
  if (ppdotActive) deactivatePpdot();
  document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
  document.querySelector('.view-tab[data-view="galaxy"]').classList.add('active');

  // Hide sidebar for immersion
  document.getElementById('sidebar').classList.add('tour-hidden');
  // Hide detail panel
  deselectStar();
  // Position tour HUD left edge at 0 (no sidebar during tour)
  document.getElementById('tour-hud').style.left = '0';

  const hud = document.getElementById('tour-hud');
  hud.classList.remove('hidden');
  hud.classList.add('tour-active');

  const def = TOUR_DEFS.find(t => t.id === tourId);
  document.getElementById('tour-hud-title').textContent = `${def.icon}  ${def.name}`;
  document.getElementById('tour-hud-title').style.color = def.color;
  document.getElementById('tour-pause-btn').textContent = '⏸';

  tourEngine.start(tourId, starIndexMap, {
    onNarration: (main, sub) => {
      setTourNarration(main, sub);
    },
    onProgress: (pct, t) => {
      document.getElementById('tour-progress-bar').style.width = (pct * 100).toFixed(1) + '%';
      const rem = Math.ceil(def.duration - t);
      document.getElementById('tour-time-label').textContent =
        `${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')} remaining`;
    },
    onComplete: () => {
      endTourHud();
    },
    selectStar: (star) => {
      if (selectedStar) restoreStarSize(selectedStar);
      selectedStar = star;
      showDetailPanel(star);
      if (audioEnabled) playClickTone(star.audio_freq);
    },
    deselectStar: () => {
      deselectStar();
    },
  });
}

function stopTour() {
  if (tourEngine) tourEngine.stop();
  endTourHud();
}

function endTourHud() {
  const hud = document.getElementById('tour-hud');
  hud.classList.add('hidden');
  hud.classList.remove('tour-active');
  hud.style.left = '';
  document.getElementById('sidebar').classList.remove('tour-hidden');
  document.getElementById('tour-progress-bar').style.width = '0%';
}

function setTourNarration(main, sub) {
  const mainEl = document.getElementById('tour-narration-main');
  const subEl  = document.getElementById('tour-narration-sub');

  clearTimeout(tourNarrationTimer);
  mainEl.classList.add('fade');
  subEl.classList.add('fade');

  tourNarrationTimer = setTimeout(() => {
    mainEl.textContent = main;
    subEl.textContent  = sub;
    mainEl.classList.remove('fade');
    subEl.classList.remove('fade');
  }, 400);
}

function buildClassFilters(counts) {
  const countMap = {};
  counts.forEach(c => { countMap[c.ns_class] = c.count; });

  const container = document.getElementById('class-filters');
  container.innerHTML = '';

  CLASS_ORDER.forEach(cls => {
    const def = CLASS_DEF[cls];
    const count = countMap[cls] || 0;
    const colorHex = '#' + def.color.toString(16).padStart(6, '0');

    const row = document.createElement('label');
    row.className = 'class-row';
    row.innerHTML = `
      <input type="checkbox" checked data-cls="${cls}">
      <span class="class-dot" style="background:${colorHex}"></span>
      <span class="class-label">${def.label}</span>
      <span class="class-count">${count.toLocaleString()}</span>
    `;
    row.querySelector('input').addEventListener('change', e => {
      if (e.target.checked) filterState.classes.add(cls);
      else filterState.classes.delete(cls);
      applyFilters();
    });
    container.appendChild(row);
  });
}

function setupSliders() {
  const periodMin = document.getElementById('period-min');
  const periodMax = document.getElementById('period-max');
  const distMin = document.getElementById('dist-min');
  const distMax = document.getElementById('dist-max');
  const bfieldMin = document.getElementById('bfield-min');
  const bfieldMax = document.getElementById('bfield-max');

  function updatePeriod() {
    const lo = Math.min(parseFloat(periodMin.value), parseFloat(periodMax.value));
    const hi = Math.max(parseFloat(periodMin.value), parseFloat(periodMax.value));
    filterState.periodMin = Math.pow(10, lo);
    filterState.periodMax = Math.pow(10, hi);
    document.getElementById('period-min-label').textContent = filterState.periodMin.toExponential(1);
    document.getElementById('period-max-label').textContent = filterState.periodMax.toFixed(1);
    applyFilters();
  }

  function updateDist() {
    filterState.distMin = parseFloat(distMin.value);
    filterState.distMax = parseFloat(distMax.value);
    document.getElementById('dist-min-label').textContent = filterState.distMin.toFixed(0);
    document.getElementById('dist-max-label').textContent = filterState.distMax.toFixed(0);
    applyFilters();
  }

  function updateBfield() {
    filterState.bfieldMin = Math.pow(10, parseFloat(bfieldMin.value));
    filterState.bfieldMax = Math.pow(10, parseFloat(bfieldMax.value));
    document.getElementById('bfield-min-label').textContent = parseFloat(bfieldMin.value).toFixed(0);
    document.getElementById('bfield-max-label').textContent = parseFloat(bfieldMax.value).toFixed(0);
    applyFilters();
  }

  periodMin.addEventListener('input', updatePeriod);
  periodMax.addEventListener('input', updatePeriod);
  distMin.addEventListener('input', updateDist);
  distMax.addEventListener('input', updateDist);
  bfieldMin.addEventListener('input', updateBfield);
  bfieldMax.addEventListener('input', updateBfield);
}

function setupSearch() {
  const box = document.getElementById('search-box');
  const results = document.getElementById('search-results');
  let searchTimer = null;

  box.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = box.value.trim();
    if (q.length < 2) { results.innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        results.innerHTML = '';
        data.slice(0, 8).forEach(star => {
          const def = CLASS_DEF[star.ns_class] || CLASS_DEF.CANONICAL;
          const colorHex = '#' + def.color.toString(16).padStart(6, '0');
          const item = document.createElement('div');
          item.className = 'search-result-item';
          item.innerHTML = `<span class="sri-dot" style="background:${colorHex}"></span><span>${star.jname}</span><span style="font-size:10px;opacity:.6">${def.label}</span>`;
          item.addEventListener('click', () => {
            results.innerHTML = '';
            box.value = '';
            const cached = starIndexMap.get(star.jname);
            if (cached) {
              flyTo(cached);
              selectStar(cached);
            }
          });
          results.appendChild(item);
        });
      } catch(e) {}
    }, 250);
  });
}

function resetFilters() {
  filterState.classes = new Set(CLASS_ORDER);
  filterState.periodMin = 1e-3;
  filterState.periodMax = 32;
  filterState.distMin = 0;
  filterState.distMax = 100;
  filterState.bfieldMin = 1e8;
  filterState.bfieldMax = 1e15;
  filterState.voyagerOnly = false;

  // Reset UI
  document.querySelectorAll('#class-filters input[type=checkbox]').forEach(cb => { cb.checked = true; });
  document.getElementById('voyager-only').checked = false;
  document.getElementById('sidebar').classList.remove('voyager-active');
  document.getElementById('period-min').value = -3;
  document.getElementById('period-max').value = 1.5;
  document.getElementById('dist-min').value = 0;
  document.getElementById('dist-max').value = 30;
  document.getElementById('bfield-min').value = 8;
  document.getElementById('bfield-max').value = 15;
  document.getElementById('period-min-label').textContent = '0.001';
  document.getElementById('period-max-label').textContent = '10';
  document.getElementById('dist-min-label').textContent = '0';
  document.getElementById('dist-max-label').textContent = '30';
  document.getElementById('bfield-min-label').textContent = '8';
  document.getElementById('bfield-max-label').textContent = '15';

  applyFilters();
}

// ── Audio engine ──────────────────────────────────────────────────────────────
function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playClickTone(freq, duration = 3) {
  if (!audioCtx) return;
  stopClickTone();

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = freq > 200 ? 'sine' : 'sine';
  osc.frequency.value = Math.max(40, Math.min(2000, freq || 440));
  gain.gain.setValueAtTime(0, audioCtx.currentTime);
  gain.gain.linearRampToValueAtTime(0.25, audioCtx.currentTime + 0.05);
  gain.gain.setValueAtTime(0.25, audioCtx.currentTime + duration - 0.3);
  gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
  activeOsc = { osc, gain };
}

function stopClickTone() {
  if (activeOsc) {
    try { activeOsc.osc.stop(); } catch {}
    activeOsc = null;
  }
}

function playHoverTone(freq) {
  if (!audioCtx || !audioEnabled) return;
  stopHoverTone();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = Math.max(40, Math.min(2000, freq || 440));
  gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
  gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.12);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.15);
  hoverOsc = { osc, gain };
}

function stopHoverTone() {
  if (hoverOsc) {
    try { hoverOsc.osc.stop(); } catch {}
    hoverOsc = null;
  }
}

// ── P-Ṗ Diagram init & view toggle ───────────────────────────────────────────
function activatePpdot() {
  ppdotActive = true;
  const wrap = document.getElementById('ppdot-wrap');
  const canvasWrap = document.getElementById('canvas-wrap');
  wrap.classList.remove('hidden');
  canvasWrap.classList.add('hidden');

  const canvas = document.getElementById('ppdot-canvas');
  const rect = wrap.getBoundingClientRect();
  canvas.width  = Math.floor(rect.width  || wrap.clientWidth);
  canvas.height = Math.floor(rect.height || wrap.clientHeight);

  if (!ppdotDiagram) {
    ppdotDiagram = new PPdotDiagram(canvas, {
      onClickStar: (star) => {
        ppdotCrosslinkedStar = star;
        const banner = document.getElementById('ppdot-crosslink-banner');
        document.getElementById('ppdot-crosslink-name').textContent = star.jname;
        banner.classList.remove('hidden');
        // Also open detail panel for this star
        const cached = starIndexMap.get(star.jname);
        if (cached) {
          showDetailPanel(cached);
          document.getElementById('ppdot-wrap').classList.add('panel-open');
          resizePpdotCanvas();
        }
      },
    });
    ppdotDiagram.setData(allStars.filter(s => s.p0 && s.p1));
  } else {
    resizePpdotCanvas();
    ppdotDiagram.render();
  }

  // Re-highlight if a star was previously selected
  if (selectedStar) ppdotDiagram.highlight(selectedStar.jname);

  // "View in Galaxy" cross-link button
  document.getElementById('ppdot-goto-3d').onclick = () => {
    if (!ppdotCrosslinkedStar) return;
    const cached = starIndexMap.get(ppdotCrosslinkedStar.jname);
    // Switch to galaxy tab
    document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
    document.querySelector('.view-tab[data-view="galaxy"]').classList.add('active');
    deactivatePpdot();
    setViewMode('galaxy');
    if (cached) {
      setTimeout(() => { flyTo(cached); selectStar(cached); }, 400);
    }
  };
}

function deactivatePpdot() {
  ppdotActive = false;
  document.getElementById('ppdot-wrap').classList.add('hidden');
  document.getElementById('canvas-wrap').classList.remove('hidden');
}

function resizePpdotCanvas() {
  if (!ppdotDiagram) return;
  const wrap = document.getElementById('ppdot-wrap');
  const canvas = document.getElementById('ppdot-canvas');
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width  = w;
    canvas.height = h;
  }
  ppdotDiagram.render();
}

// ── Resize ────────────────────────────────────────────────────────────────────
function onResize() {
  if (ppdotActive) {
    resizePpdotCanvas();
    return;
  }
  const wrap = document.getElementById('canvas-wrap');
  const w = wrap.clientWidth, h = wrap.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
}

// ── Loading helpers ───────────────────────────────────────────────────────────
function setProgress(pct, msg) {
  document.getElementById('progress-bar').style.width = pct + '%';
  if (msg) setStatus(msg);
}

function setStatus(msg) {
  document.getElementById('loading-status').textContent = msg;
}

function fadeOutLoading() {
  const el = document.getElementById('loading-screen');
  el.classList.add('fade-out');
  setTimeout(() => { el.style.display = 'none'; }, 900);
}

// ── Start ─────────────────────────────────────────────────────────────────────
init().catch(err => {
  console.error('Fatal init error:', err);
  setStatus('Error: ' + err.message);
});
