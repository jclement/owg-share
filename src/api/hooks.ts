import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, fetchPaginated } from "./client";

// Types matching the API
export interface AuthStatus {
  authenticated: boolean;
  needsSetup: boolean;
  appName: string;
  user?: { id: string; username: string; created_at: string };
}

export interface Share {
  id: string;
  slug: string;
  type: "link" | "markdown" | "code" | "file" | "gallery";
  title: string | null;
  comment: string | null;
  encrypted: number;
  expires_at: string | null;
  max_hits: number | null;
  hits: number;
  created_at: string;
  updated_at: string;
}

export interface ShareDetail extends Share {
  link?: { url: string };
  markdown?: { content: string };
  code?: { content: string; language: string | null; filename: string | null };
  file?: { filename: string; content_type: string; size: number; r2_key: string };
  gallery?: { id: string };
  images?: Array<{ id: string; filename: string; content_type: string; size: number; r2_key: string; sort_order: number; caption: string | null }>;
}

export interface ShareStats {
  total: number;
  totalHits: number;
  byType: Record<string, number>;
}

export interface PasskeyInfo {
  id: string;
  name: string | null;
  device_type: string | null;
  backed_up: number;
  transports: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  key_prefix: string;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  created_at: string;
}

// Auth hooks
export function useAuthStatus() {
  return useQuery({
    queryKey: ["auth", "status"],
    queryFn: () => api.get<AuthStatus>("/api/auth/status"),
    retry: false,
    staleTime: 60_000,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/api/auth/logout"),
    onSuccess: () => {
      queryClient.setQueryData(["auth", "status"], {
        authenticated: false,
        needsSetup: false,
      });
      queryClient.invalidateQueries();
    },
  });
}

// Share hooks
export function useShares(params?: { type?: string; page?: number; perPage?: number; search?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.type) searchParams.set("type", params.type);
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.perPage) searchParams.set("per_page", String(params.perPage));
  if (params?.search) searchParams.set("search", params.search);

  const qs = searchParams.toString();
  return useQuery({
    queryKey: ["shares", params],
    queryFn: () => fetchPaginated<Share>(`/api/shares${qs ? `?${qs}` : ""}`),
  });
}

export function useShare(id: string | null) {
  return useQuery({
    queryKey: ["shares", "detail", id],
    queryFn: () => api.get<ShareDetail>(`/api/shares/${id}`),
    enabled: !!id,
  });
}

export function useShareStats() {
  return useQuery({
    queryKey: ["shares", "stats"],
    queryFn: () => api.get<ShareStats>("/api/shares/stats/summary"),
  });
}

export function useDeleteShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/shares/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shares"] });
    },
  });
}

export function useCreateLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { url: string; title?: string; comment?: string; slug_type?: string; custom_slug?: string; expires_at?: string | null; max_hits?: number }) =>
      api.post<{ id: string; slug: string }>("/api/shares/links", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shares"] }),
  });
}

export function useCreateMarkdown() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { content: string; title?: string; comment?: string; encrypted?: boolean; slug_type?: string; custom_slug?: string; expires_at?: string | null; max_hits?: number }) =>
      api.post<{ id: string; slug: string; encrypted: boolean }>("/api/shares/markdown", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shares"] }),
  });
}

export function useCreateCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { content: string; language?: string; filename?: string; title?: string; comment?: string; encrypted?: boolean; slug_type?: string; custom_slug?: string; expires_at?: string | null; max_hits?: number }) =>
      api.post<{ id: string; slug: string; encrypted: boolean }>("/api/shares/code", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shares"] }),
  });
}

export function useCreateFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { filename: string; content_type: string; size: number; r2_key: string; title?: string; comment?: string; encrypted?: boolean; slug_type?: string; custom_slug?: string; expires_at?: string | null; max_hits?: number }) =>
      api.post<{ id: string; slug: string; encrypted: boolean }>("/api/shares/files", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shares"] }),
  });
}

export function useCreateGallery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { title?: string; comment?: string; encrypted?: boolean; slug_type?: string; custom_slug?: string; expires_at?: string | null; max_hits?: number; images?: Array<{ filename: string; content_type: string; size: number; r2_key: string; caption?: string }> }) =>
      api.post<{ id: string; galleryId: string; slug: string; encrypted: boolean }>("/api/shares/galleries", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shares"] }),
  });
}

// Update hooks
export function useUpdateLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; url?: string; title?: string | null; comment?: string | null; expires_at?: string | null; max_hits?: number | null }) =>
      api.put(`/api/shares/links/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shares"] }),
  });
}

export function useUpdateMarkdown() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; content?: string; title?: string | null; comment?: string | null; expires_at?: string | null; max_hits?: number | null }) =>
      api.put(`/api/shares/markdown/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shares"] }),
  });
}

export function useUpdateCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; content?: string; language?: string; filename?: string; title?: string | null; comment?: string | null; expires_at?: string | null; max_hits?: number | null }) =>
      api.put(`/api/shares/code/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shares"] }),
  });
}

export function useUpdateFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; title?: string | null; comment?: string | null; expires_at?: string | null; max_hits?: number | null }) =>
      api.put(`/api/shares/files/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shares"] }),
  });
}

export function useUpdateGallery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; title?: string | null; comment?: string | null; expires_at?: string | null; max_hits?: number | null }) =>
      api.put(`/api/shares/galleries/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shares"] }),
  });
}

export function useDeleteGalleryImage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId, imageId }: { shareId: string; imageId: string }) =>
      api.delete(`/api/shares/galleries/${shareId}/images/${imageId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shares"] }),
  });
}

export function useAddGalleryImages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId, images }: { shareId: string; images: Array<{ filename: string; content_type: string; size: number; r2_key: string; caption?: string }> }) =>
      api.post(`/api/shares/galleries/${shareId}/images`, { images }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shares"] }),
  });
}

export function useUpdateGalleryImage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId, imageId, caption }: { shareId: string; imageId: string; caption: string }) =>
      api.put(`/api/shares/galleries/${shareId}/images/${imageId}`, { caption }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shares"] }),
  });
}

// Upload hooks
export function usePresignUpload() {
  return useMutation({
    mutationFn: (data: { filename: string; contentType: string; size: number }) =>
      api.post<{ uploadId: string; r2Key: string }>("/api/upload/presign", data),
  });
}

// Passkey hooks
export function usePasskeys() {
  return useQuery({
    queryKey: ["passkeys"],
    queryFn: () => api.get<PasskeyInfo[]>("/api/passkeys"),
  });
}

export function useRenamePasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.put(`/api/passkeys/${id}`, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["passkeys"] }),
  });
}

export function useDeletePasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/passkeys/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["passkeys"] }),
  });
}

// API key hooks
export function useApiKeys() {
  return useQuery({
    queryKey: ["apikeys"],
    queryFn: () => api.get<ApiKeyInfo[]>("/api/apikeys"),
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; expires_at?: string }) =>
      api.post<{ id: string; name: string; key: string; key_prefix: string }>("/api/apikeys", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["apikeys"] }),
  });
}

export function useDeleteApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/apikeys/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["apikeys"] }),
  });
}
