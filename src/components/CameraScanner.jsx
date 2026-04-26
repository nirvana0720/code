import { useEffect, useRef, useState } from 'react'
import QrScanner from 'qr-scanner'

/**
 * 全螢幕相機掃描元件
 * Props:
 *   onScan(code: string) — 掃到 QR code 後呼叫，只觸發一次
 *   onClose()           — 使用者點關閉
 */
export default function CameraScanner({ onScan, onClose }) {
  const videoRef = useRef(null)
  const scannerRef = useRef(null)
  const hasScanned = useRef(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!videoRef.current) return

    const scanner = new QrScanner(
      videoRef.current,
      (result) => {
        if (hasScanned.current) return
        hasScanned.current = true
        scanner.stop()
        onScan(result.data)
      },
      {
        preferredCamera: 'environment',   // 後鏡頭優先
        highlightScanRegion: true,
        highlightCodeOutline: true,
        returnDetailedScanResult: true,
      }
    )

    scannerRef.current = scanner
    scanner.start().catch((err) => {
      setError(err?.message || '無法開啟相機，請確認已授予相機權限')
    })

    return () => {
      scanner.destroy()
    }
  }, []) // eslint-disable-line

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* 頂列 */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 text-white flex-shrink-0">
        <p className="text-lg font-semibold">掃描學員證 QR code</p>
        <button
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center text-2xl rounded-full hover:bg-gray-700 active:bg-gray-600 transition-colors"
          aria-label="關閉相機"
        >
          ✕
        </button>
      </div>

      {/* 相機區 / 錯誤提示 */}
      {error ? (
        <div className="flex-1 flex flex-col items-center justify-center text-white p-8 text-center">
          <p className="text-5xl mb-5">📷</p>
          <p className="text-xl font-bold mb-2">無法開啟相機</p>
          <p className="text-sm text-gray-300 mb-8 max-w-xs leading-relaxed">{error}</p>
          <button
            onClick={onClose}
            className="px-8 py-3 bg-white text-gray-900 rounded-2xl font-semibold text-base"
          >
            返回
          </button>
        </div>
      ) : (
        <div className="flex-1 relative overflow-hidden">
          {/* 相機預覽 */}
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            playsInline
            muted
          />

          {/* 掃描框提示 */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-60 h-60">
              {/* 四個角框 */}
              <span className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-lg" />
              <span className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-lg" />
              <span className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-lg" />
              <span className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-lg" />
            </div>
          </div>

          {/* 說明文字 */}
          <p className="absolute bottom-10 left-0 right-0 text-center text-white text-sm opacity-80 pointer-events-none">
            將學員證 QR code 對準框內
          </p>
        </div>
      )}
    </div>
  )
}
