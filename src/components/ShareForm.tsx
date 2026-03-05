import type { ReactNode } from "react";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { Lock } from "lucide-react";

interface ShareFormFieldsProps {
  showEncrypt?: boolean;
  showSlugType?: boolean;
  currentExpiresAt?: string | null;
  encrypted: boolean;
  setEncrypted: (v: boolean) => void;
  slugType: string;
  setSlugType: (v: string) => void;
  customSlug: string;
  setCustomSlug: (v: string) => void;
  title: string;
  setTitle: (v: string) => void;
  comment: string;
  setComment: (v: string) => void;
  expiresAt: string;
  setExpiresAt: (v: string) => void;
  maxHits: string;
  setMaxHits: (v: string) => void;
  children?: ReactNode;
}

export function ShareFormFields({
  showEncrypt = true,
  showSlugType = true,
  currentExpiresAt,
  encrypted,
  setEncrypted,
  slugType,
  setSlugType,
  customSlug,
  setCustomSlug,
  title,
  setTitle,
  comment,
  setComment,
  expiresAt,
  setExpiresAt,
  maxHits,
  setMaxHits,
  children,
}: ShareFormFieldsProps) {
  return (
    <div className="space-y-4">
      <Input label="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My share" />

      {children}

      {showSlugType && (
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Slug type"
            value={slugType}
            onChange={(e) => setSlugType(e.target.value)}
            options={[
              { value: "short", label: "Short (8 chars)" },
              { value: "long", label: "Long (24 chars)" },
              { value: "custom", label: "Custom" },
            ]}
          />
          {slugType === "custom" && (
            <Input
              label="Custom slug"
              value={customSlug}
              onChange={(e) => setCustomSlug(e.target.value)}
              placeholder="my-custom-slug"
            />
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Select
            label="Expires"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            options={[
              { value: "", label: currentExpiresAt === undefined ? "Indefinite" : "No change" },
              { value: "1d", label: "1 day" },
              { value: "5d", label: "5 days" },
              { value: "10d", label: "10 days" },
              { value: "30d", label: "30 days" },
              { value: "60d", label: "60 days" },
              ...(currentExpiresAt !== undefined ? [{ value: "never", label: "Remove expiry" }] : []),
            ]}
          />
          {currentExpiresAt && (
            <p className="text-xs text-neutral-500 mt-1">
              Currently expires: {new Date(currentExpiresAt).toLocaleDateString()}
            </p>
          )}
          {currentExpiresAt === null && (
            <p className="text-xs text-neutral-500 mt-1">Currently: no expiry</p>
          )}
        </div>
        <Input
          label="Max views"
          type="number"
          value={maxHits}
          onChange={(e) => setMaxHits(e.target.value)}
          placeholder="Unlimited"
          min="1"
        />
      </div>

      <Input
        label="Notes (internal, only visible to you)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Internal notes..."
      />

      {showEncrypt && (
        <label className="flex items-center gap-3 p-3 bg-neutral-50 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-400 dark:hover:border-neutral-600 transition-colors">
          <input
            type="checkbox"
            checked={encrypted}
            onChange={(e) => setEncrypted(e.target.checked)}
            className="w-4 h-4 rounded border-neutral-400 dark:border-neutral-600 text-primary focus:ring-primary bg-white dark:bg-neutral-800"
          />
          <Lock size={16} className="text-neutral-500 dark:text-neutral-400" />
          <div>
            <div className="text-sm font-medium text-neutral-800 dark:text-neutral-200">End-to-end encrypt</div>
            <div className="text-xs text-neutral-500">Content encrypted in your browser. Key in URL hash only.</div>
          </div>
        </label>
      )}
    </div>
  );
}

export function computeExpiresAt(value: string): string | null | undefined {
  if (!value) return undefined;
  if (value === "never") return null;
  const DAY = 24 * 60 * 60 * 1000;
  const ms: Record<string, number> = {
    "1d": DAY,
    "5d": 5 * DAY,
    "10d": 10 * DAY,
    "30d": 30 * DAY,
    "60d": 60 * DAY,
  };
  if (ms[value]) {
    return new Date(Date.now() + ms[value]).toISOString();
  }
  return undefined;
}
