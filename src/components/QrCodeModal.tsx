import { useState } from "react";
import QRCode from "react-qr-code";
import { Copy, Check } from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";

interface QrCodeModalProps {
  open: boolean;
  onClose: () => void;
  url: string;
  title?: string;
}

export function QrCodeModal({ open, onClose, url, title = "QR Code" }: QrCodeModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="flex flex-col items-center gap-5">
        <div className="bg-white p-5 rounded-xl">
          <QRCode value={url} size={256} level="M" className="h-auto w-full max-w-[256px]" />
        </div>
        <div className="w-full flex items-center gap-2">
          <code className="flex-1 text-xs text-primary dark:text-primary-light bg-neutral-100 dark:bg-neutral-950 px-3 py-2 rounded-lg font-mono break-all">
            {url}
          </code>
          <Button variant="secondary" size="sm" onClick={handleCopy} title="Copy URL">
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
