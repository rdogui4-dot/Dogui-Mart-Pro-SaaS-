import { useEffect, useRef, useState } from "react";

type BD = { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> };
declare global { interface Window { BarcodeDetector?: new (o?: { formats: string[] }) => BD } }

/** Scan code-barres via la caméra Android (API BarcodeDetector de Chrome). */
export function Scanner({ onCode, onClose }: { onCode: (c: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let stop = false, stream: MediaStream | undefined;
    (async () => {
      if (!window.BarcodeDetector) return setErr("Scan non supporté sur ce navigateur : saisissez le code.");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!ref.current) return;
        ref.current.srcObject = stream; await ref.current.play();
        const det = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "code_128", "qr_code", "upc_a"] });
        const tick = async () => {
          if (stop || !ref.current) return;
          const r = await det.detect(ref.current).catch(() => []);
          if (r[0]) { navigator.vibrate?.(60); onCode(r[0].rawValue); return; }
          setTimeout(tick, 250);
        };
        void tick();
      } catch { setErr("Caméra indisponible ou permission refusée."); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [onCode]);
  return (
    <div data-theme="dark" className="fixed inset-0 z-50 bg-black flex flex-col">
      <video ref={ref} className="flex-1 object-cover" playsInline muted />
      {err && <p className="p-4 text-center text-warn">{err}</p>}
      <button className="btn m-4" onClick={onClose}>Fermer</button>
    </div>
  );
}
