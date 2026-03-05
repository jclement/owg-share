import { useState } from "react";
import { Copy, Check, ExternalLink, AlertTriangle } from "lucide-react";
import { Button } from "./ui/Button";

interface ShareResultProps {
  slug: string;
  encrypted: boolean;
  encryptionKey?: string;
  onDone: () => void;
}

export function ShareResult({ slug, encrypted, encryptionKey, onDone }: ShareResultProps) {
  const [copied, setCopied] = useState(false);
  const baseUrl = window.location.origin;
  const shareUrl = encrypted && encryptionKey
    ? `${baseUrl}/s/${slug}#key=${encryptionKey}`
    : `${baseUrl}/s/${slug}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="p-4 bg-neutral-100 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-lg">
        <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-2">Share URL</label>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-sm text-primary dark:text-primary-light bg-neutral-50 dark:bg-neutral-950 px-3 py-2 rounded-lg font-mono break-all">
            {shareUrl}
          </code>
          <Button variant="secondary" size="sm" onClick={handleCopy}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </Button>
        </div>
      </div>

      {encrypted && (
        <div className="flex items-start gap-3 p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-300 dark:border-yellow-800/50 rounded-lg">
          <AlertTriangle size={18} className="text-yellow-600 dark:text-yellow-500 mt-0.5 shrink-0" />
          <div className="text-sm text-yellow-800 dark:text-yellow-200">
            <strong>Save this URL.</strong> The encryption key is embedded in the URL hash and cannot be recovered.
            Anyone with this URL can view the content. Without it, the content is unreadable.
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="secondary" onClick={onDone} className="flex-1">
          Create another
        </Button>
        <a href={shareUrl} target="_blank" rel="noopener noreferrer">
          <Button variant="ghost">
            <ExternalLink size={16} /> Open
          </Button>
        </a>
      </div>
    </div>
  );
}
