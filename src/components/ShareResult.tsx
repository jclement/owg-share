import { useState } from "react";
import { Copy, Check, ExternalLink, AlertTriangle } from "lucide-react";
import { Button } from "./ui/Button";

interface ShareResultProps {
  slug: string;
  encrypted: boolean;
  encryptionKey?: string;
  onDone: () => void;
}

function CopyBox({ label, value, description }: { label: string; value: string; description?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-3 bg-neutral-100 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-lg">
      <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{label}</label>
      {description && (
        <p className="text-xs text-neutral-500 dark:text-neutral-500 mb-2">{description}</p>
      )}
      <div className="flex items-center gap-2">
        <code className="flex-1 text-sm text-primary dark:text-primary-light bg-neutral-50 dark:bg-neutral-950 px-3 py-2 rounded-lg font-mono break-all">
          {value}
        </code>
        <Button variant="secondary" size="sm" onClick={handleCopy}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </Button>
      </div>
    </div>
  );
}

export function ShareResult({ slug, encrypted, encryptionKey, onDone }: ShareResultProps) {
  const [copied, setCopied] = useState(false);
  const baseUrl = window.location.origin;
  const shareUrl = `${baseUrl}/s/${slug}`;
  const fullUrl = encrypted && encryptionKey
    ? `${shareUrl}#key=${encryptionKey}`
    : shareUrl;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-3">
      {encrypted && encryptionKey ? (
        <>
          <CopyBox
            label="Link (without key)"
            description="This URL alone won't decrypt the content"
            value={shareUrl}
          />
          <CopyBox
            label="Encryption Key"
            description="Required to decrypt — store this somewhere safe"
            value={encryptionKey}
          />
          <CopyBox
            label="Full Link (with key)"
            description="Anyone with this link can view the content"
            value={fullUrl}
          />
          <div className="flex items-start gap-3 p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-300 dark:border-yellow-800/50 rounded-lg">
            <AlertTriangle size={18} className="text-yellow-600 dark:text-yellow-500 mt-0.5 shrink-0" />
            <div className="text-sm text-yellow-800 dark:text-yellow-200">
              The encryption key cannot be recovered. Save the full link or store the key separately.
            </div>
          </div>
        </>
      ) : (
        <div className="p-4 bg-neutral-100 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-lg">
          <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-2">Share URL</label>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm text-primary dark:text-primary-light bg-neutral-50 dark:bg-neutral-950 px-3 py-2 rounded-lg font-mono break-all">
              {fullUrl}
            </code>
            <Button variant="secondary" size="sm" onClick={handleCopy}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </Button>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="secondary" onClick={onDone} className="flex-1">
          Create another
        </Button>
        <a href={fullUrl} target="_blank" rel="noopener noreferrer">
          <Button variant="ghost">
            <ExternalLink size={16} /> Open
          </Button>
        </a>
      </div>
    </div>
  );
}
