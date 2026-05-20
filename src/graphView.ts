import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceX,
  forceY,
  forceCollide,
  Simulation,
  SimulationNodeDatum,
  SimulationLinkDatum,
} from "d3-force";
import * as THREE from "three";
import { BookNote, GraphBasis } from "./types";
import { buildGraph } from "./graph";
import { getMetadata } from "./note-metadata";

interface SimNode extends SimulationNodeDatum {
  id: string;
  title: string;
  degree: number;
  filePath: string;
  /** Small fixed depth offset so the field feels three-dimensional. */
  z: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
}

export interface GraphHandle {
  /** Tear down the simulation and the WebGL scene. */
  cleanup: () => void;
  /**
   * Dim every node not in `highlightIds`, plus any link touching a dimmed
   * node. Pass `null` to clear (restore full brightness). Layout is preserved
   * across highlight changes — Obsidian-style.
   */
  setHighlight: (highlightIds: Set<string> | null) => void;
  /** Re-read cover colours and repaint the stars (after a cover is linked). */
  recolor: () => void;
}

// --- space look ---------------------------------------------------------
const HEIGHT = 260;
// Notes with no cover colour shine a pale starlight blue-white.
const DEFAULT_STAR = new THREE.Color("#cfe0ff");
const LINK_BASE = new THREE.Color("#6f86c9");

const DIM_NODE = 0.12;
const DIM_LINK = 0.1;

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
  // Push saturation up and keep lightness in a bright, star-like band.
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.7 + 0.2), Math.min(0.72, Math.max(0.55, hsl.l)));
  return c;
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

  const nodes: SimNode[] = rawNodes.map((n) => ({
    id: n.id,
    title: n.title,
    degree: n.degree,
    filePath: n.filePath,
    z: (Math.random() - 0.5) * 36,
  }));
  const links: SimLink[] = rawLinks.map((l) => ({ source: l.source, target: l.target }));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const maxDeg = Math.max(1, ...nodes.map((n) => n.degree));
  const heat = (d: SimNode) => Math.sqrt(d.degree / maxDeg); // 0..1, connectivity
  // Connectivity barely nudges size and brightness — stars stay even, the
  // well-connected ones just shine a touch more.
  const starSize = (d: SimNode) => 7 + 2.5 * heat(d);
  const baseOpacity = (d: SimNode) => 0.82 + 0.18 * heat(d);
  // Cover tint (vivid) when known, else pale starlight; brightness lifts only
  // slightly with connectivity.
  const starColor = (d: SimNode) =>
    (coverStarColor(d.filePath) ?? DEFAULT_STAR.clone()).multiplyScalar(0.88 + 0.12 * heat(d));

  // With connections off the field is a free-floating, slowly rotating
  // starfield (example-style); with connections on it's a force-directed web
  // laid out on the z=0 plane (draggable). `rotating` switches between them.
  const rotating = basis === "off";

  // --- d3-force layout (only when connections are shown) ------------------
  let sim: Simulation<SimNode, SimLink> | null = null;
  if (!rotating) {
    sim = forceSimulation(nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance((l) => {
            const s = l.source as SimNode;
            const t = l.target as SimNode;
            return 48 + 55 / Math.max(1, (s.degree + t.degree) / 2);
          })
          .strength(0.32),
      )
      .force("charge", forceManyBody().strength((d) => -55 - 55 * heat(d as SimNode)))
      .force("center", forceCenter(0, 0).strength(0.04))
      .force("x", forceX(0).strength((d) => 0.02 + 0.18 * ((d as SimNode).degree / maxDeg)))
      .force("y", forceY(0).strength((d) => 0.04 + 0.25 * ((d as SimNode).degree / maxDeg)))
      .force("collide", forceCollide<SimNode>((d) => starSize(d as SimNode) * 0.6 + 9));
  }

  // --- three.js scene -----------------------------------------------------
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, width / HEIGHT, 1, 8000);
  camera.position.set(0, 0, 320);
  const MIN_Z = 140;
  const MAX_Z = 900;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, HEIGHT);
  renderer.domElement.className = "dokki-graph-canvas";
  container.appendChild(renderer.domElement);

  // Links — one additive line-segment mesh; per-link colour carries dimming.
  const linkGeo = new THREE.BufferGeometry();
  const lPos = new Float32Array(links.length * 6);
  const lCol = new Float32Array(links.length * 6);
  linkGeo.setAttribute("position", new THREE.BufferAttribute(lPos, 3));
  linkGeo.setAttribute("color", new THREE.BufferAttribute(lCol, 3));
  const linkLines = new THREE.LineSegments(
    linkGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  scene.add(linkLines);

  // Nodes — one additive star sprite each (note counts are small).
  const starTex = makeStarTexture();
  const nodeGroup = new THREE.Group();
  scene.add(nodeGroup);
  const sprites: THREE.Sprite[] = nodes.map((n) => {
    const mat = new THREE.SpriteMaterial({
      map: starTex,
      color: starColor(n),
      transparent: true,
      opacity: baseOpacity(n),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sp = new THREE.Sprite(mat);
    const sz = starSize(n);
    sp.scale.set(sz, sz, 1);
    sp.userData.node = n;
    nodeGroup.add(sp);
    return sp;
  });

  // Off mode: scatter the stars once through a 3D sphere; the whole group
  // then turns slowly. (Connected mode positions come from the sim each tick.)
  if (rotating) {
    const R = 130;
    for (const sp of sprites) {
      const r = R * Math.cbrt(Math.random());
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      sp.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
      );
    }
  }

  // --- hover label (HTML overlay) ----------------------------------------
  const label = document.createElement("div");
  label.className = "dokki-graph-label";
  label.style.display = "none";
  container.appendChild(label);

  // --- highlight state ----------------------------------------------------
  let highlight: Set<string> | null = null;
  let hoverId: string | null = null;

  const isLit = (id: string) => !highlight || highlight.size === 0 || highlight.has(id);

  function applyNodeStyle(i: number) {
    const n = nodes[i];
    const sp = sprites[i];
    const lit = isLit(n.id);
    const hovered = hoverId === n.id;
    const mat = sp.material as THREE.SpriteMaterial;
    mat.opacity = lit ? Math.min(1, baseOpacity(n) * (hovered ? 1.2 : 1)) : DIM_NODE;
    const sz = starSize(n) * (hovered && lit ? 1.35 : 1);
    sp.scale.set(sz, sz, 1);
  }

  function applyLinkColors() {
    const col = linkGeo.getAttribute("color") as THREE.BufferAttribute;
    for (let i = 0; i < links.length; i++) {
      const s = links[i].source as SimNode;
      const t = links[i].target as SimNode;
      const lit = isLit(s.id) && isLit(t.id);
      const k = lit ? 0.55 : DIM_LINK;
      const r = LINK_BASE.r * k;
      const g = LINK_BASE.g * k;
      const b = LINK_BASE.b * k;
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

  // --- pointer interaction (raycast pick / drag / pan / zoom) -------------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hitPoint = new THREE.Vector3();

  let dragNode: SimNode | null = null;
  let tapNode: SimNode | null = null; // pressed node, opens on tap (both modes)
  let panning = false;
  let lastX = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;
  let moved = false;

  function setPointer(e: PointerEvent) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  function pickNode(): { sprite: THREE.Sprite; node: SimNode } | null {
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(sprites, false);
    if (!hits.length) return null;
    const sprite = hits[0].object as THREE.Sprite;
    return { sprite, node: sprite.userData.node as SimNode };
  }

  /** World point under the cursor on the z=0 plane. */
  function planePoint(): THREE.Vector3 | null {
    raycaster.setFromCamera(pointer, camera);
    return raycaster.ray.intersectPlane(dragPlane, hitPoint);
  }

  const onPointerDown = (e: PointerEvent) => {
    setPointer(e);
    downX = e.clientX;
    downY = e.clientY;
    lastX = e.clientX;
    lastY = e.clientY;
    moved = false;
    const hit = pickNode();
    tapNode = hit ? hit.node : null;
    if (hit && sim) {
      // Connected mode: grab the node so the layout follows the cursor.
      dragNode = hit.node;
      dragNode.fx = dragNode.x;
      dragNode.fy = dragNode.y;
      sim.alphaTarget(0.3).restart();
    } else {
      // Off mode (or empty space): a drag pans the camera; a tap still opens.
      panning = true;
    }
    label.style.display = "none";
    renderer.domElement.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    setPointer(e);
    if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 4) moved = true;

    if (dragNode) {
      const p = planePoint();
      if (p) {
        dragNode.fx = p.x;
        dragNode.fy = -p.y; // world Y is the negated sim Y
      }
      return;
    }
    if (panning) {
      // Move the camera so the world appears to drag with the cursor.
      const k = (camera.position.z * 2 * Math.tan((camera.fov * Math.PI) / 360)) / HEIGHT;
      camera.position.x -= (e.clientX - lastX) * k;
      camera.position.y += (e.clientY - lastY) * k;
      lastX = e.clientX;
      lastY = e.clientY;
      return;
    }

    // Plain hover → label + glow bump.
    const hit = pickNode();
    const id = hit && isLit(hit.node.id) ? hit.node.id : null;
    if (id !== hoverId) {
      const prev = hoverId;
      hoverId = id;
      if (prev) applyNodeStyle(nodes.findIndex((n) => n.id === prev));
      if (id) applyNodeStyle(nodes.findIndex((n) => n.id === id));
    }
    if (hit && id) {
      label.textContent = hit.node.title;
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
    if (dragNode && sim) {
      sim.alphaTarget(0);
      dragNode.fx = null;
      dragNode.fy = null;
      dragNode = null;
    }
    // A tap (no real movement) on a node opens it — in either mode.
    if (!moved && tapNode) onOpen(tapNode.filePath);
    tapNode = null;
    panning = false;
    try {
      renderer.domElement.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    camera.position.z = Math.min(MAX_Z, Math.max(MIN_Z, camera.position.z * (1 + e.deltaY * 0.0012)));
  };

  const cv = renderer.domElement;
  cv.style.cursor = "grab";
  cv.addEventListener("pointerdown", onPointerDown);
  cv.addEventListener("pointermove", onPointerMove);
  cv.addEventListener("pointerup", endPointer);
  cv.addEventListener("pointercancel", endPointer);
  cv.addEventListener("wheel", onWheel, { passive: false });

  // --- per-frame: advance sim positions into geometry, render ------------
  const linkPos = linkGeo.getAttribute("position") as THREE.BufferAttribute;
  function syncPositions() {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      sprites[i].position.set(n.x ?? 0, -(n.y ?? 0), n.z);
    }
    for (let i = 0; i < links.length; i++) {
      const s = links[i].source as SimNode;
      const t = links[i].target as SimNode;
      linkPos.setXYZ(i * 2, s.x ?? 0, -(s.y ?? 0), s.z);
      linkPos.setXYZ(i * 2 + 1, t.x ?? 0, -(t.y ?? 0), t.z);
    }
    linkPos.needsUpdate = true;
  }

  applyLinkColors();
  let raf = 0;
  let last = performance.now();
  const tick = () => {
    raf = requestAnimationFrame(tick);
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    camera.lookAt(camera.position.x, camera.position.y, 0);
    if (rotating) {
      // Slow drift around two axes for a living starfield (example-style).
      nodeGroup.rotation.y += dt * 0.06;
      nodeGroup.rotation.x += dt * 0.018;
    } else {
      syncPositions();
    }
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
      sim?.stop();
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
        (sprites[i].material as THREE.SpriteMaterial).color.copy(starColor(nodes[i]));
      }
    },
  };
}
