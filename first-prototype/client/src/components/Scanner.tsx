import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { useEffect, useRef } from 'react';

export type ScannerState = 'idle' | 'starting' | 'scanning' | 'denied' | 'unavailable';

const HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]],
]);

/**
 * Live camera barcode scanner. Calls onDetect once per distinct code.
 * The camera stream is opened here (not by ZXing) so a cancelled run, such as
 * React StrictMode's double mount, never touches the video a newer run is using.
 */
export function Scanner({
  active,
  onDetect,
  onStateChange,
}: {
  active: boolean;
  onDetect: (code: string) => void;
  onStateChange: (s: ScannerState) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectRef = useRef(onDetect);
  const onStateRef = useRef(onStateChange);

  useEffect(() => {
    onDetectRef.current = onDetect;
    onStateRef.current = onStateChange;
  });

  useEffect(() => {
    if (!active) return;
    const video = videoRef.current;
    if (!video) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      onStateRef.current('unavailable');
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let controls: IScannerControls | null = null;
    let last = '';
    onStateRef.current('starting');

    const stopStream = () => stream?.getTracks().forEach((t) => t.stop());

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then(async (s) => {
        stream = s;
        if (cancelled) return stopStream();
        const reader = new BrowserMultiFormatReader(HINTS, { delayBetweenScanAttempts: 150 });
        const c = await reader.decodeFromStream(s, video, (result) => {
          if (!result) return;
          const code = result.getText();
          if (code && code !== last) {
            last = code;
            if (navigator.vibrate) navigator.vibrate(40);
            onDetectRef.current(code);
          }
        });
        if (cancelled) {
          c.stop();
          return stopStream();
        }
        controls = c;
        onStateRef.current('scanning');
      })
      .catch((err: unknown) => {
        stopStream();
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : '';
        onStateRef.current(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
      });

    return () => {
      cancelled = true;
      controls?.stop();
      stopStream();
    };
  }, [active]);

  return <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" muted playsInline aria-hidden />;
}
