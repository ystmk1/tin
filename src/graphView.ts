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
import { select } from "d3-selection";
import { drag } from "d3-drag";
import { zoom, ZoomTransform, zoomIdentity } from "d3-zoom";
import { BookNote } from "./types";
import { buildGraph } from "./graph";

interface SimNode extends SimulationNodeDatum {
  id: string;
  title: string;
  degree: number;
  filePath: string;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
}

export interface GraphHandle {
  /** Tear down d3 simulation and SVG. */
  cleanup: () => void;
  /**
   * Dim every node not in `highlightIds` to ~15% opacity, plus any link
   * that touches a dimmed node. Pass `null` to clear (restore full
   * opacity for everything). Layout is preserved across highlight
   * changes — Obsidian-style.
   */
  setHighlight: (highlightIds: Set<string> | null) => void;
}

export function renderGraph(
  container: HTMLElement,
  books: BookNote[],
  onOpen: (path: string) => void,
): GraphHandle {
  const { nodes: rawNodes, links: rawLinks } = buildGraph(books);

  const width = container.clientWidth || 800;
  const height = 260;
  container.style.height = `${height}px`;

  const svg = select(container).append("svg").attr("width", "100%").attr("height", height).attr("class", "dokki-graph-svg");
  const g = svg.append("g");

  const nodes: SimNode[] = rawNodes.map((n) => ({
    id: n.id,
    title: n.title,
    degree: n.degree,
    filePath: n.filePath,
  }));
  const links: SimLink[] = rawLinks.map((l) => ({ source: l.source, target: l.target }));

  const maxDeg = Math.max(1, ...nodes.map((n) => n.degree));
  // Slightly smaller dots overall; high-degree still visibly bigger.
  const radius = (d: SimNode) => 2 + 3.2 * Math.sqrt(d.degree / maxDeg);
  const linkWidth = (a: SimNode, b: SimNode) => {
    const avg = (a.degree + b.degree) / 2;
    return 0.4 + 1.4 * (avg / maxDeg);
  };

  const cx = width / 2;
  const cy = height / 2;

  const sim: Simulation<SimNode, SimLink> = forceSimulation(nodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        // Wider resting spacing overall; many-connected pairs still pull closer.
        .distance((l) => {
          const s = l.source as SimNode;
          const t = l.target as SimNode;
          return 48 + 55 / Math.max(1, (s.degree + t.degree) / 2);
        })
        .strength(0.32),
    )
    // Stronger general repulsion so non-trivial graphs breathe more.
    .force("charge", forceManyBody().strength((d) => -55 - 55 * Math.sqrt((d as SimNode).degree / maxDeg)))
    .force("center", forceCenter(cx, cy).strength(0.04))
    .force("x", forceX(cx).strength((d) => 0.02 + 0.18 * ((d as SimNode).degree / maxDeg)))
    .force("y", forceY(cy).strength((d) => 0.04 + 0.25 * ((d as SimNode).degree / maxDeg)))
    .force("collide", forceCollide<SimNode>((d) => radius(d) + 4));

  const linkSel = g
    .append("g")
    .attr("class", "dokki-links")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("stroke-width", (d) => linkWidth(d.source as SimNode, d.target as SimNode))
    .attr("stroke", "var(--dokki-branch, #8a8a8a)")
    .attr("stroke-opacity", 0.55);

  const nodeSel = g
    .append("g")
    .attr("class", "dokki-nodes")
    .selectAll<SVGCircleElement, SimNode>("circle")
    .data(nodes)
    .join("circle")
    .attr("r", radius)
    .attr("fill", "var(--dokki-node, #d4d4d4)")
    .attr("stroke", "var(--dokki-node-stroke, #1a1a1a)")
    .attr("stroke-width", 0.6)
    .style("cursor", "pointer")
    .on("click", (_e, d) => onOpen(d.filePath));

  nodeSel.append("title").text((d) => `${d.title}${d.degree ? `  (${d.degree})` : ""}`);

  // Hover-only title labels for ALL nodes (was: persistent for top 40%).
  const labelSel = g
    .append("g")
    .attr("class", "dokki-labels")
    .selectAll<SVGTextElement, SimNode>("text")
    .data(nodes)
    .join("text")
    .text((d) => d.title)
    .attr("font-size", 10.5)
    .attr("fill", "var(--text-normal)")
    .attr("dx", 8)
    .attr("dy", 3)
    .attr("opacity", 0)
    .style("pointer-events", "none");

  nodeSel
    .on("mouseenter", (_e, d) => {
      labelSel.filter((l) => l.id === d.id).attr("opacity", 1);
    })
    .on("mouseleave", (_e, d) => {
      labelSel.filter((l) => l.id === d.id).attr("opacity", 0);
    });

  const dragBehavior = drag<SVGCircleElement, SimNode>()
    .on("start", (event, d) => {
      if (!event.active) sim.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    })
    .on("drag", (event, d) => {
      d.fx = event.x;
      d.fy = event.y;
    })
    .on("end", (event, d) => {
      if (!event.active) sim.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    });
  nodeSel.call(dragBehavior);

  const zoomBehavior = zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.4, 4])
    .on("zoom", (event) => {
      const t = event.transform as ZoomTransform;
      g.attr("transform", t.toString());
    });
  svg.call(zoomBehavior as any);
  svg.call((sel) => sel.call((zoomBehavior as any).transform, zoomIdentity));

  sim.on("tick", () => {
    linkSel
      .attr("x1", (d) => (d.source as SimNode).x ?? 0)
      .attr("y1", (d) => (d.source as SimNode).y ?? 0)
      .attr("x2", (d) => (d.target as SimNode).x ?? 0)
      .attr("y2", (d) => (d.target as SimNode).y ?? 0);
    nodeSel.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
    labelSel.attr("x", (d) => d.x ?? 0).attr("y", (d) => d.y ?? 0);
  });

  const ro = new ResizeObserver(() => {
    const w = container.clientWidth || width;
    svg.attr("width", "100%");
    sim.force("center", forceCenter(w / 2, height / 2).strength(0.04));
    sim.alpha(0.3).restart();
  });
  ro.observe(container);

  const DIM_NODE = 0.12;
  const DIM_LINK = 0.06;

  const setHighlight = (highlightIds: Set<string> | null): void => {
    // Labels are hover-controlled; setHighlight only adjusts nodes + links.
    if (!highlightIds || highlightIds.size === 0) {
      nodeSel.attr("opacity", 1);
      linkSel.attr("stroke-opacity", 0.55);
      return;
    }
    nodeSel.attr("opacity", (d) => (highlightIds.has(d.id) ? 1 : DIM_NODE));
    linkSel.attr("stroke-opacity", (d) => {
      const sId = typeof d.source === "string" ? d.source : d.source.id;
      const tId = typeof d.target === "string" ? d.target : d.target.id;
      return highlightIds.has(sId) && highlightIds.has(tId) ? 0.55 : DIM_LINK;
    });
  };

  return {
    cleanup: () => {
      sim.stop();
      ro.disconnect();
      svg.remove();
    },
    setHighlight,
  };
}
