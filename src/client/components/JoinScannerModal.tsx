import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, ScanLine, X } from 'lucide-react';
import { extractSessionPin } from '../lib/joinCodes.ts';

type JoinScannerModalProps = {
  open: boolean;
  onClose: () => void;
  onDetected: (pin: string) => void;
};

type ScanStatus = 'idle' | 'starting' | 'ready' | 'detected' | 'unsupported' | 'blocked' | 'error';

type DetectedBarcodeLike = {
  rawValue?: string;
};

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcodeLike[]>;
};

type BarcodeDetectorConstructorLike = {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

const SCAN_FORMATS = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8'];

export default function JoinScannerModal({ open, onClose, onDetected }: JoinScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  const onDetectedRef = useRef(onDetected);
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [message, setMessage] = useState('Point your camera at the host QR code or barcode.');

  const stopScanner = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (!streamRef.current) {
      return;
    }

    streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    if (!open) {
      stopScanner();
      setStatus('idle');
      setMessage('Point your camera at the host QR code or barcode.');
      return;
    }

    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      setMessage('This browser cannot use the in-app scanner. You can still scan the host QR with your device camera or join with the PIN.');
      return;
    }

    const BarcodeDetectorClass = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructorLike }).BarcodeDetector;
    if (!BarcodeDetectorClass) {
      setStatus('unsupported');
      setMessage('This browser does not support automatic code scanning inside the app yet. Use the device camera on the host QR or join with the PIN.');
      return;
    }

    let cancelled = false;
    let detector: BarcodeDetectorLike | null = null;

    const scanFrame = async () => {
      if (cancelled) {
        return;
      }

      const video = videoRef.current;
      if (video && video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
        try {
          const codes = await detector?.detect(video);
          if (!codes) {
            return;
          }
          for (const code of codes) {
            const pin = extractSessionPin(code.rawValue || '');
            if (!pin) {
              continue;
            }

            cancelled = true;
            setStatus('detected');
            setMessage(`Detected session ${pin}. Joining now...`);
            stopScanner();
            onDetectedRef.current(pin);
            return;
          }
        } catch {
          // Ignore transient detector failures while the camera is settling.
        }
      }

      timeoutRef.current = window.setTimeout(() => {
        void scanFrame();
      }, 180);
    };

    const startScanner = async () => {
      setStatus('starting');
      setMessage('Opening the camera...');

      try {
        const supportedFormats = typeof BarcodeDetectorClass.getSupportedFormats === 'function'
          ? await BarcodeDetectorClass.getSupportedFormats()
          : SCAN_FORMATS;
        const detectorFormats = SCAN_FORMATS.filter((format) => supportedFormats.includes(format));
        detector = new BarcodeDetectorClass({ formats: detectorFormats.length ? detectorFormats : ['qr_code'] });

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }

        setStatus('ready');
        setMessage('Point the camera at the host QR code or barcode. We will fill the session PIN automatically.');
        void scanFrame();
      } catch (error: any) {
        if (cancelled) {
          return;
        }

        const blocked = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
        setStatus(blocked ? 'blocked' : 'error');
        setMessage(
          blocked
            ? 'Camera access is blocked. Allow camera access and try again, or scan the host QR with your device camera.'
            : 'The scanner could not start on this device. You can still use the host QR externally or join with the PIN.',
        );
      }
    };

    void startScanner();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const showVideo = status === 'starting' || status === 'ready' || status === 'detected';

  return (
    <div className="fixed inset-0 z-[80] bg-brand-dark/75 backdrop-blur-sm p-4 sm:p-6 flex items-center justify-center">
      <div className="w-full max-w-2xl bg-white rounded-[2rem] border-4 border-brand-dark shadow-[12px_12px_0px_0px_#1A1A1A] p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Quick Join Scanner</p>
            <h2 className="text-3xl sm:text-4xl font-black leading-tight">Scan the host code and we will pull the session in automatically.</h2>
          </div>
          <button
            type="button"
            onClick={() => {
              stopScanner();
              onCloseRef.current();
            }}
            className="w-12 h-12 shrink-0 rounded-full border-2 border-brand-dark bg-brand-bg flex items-center justify-center"
            aria-label="Close scanner"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-dark overflow-hidden mb-4 relative">
          {showVideo ? (
            <video ref={videoRef} autoPlay muted playsInline className="w-full aspect-[4/3] object-cover" />
          ) : (
            <div className="w-full aspect-[4/3] flex items-center justify-center bg-brand-bg px-6 text-center">
              <div className="max-w-sm">
                <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-brand-yellow border-2 border-brand-dark flex items-center justify-center">
                  <AlertTriangle className="w-8 h-8 text-brand-dark" />
                </div>
                <p className="text-lg font-black text-brand-dark">{status === 'blocked' ? 'Camera access is blocked.' : 'Automatic scan is not available here.'}</p>
                <p className="text-brand-dark/70 font-medium mt-2">
                  Use the device camera on the host QR, or go back and type the PIN manually.
                </p>
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute inset-0 border-[3px] border-white/50 rounded-[1.75rem] m-5" />
          <div className="pointer-events-none absolute inset-x-10 top-1/2 -translate-y-1/2 h-[2px] bg-brand-orange/85 shadow-[0_0_18px_rgba(255,90,54,0.7)]" />
        </div>

        <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4 sm:p-5">
          <div className="flex flex-wrap items-start gap-3">
            <div className="w-11 h-11 rounded-full bg-white border-2 border-brand-dark flex items-center justify-center shrink-0">
              {status === 'starting' ? <Camera className="w-5 h-5 text-brand-orange animate-pulse" /> : <ScanLine className="w-5 h-5 text-brand-purple" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-dark/50 mb-1">Scanner status</p>
              <p className="text-lg font-black leading-snug">{message}</p>
              <p className="text-sm text-brand-dark/65 font-medium mt-2">
                Supported codes: host QR join links and raw 6-digit session PINs.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
