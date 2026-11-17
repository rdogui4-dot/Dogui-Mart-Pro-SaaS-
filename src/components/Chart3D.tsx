/** Graphique en barres 3D (WebGL, three.js) : chargé à la demande sur le tableau de bord, uniquement si la 3D est active et WebGL disponible.
 *  Rendu à la demande (pas de boucle permanente) : croissance des barres à l'apparition (≤ 700 ms), légère parallaxe au pointeur sur ordinateur, pause hors écran.
 *  Les valeurs restent lisibles en texte sous le graphique (accessibles, sans dépendre du canvas). */
import { useEffect, useRef } from "react";
import { AmbientLight, BoxGeometry, Color, DirectionalLight, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, WebGLRenderer } from "three";

export type Bar = { key: string; label: string; value: number; sub?: string };

export default function Chart3D({ data, label, format }: { data: Bar[]; label: string; format: (n: number) => string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current; if (!el) return;
    const css = getComputedStyle(document.documentElement); const cv = (n: string, fb: string) => css.getPropertyValue(n).trim() || fb;
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true"); renderer.domElement.style.display = "block";
    const scene = new Scene(); const camera = new PerspectiveCamera(32, 2, 0.1, 100);
    scene.add(new AmbientLight(0xffffff, 0.75)); const sun = new DirectionalLight(0xffffff, 1.1); sun.position.set(-4, 8, 6); scene.add(sun);
    const n = Math.max(1, data.length), gap = 0.4, w = 0.72, span = n * w + (n - 1) * gap, max = Math.max(1, ...data.map((d) => d.value));
    const group = new Group(); scene.add(group);
    const ground = new Mesh(new PlaneGeometry(span + 1, 1.6), new MeshStandardMaterial({ color: new Color(cv("--subtle", "#eef2f7")), roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.001; group.add(ground);
    const accent = new Color(cv("--chart-1", "#2563eb")), soft = new Color(cv("--line", "#d3dae4"));
    const bars = data.map((d, i) => {
      const h = Math.max(0.04, (d.value / max) * 3.4);
      const m = new Mesh(new BoxGeometry(w, 1, w * 0.7), new MeshStandardMaterial({ color: d.value > 0 ? accent : soft, roughness: 0.45, metalness: 0.08 }));
      m.position.set(-span / 2 + w / 2 + i * (w + gap), 0, 0); m.userData.h = h; m.scale.y = 0.0001; group.add(m); return m;
    });
    let px = 0, py = 0;
    const size = () => { const r = el.getBoundingClientRect(); const W = Math.max(1, r.width), H = Math.max(1, r.height); renderer.setSize(W, H, false); renderer.domElement.style.width = W + "px"; renderer.domElement.style.height = H + "px"; camera.aspect = W / H; const dist = Math.max(5.5, (span * 0.62) / Math.tan((camera.fov * Math.PI) / 360) / camera.aspect + 1.2); camera.position.set(0, 2.1, dist); camera.lookAt(0, 1.45, 0); camera.updateProjectionMatrix(); };
    const draw = () => { group.rotation.y = px * 0.12; group.rotation.x = py * 0.05; renderer.render(scene, camera); };
    size();
    let raf = 0, t0 = 0, visible = true;
    const grow = (t: number) => { if (!t0) t0 = t; const k = Math.min(1, (t - t0) / 700), e = 1 - Math.pow(1 - k, 3); for (const b of bars) { const h = b.userData.h as number; b.scale.y = h * e; b.position.y = (h * e) / 2; } draw(); if (k < 1 && visible) raf = requestAnimationFrame(grow); else raf = 0; };
    raf = requestAnimationFrame(grow);
    const io = new IntersectionObserver((es) => { visible = !!es[0]?.isIntersecting; if (visible && !raf && bars[0] && bars[0].scale.y < 0.001) raf = requestAnimationFrame(grow); }); io.observe(el);
    const onMove = (e: PointerEvent) => { if (e.pointerType !== "mouse" || document.documentElement.dataset.fx3d !== "full") return; const r = el.getBoundingClientRect(); px = (e.clientX - r.left) / r.width - 0.5; py = (e.clientY - r.top) / r.height - 0.5; if (!raf) draw(); };
    const onLeave = () => { px = 0; py = 0; if (!raf) draw(); };
    const onResize = () => { size(); if (!raf) draw(); };
    el.addEventListener("pointermove", onMove); el.addEventListener("pointerleave", onLeave); window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf); io.disconnect(); el.removeEventListener("pointermove", onMove); el.removeEventListener("pointerleave", onLeave); window.removeEventListener("resize", onResize); scene.traverse((o) => { const m = o as Mesh; if (m.geometry) m.geometry.dispose(); const mat = m.material as MeshStandardMaterial | undefined; if (mat) mat.dispose(); }); renderer.dispose(); renderer.domElement.remove(); };
  }, [data]);
  return (
    <figure className="flex flex-col gap-2" aria-label={label}>
      <div ref={host} className="h-48 md:h-56 w-full rounded-lg overflow-hidden" data-chart3d="true" />
      <figcaption><ul className="grid gap-1 text-center" style={{ gridTemplateColumns: `repeat(${Math.max(1, data.length)}, minmax(0, 1fr))` }}>{data.map((d) => <li key={d.key} className="min-w-0"><span className="block text-xs text-muted truncate">{d.label}</span><span className="block text-xs font-semibold tabular-nums truncate">{format(d.value)}</span></li>)}</ul></figcaption>
    </figure>
  );
}
