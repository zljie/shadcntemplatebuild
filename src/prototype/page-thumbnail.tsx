"use client";
import { useEffect, useRef, useState } from "react";
import { PageRenderer } from "@/runtime/renderer";
import type { PageDocument } from "@/core/schema";

const WIDTH = 1440, HEIGHT = 900;

/**
 * Live, non-interactive miniature of a Page DSL document: the real runtime rendered at desktop
 * width and scaled to the card. Mounted only once scrolled into view to keep the list light.
 */
export function PageThumbnail({document, label}: {document: PageDocument; label: string}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0), [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / WIDTH));
    const intersect = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); intersect.disconnect(); } }, {rootMargin: "200px"});
    resize.observe(element); intersect.observe(element);
    return () => { resize.disconnect(); intersect.disconnect(); };
  }, []);
  return <div ref={ref} className="page-thumb" role="img" aria-label={`${label} 预览`}>
    {visible && scale > 0 && <div className="page-thumb-canvas" inert style={{width: WIDTH, height: HEIGHT, transform: `scale(${scale})`}}><PageRenderer document={document}/></div>}
  </div>;
}

/** Schematic wireframe for layouts that are not Page DSL documents (standalone detail, form). */
export function LayoutWireframe({kind}: {kind: "list-detail" | "detail" | "form" | "shell"}) {
  const bars = (n: number, cls = "wf-line") => Array.from({length: n}, (_, i) => <span key={i} className={cls}/>);
  return <div className={`wireframe wf-${kind}`} aria-hidden="true">
    <span className="wf-sidebar">{bars(4, "wf-nav")}</span>
    <span className="wf-body">
      <span className="wf-topbar"/>
      {kind === "list-detail" && <span className="wf-columns"><span className="wf-main"><span className="wf-title"/><span className="wf-search"/>{bars(5, "wf-row")}</span><span className="wf-panel">{bars(4)}</span></span>}
      {kind === "detail" && <span className="wf-main"><span className="wf-title"/><span className="wf-card">{bars(4, "wf-pair")}</span><span className="wf-card">{bars(2)}</span></span>}
      {kind === "form" && <span className="wf-main wf-narrow"><span className="wf-title"/><span className="wf-card">{bars(4, "wf-input")}<span className="wf-actions"/></span></span>}
      {kind === "shell" && <span className="wf-main wf-slot">工作区 Slot</span>}
    </span>
  </div>;
}
