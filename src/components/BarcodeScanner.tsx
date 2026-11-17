import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { X, Camera, AlertCircle } from 'lucide-react';

interface BarcodeScannerProps {
  onScanSuccess: (janCode: string) => void;
  onClose: () => void;
}

export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({ onScanSuccess, onClose }) => {
  const [errorMsg, setErrorMsg] = useState<string>('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const readerElementId = 'jan-barcode-reader';

  useEffect(() => {
    const html5QrCode = new Html5Qrcode(readerElementId, {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
      ],
      verbose: false,
    });
    scannerRef.current = html5QrCode;

    const startScanner = async () => {
      try {
        await html5QrCode.start(
          { facingMode: 'environment' }, // スマホの背面カメラを使用
          {
            fps: 15,
            qrbox: { width: 250, height: 110 },
            aspectRatio: 1.0,
          },
          (decodedText) => {
            if (navigator.vibrate) navigator.vibrate(100);
            html5QrCode.stop().then(() => {
              onScanSuccess(decodedText);
            }).catch(() => {
              onScanSuccess(decodedText);
            });
          },
          () => {
            // スキャン中のフレーム未検出は無視
          }
        );
      } catch (err) {
        console.error('Camera start error:', err);
        setErrorMsg('カメラを起動できませんでした。ブラウザのカメラ許可設定を確認してください。');
      }
    };

    startScanner();

    return () => {
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch((e) => console.error(e));
      }
    };
  }, [onScanSuccess]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white">
          <div className="flex items-center gap-2 font-bold text-sm">
            <Camera className="w-5 h-5 text-emerald-400" />
            <span>JANコード読み取り</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 flex flex-col items-center">
          {errorMsg ? (
            <div className="p-4 bg-red-50 text-red-700 rounded-xl flex items-start gap-2 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          ) : (
            <>
              <div
                id={readerElementId}
                className="w-full overflow-hidden rounded-xl bg-black min-h-[220px]"
              />
              <p className="text-xs text-slate-500 mt-3 text-center">
                商品のバーコードを枠内に合わせてください
              </p>
            </>
          )}

          <button
            type="button"
            onClick={onClose}
            className="mt-4 w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-sm transition-colors"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};