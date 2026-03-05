const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const RESERVED_SLUGS = new Set([
  "api", "auth", "login", "setup", "settings", "dashboard",
  "static", "assets", "health", "s", "admin", "new", "edit", "delete",
]);

export type SlugType = "short" | "long" | "encrypted" | "custom";

export function generateSlug(type: SlugType): string {
  const lengths: Record<Exclude<SlugType, "custom">, number> = {
    short: 8,
    long: 24,
    encrypted: 32,
  };

  if (type === "custom") throw new Error("Use validateCustomSlug for custom slugs");

  const length = lengths[type];
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  let slug = "";
  for (let i = 0; i < length; i++) {
    slug += BASE62[bytes[i] % 62];
  }
  return slug;
}

export function validateCustomSlug(slug: string): string | null {
  if (slug.length < 1 || slug.length > 64) {
    return "Custom slug must be 1-64 characters";
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]$/.test(slug) && slug.length > 1) {
    return "Custom slug must start and end with alphanumeric, and contain only alphanumeric or hyphens";
  }
  if (slug.length === 1 && !/^[a-zA-Z0-9]$/.test(slug)) {
    return "Custom slug must be alphanumeric";
  }
  if (RESERVED_SLUGS.has(slug.toLowerCase())) {
    return "This slug is reserved";
  }
  return null;
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}
