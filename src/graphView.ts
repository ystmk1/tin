import * as THREE from "three";
import { BookNote, GraphBasis } from "./types";
import { buildGraph } from "./graph";
import { getMetadata } from "./note-metadata";

export interface GraphHandle {
  /** Tear down the WebGL scene. */
  cleanup: () => void;
  /**
   * Dim every node not in `highlightIds`, plus any link touching a dimmed
   * node. Pass `null` to clear (restore full brightness).
   */
  setHighlight: (highlightIds: Set<string> | null) => void;
  /** Re-read cover colours and repaint the stars (after a cover is linked). */
  recolor: () => void;
}

// --- space look ---------------------------------------------------------
const HEIGHT = 260;
// Notes with no cover colour shine a pale starlight blue-white.
const DEFAULT_STAR = new THREE.Color("#cfe0ff");
const LINK_COLOR = new THREE.Color("#7e90c0"); // faint blue-grey threads

const DIM_NODE = 0.12;
const DIM_LINK = 0.1;

// Stars sit in a spherical shell around the camera, which rests at the centre
// and looks outward — like lying back and looking up at the sky.
const R_MIN = 130;
const R_MAX = 340;

/** Crisp star sprite: solid bright core with a tight, faint halo. */
function makeStarTexture(): THREE.Texture {
  const s = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, "rgba(255,255,255,1)");
  g.addColorStop(0.14, "rgba(255,255,255,1)");
  g.addColorStop(0.26, "rgba(255,255,255,0.55)");
  g.addColorStop(0.5, "rgba(255,255,255,0.12)");
  g.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Cover tint "r,g,b" → a vivid (high-saturation) star colour. */
function coverStarColor(filePath: string): THREE.Color | null {
  const raw = getMetadata(filePath)?.coverColor;
  if (!raw) return null;
  const p = raw.split(",").map((n) => parseFloat(n) / 255);
  if (p.length < 3 || p.some((v) => Number.isNaN(v))) return null;
  const c = new THREE.Color(p[0], p[1], p[2]);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.7 + 0.2), Math.min(0.72, Math.max(0.55, hsl.l)));
  return c;
}

interface StarNode {
  id: string;
  title: string;
  degree: number;
  filePath: string;
  pos: THREE.Vector3; // fixed position in the field's local space
}

export function renderGraph(
  container: HTMLElement,
  books: BookNote[],
  onOpen: (path: string) => void,
  basis: GraphBasis = "both",
): GraphHandle {
  const { nodes: rawNodes, links: rawLinks } = buildGraph(books, basis);

  let width = container.clientWidth || 800;
  container.style.height = `${HEIGHT}px`;
  container.style.position = "relative";

  const maxDeg = Math.max(1, ...rawNodes.map((n) => n.degree));
  const heat = (deg: number) => Math.sqrt(deg / maxDeg); // 0..1, connectivity
  // Connectivity barely nudges size and brightness.
  const starSize = (deg: number) => 8 + 4 * heat(deg);
  const baseOpacity = (deg: number) => 0.82 + 0.18 * heat(deg);
  const starColorFor = (filePath: string, deg: number) =>
    (coverStarColor(filePath) ?? DEFAULT_STAR.clone()).multiplyScalar(0.88 + 0.12 * heat(deg));

  // Scatter each star once through the spherical shell.
  const nodes: StarNode[] = rawNodes.map((n) => {
    const r = R_MIN + (R_MAX - R_MIN) * Math.cbrt(Math.random());
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    return {
      id: n.id,
      title: n.title,
      degree: n.degree,
      filePath: n.filePath,
      pos: new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
      ),
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = rawLinks
    .map((l) => ({ s: byId.get(l.source as string), t: byId.get(l.target as string) }))
    .filter((l): l is { s: StarNode; t: StarNode } => !!l.s && !!l.t);

  // --- three.js scene -----------------------------------------------------
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, width / HEIGHT, 0.1, 4000);
  camera.rotation.order = "YXZ";
  let yaw = 0;
  let pitch = 0;
  // Distance the camera sits *behind* the origin along its view axis. 0 = at
  // the centre looking out (immersive sky); large = backed out beyond the
  // shell, the whole field in front (overview). Wheel scrubs between them.
  const DIST_MAX = R_MAX * 2.6;
  let dist = R_MAX * 1.6; // start backed out enough to see everything
  const forward = new THREE.Vector3();

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, HEIGHT);
  renderer.domElement.className = "dokki-graph-canvas";
  container.appendChild(renderer.domElement);

  // The field holds stars + links and drifts slowly so the sky turns overhead.
  const field = new THREE.Group();
  scene.add(field);

  // Links — straight, hair-thin dashed lines, kept very faint so they barely
  // register against the stars (the dots are far heavier than the threads).
  const linkGeo = new THREE.BufferGeometry();
  const lPos = new Float32Array(links.length * 6);
  const lCol = new Float32Array(links.length * 6);
  linkGeo.setAttribute("position", new THREE.BufferAttribute(lPos, 3));
  linkGeo.setAttribute("color", new THREE.BufferAttribute(lCol, 3));
  const linkLines = new THREE.LineSegments(
    linkGeo,
    new THREE.LineDashedMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      dashSize: 2.2,
      gapSize: 4.5,
      depthWrite: false,
    }),
  );
  field.add(linkLines);

  const linkPos = linkGeo.getAttribute("position") as THREE.BufferAttribute;

  // Stars — one additive sprite each.
  const starTex = makeStarTexture();
  const sprites: THREE.Sprite[] = nodes.map((n) => {
    const mat = new THREE.SpriteMaterial({
      map: starTex,
      color: starColorFor(n.filePath, n.degree),
      transparent: true,
      opacity: baseOpacity(n.degree),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sp = new THREE.Sprite(mat);
    const sz = starSize(n.degree);
    sp.scale.set(sz, sz, 1);
    sp.position.copy(n.pos);
    sp.userData.node = n;
    field.add(sp);
    return sp;
  });

  // --- hover label (HTML overlay) ----------------------------------------
  const label = document.createElement("div");
  label.className = "dokki-graph-label";
  label.style.display = "none";
  container.appendChild(label);

  // --- highlight state ----------------------------------------------------
  let highlight: Set<string> | null = null;
  let hoverId: string | null = null;
  const idIndex = new Map(nodes.map((n, i) => [n.id, i]));
  const isLit = (id: string) => !highlight || highlight.size === 0 || highlight.has(id);

  function applyNodeStyle(i: number) {
    if (i < 0) return;
    const n = nodes[i];
    const sp = sprites[i];
    const lit = isLit(n.id);
    const hovered = hoverId === n.id;
    const mat = sp.material as THREE.SpriteMaterial;
    mat.opacity = lit ? Math.min(1, baseOpacity(n.degree) * (hovered ? 1.2 : 1)) : DIM_NODE;
    const sz = starSize(n.degree) * (hovered && lit ? 1.35 : 1);
    sp.scale.set(sz, sz, 1);
  }

  function applyLinkColors() {
    const col = linkGeo.getAttribute("color") as THREE.BufferAttribute;
    for (let i = 0; i < links.length; i++) {
      const lit = isLit(links[i].s.id) && isLit(links[i].t.id);
      const k = lit ? 1 : DIM_LINK;
      const r = LINK_COLOR.r * k;
      const g = LINK_COLOR.g * k;
      const b = LINK_COLOR.b * k;
      col.setXYZ(i * 2, r, g, b);
      col.setXYZ(i * 2 + 1, r, g, b);
    }
    col.needsUpdate = true;
  }

  const setHighlight = (ids: Set<string> | null): void => {
    highlight = ids;
    for (let i = 0; i < nodes.length; i++) applyNodeStyle(i);
    applyLinkColors();
  };

  // --- pointer interaction (raycast pick / look-around / zoom) ------------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const hitWorld = new THREE.Vector3();

  let dragging = false; // turning the view (empty-space drag)
  let dragNode: StarNode | null = null; // pulling a star (Obsidian-style)
  let tapNode: StarNode | null = null;
  let settleUntil = 0; // keep the springs running briefly after release
  let lastX = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;
  let moved = false;

  // Soft springs let neighbours trail a pulled note. They run only while a
  // drag is active (plus a short settle), so the idle starfield stays put.
  const REST = 130;
  const STIFF = 0.08;

  function setPointer(e: PointerEvent) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  function pickNode(): StarNode | null {
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(sprites, false);
    return hits.length ? (hits[0].object.userData.node as StarNode) : null;
  }

  /** Cursor position projected onto the plane (facing camera) through `at`. */
  function cursorOnPlaneThrough(at: THREE.Vector3): THREE.Vector3 | null {
    dragPlane.setFromNormalAndCoplanarPoint(forward, at);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.ray.intersectPlane(dragPlane, hitWorld);
  }

  const onPointerDown = (e: PointerEvent) => {
    setPointer(e);
    downX = lastX = e.clientX;
    downY = lastY = e.clientY;
    moved = false;
    const node = pickNode();
    tapNode = node;
    if (node) {
      dragNode = node; // grab the star
    } else {
      dragging = true; // empty space → turn the view
    }
    label.style.display = "none";
    renderer.domElement.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    setPointer(e);
    if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 4) moved = true;

    if (dragNode) {
      // Pull the star: project the cursor onto the plane through it, then
      // store the result in the field's local space (the field is rotating).
      const at = field.localToWorld(dragNode.pos.clone());
      const p = cursorOnPlaneThrough(at);
      if (p) field.worldToLocal(p);
      if (p) dragNode.pos.copy(p);
      return;
    }
    if (dragging) {
      // Drag turns the view — look around the sky.
      yaw -= (e.clientX - lastX) * 0.005;
      pitch = Math.max(-1.3, Math.min(1.3, pitch - (e.clientY - lastY) * 0.005));
      lastX = e.clientX;
      lastY = e.clientY;
      return;
    }

    // Plain hover → label + glow bump.
    const node = pickNode();
    const id = node && isLit(node.id) ? node.id : null;
    if (id !== hoverId) {
      const prev = hoverId;
      hoverId = id;
      if (prev) applyNodeStyle(idIndex.get(prev) ?? -1);
      if (id) applyNodeStyle(idIndex.get(id) ?? -1);
    }
    if (node && id) {
      label.textContent = node.title;
      label.style.display = "block";
      const r = renderer.domElement.getBoundingClientRect();
      label.style.left = `${e.clientX - r.left + 10}px`;
      label.style.top = `${e.clientY - r.top - 6}px`;
      renderer.domElement.style.cursor = "pointer";
    } else {
      label.style.display = "none";
      renderer.domElement.style.cursor = "grab";
    }
  };

  const endPointer = (e: PointerEvent) => {
    // A tap (no real movement) on a star opens it.
    if (!moved && tapNode) onOpen(tapNode.filePath);
    if (dragNode) settleUntil = performance.now() + 1100; // let neighbours settle
    tapNode = null;
    dragNode = null;
    dragging = false;
    try {
      renderer.domElement.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // Scroll out → pull the camera back past the shell; scroll in → toward
    // the centre for the immersive sky view.
    dist = Math.min(DIST_MAX, Math.max(0, dist + e.deltaY * 0.6));
  };

  const cv = renderer.domElement;
  cv.style.cursor = "grab";
  cv.addEventListener("pointerdown", onPointerDown);
  cv.addEventListener("pointermove", onPointerMove);
  cv.addEventListener("pointerup", endPointer);
  cv.addEventListener("pointercancel", endPointer);
  cv.addEventListener("wheel", onWheel, { passive: false });

  // Write current node positions into the sprites + straight link segments;
  // dashes need line distances recomputed whenever endpoints move.
  function syncField() {
    for (let i = 0; i < nodes.length; i++) sprites[i].position.copy(nodes[i].pos);
    for (let i = 0; i < links.length; i++) {
      const a = links[i].s.pos;
      const b = links[i].t.pos;
      linkPos.setXYZ(i * 2, a.x, a.y, a.z);
      linkPos.setXYZ(i * 2 + 1, b.x, b.y, b.z);
    }
    linkPos.needsUpdate = true;
    if (links.length) linkLines.computeLineDistances();
  }

  // One gentle spring pass: each link tugs its endpoints toward REST length,
  // the pulled node stays pinned — so neighbours trail it elastically.
  function relax() {
    for (const { s, t } of links) {
      const dx = t.pos.x - s.pos.x;
      const dy = t.pos.y - s.pos.y;
      const dz = t.pos.z - s.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 1e-3) continue;
      const f = ((d - REST) / d) * STIFF * 0.5;
      const mx = dx * f;
      const my = dy * f;
      const mz = dz * f;
      if (s !== dragNode) {
        s.pos.x += mx;
        s.pos.y += my;
        s.pos.z += mz;
      }
      if (t !== dragNode) {
        t.pos.x -= mx;
        t.pos.y -= my;
        t.pos.z -= mz;
      }
    }
  }

  // --- per-frame: drift the field, aim the camera, render ----------------
  applyLinkColors();
  let raf = 0;
  let last = performance.now();
  const tick = () => {
    raf = requestAnimationFrame(tick);
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    field.rotation.y += dt * 0.05;
    field.rotation.x += dt * 0.012;
    if (dragNode || now < settleUntil) relax();
    syncField();
    // Face direction D (yaw/pitch); sit at -D*dist so the origin — and thus
    // the whole shell — stays centred ahead, however far we back out.
    camera.rotation.set(pitch, yaw, 0);
    forward.set(0, 0, -1).applyEuler(camera.rotation);
    camera.position.copy(forward).multiplyScalar(-dist);
    renderer.render(scene, camera);
  };
  tick();

  const ro = new ResizeObserver(() => {
    width = container.clientWidth || width;
    camera.aspect = width / HEIGHT;
    camera.updateProjectionMatrix();
    renderer.setSize(width, HEIGHT);
  });
  ro.observe(container);

  return {
    cleanup: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener("pointerdown", onPointerDown);
      cv.removeEventListener("pointermove", onPointerMove);
      cv.removeEventListener("pointerup", endPointer);
      cv.removeEventListener("pointercancel", endPointer);
      cv.removeEventListener("wheel", onWheel);
      label.remove();
      sprites.forEach((s) => (s.material as THREE.SpriteMaterial).dispose());
      starTex.dispose();
      linkGeo.dispose();
      (linkLines.material as THREE.Material).dispose();
      // dispose() alone leaks the GL context; force it so repeated reloads
      // (login swaps the view several times) don't exhaust the browser limit.
      renderer.forceContextLoss();
      renderer.dispose();
      cv.remove();
    },
    setHighlight,
    recolor: () => {
      for (let i = 0; i < nodes.length; i++) {
        (sprites[i].material as THREE.SpriteMaterial).color.copy(starColorFor(nodes[i].filePath, nodes[i].degree));
      }
    },
  };
}
