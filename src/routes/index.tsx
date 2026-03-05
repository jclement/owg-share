import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuthStatus, useShares, useShareStats, useDeleteShare } from "../api/hooks";
import { Spinner } from "../components/ui/Spinner";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { NewShareWizard } from "../components/NewShareWizard";
import { useToast } from "../components/ui/Toast";
import {
  Link as LinkIcon, FileText, Code, Upload, Images,
  Eye, Plus, BarChart3, Copy, ExternalLink, Trash2, Search,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

const typeIcons: Record<string, typeof LinkIcon> = {
  link: LinkIcon, markdown: FileText, code: Code, file: Upload, gallery: Images,
};
const typeColors: Record<string, string> = {
  link: "text-blue-500 dark:text-blue-400", markdown: "text-green-500 dark:text-green-400", code: "text-yellow-500 dark:text-yellow-400",
  file: "text-purple-500 dark:text-purple-400", gallery: "text-pink-500 dark:text-pink-400",
};

function Dashboard() {
  const { data: auth } = useAuthStatus();
  const navigate = useNavigate();

  if (auth?.needsSetup) { navigate({ to: "/setup" }); return null; }
  if (!auth?.authenticated) { navigate({ to: "/login" }); return null; }

  return <DashboardContent />;
}

function DashboardContent() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const { data: stats } = useShareStats();
  const { data: shares, isLoading } = useShares({
    type: typeFilter || undefined,
    page,
    perPage: 25,
    search: search || undefined,
  });
  const deleteShare = useDeleteShare();
  const { toast } = useToast();

  const copyUrl = (slug: string, encrypted: boolean) => {
    const url = `${window.location.origin}/s/${slug}`;
    navigator.clipboard.writeText(url);
    toast("success", encrypted ? "URL copied (without encryption key)" : "URL copied!");
  };

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Shares</h1>
        <Button onClick={() => setWizardOpen(true)} size="lg">
          <Plus size={18} /> New Share
        </Button>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
          <StatCard label="Total" value={stats.total} icon={BarChart3} />
          <StatCard label="Views" value={stats.totalHits} icon={Eye} />
          {(["link", "markdown", "code", "file", "gallery"] as const).map((type) => {
            const Icon = typeIcons[type];
            return (
              <button
                key={type}
                onClick={() => { setTypeFilter(typeFilter === type ? "" : type); setPage(1); }}
                className={`flex items-center gap-2 p-3 rounded-lg border transition-colors text-left ${
                  typeFilter === type
                    ? "bg-neutral-200 dark:bg-neutral-800 border-neutral-400 dark:border-neutral-600"
                    : "bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700"
                }`}
              >
                <Icon size={16} className={typeColors[type]} />
                <div>
                  <div className="text-lg font-bold text-neutral-900 dark:text-neutral-100">{stats.byType[type] || 0}</div>
                  <div className="text-xs text-neutral-500 capitalize">{type}s</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Search + Filter bar */}
      <div className="flex gap-3">
        <div className="flex-1 flex gap-2">
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by title or slug..."
            className="flex-1"
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <Button variant="secondary" onClick={handleSearch}>
            <Search size={16} />
          </Button>
        </div>
        <Select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          options={[
            { value: "", label: "All types" },
            { value: "link", label: "Links" },
            { value: "markdown", label: "Markdown" },
            { value: "code", label: "Code" },
            { value: "file", label: "Files" },
            { value: "gallery", label: "Galleries" },
          ]}
          className="w-36"
        />
      </div>

      {/* Share list */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : shares?.data && shares.data.length > 0 ? (
        <>
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
            <div className="hidden sm:grid grid-cols-[2rem_1fr_6rem_5rem_7rem] gap-4 px-4 py-2.5 text-xs font-medium text-neutral-500 border-b border-neutral-200 dark:border-neutral-800">
              <div></div>
              <div>Title / Slug</div>
              <div>Created</div>
              <div>Views</div>
              <div className="text-right">Actions</div>
            </div>
            {shares.data.map((share) => {
              const Icon = typeIcons[share.type] || LinkIcon;
              return (
                <div
                  key={share.id}
                  className="grid grid-cols-1 sm:grid-cols-[2rem_1fr_6rem_5rem_7rem] gap-2 sm:gap-4 px-4 py-3 border-b border-neutral-100 dark:border-neutral-800/50 hover:bg-neutral-50 dark:hover:bg-neutral-800/20 transition-colors items-center"
                >
                  <Icon size={16} className={`${typeColors[share.type]} hidden sm:block`} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Icon size={14} className={`${typeColors[share.type]} sm:hidden`} />
                      <span className="font-medium text-neutral-800 dark:text-neutral-200 truncate">{share.title || share.slug}</span>
                      {!!share.encrypted && <Badge variant="warning">E2E</Badge>}
                    </div>
                    <div className="text-xs text-neutral-500 font-mono truncate">/s/{share.slug}</div>
                      {share.comment && <div className="text-xs text-neutral-400 dark:text-neutral-600 truncate italic">{share.comment}</div>}
                  </div>
                  <div className="text-xs text-neutral-500 hidden sm:block">
                    {new Date(share.created_at).toLocaleDateString()}
                  </div>
                  <div className="text-sm text-neutral-600 dark:text-neutral-400 hidden sm:block">{share.hits}</div>
                  <div className="flex gap-0.5 justify-end">
                    <button onClick={() => copyUrl(share.slug, !!share.encrypted)} className="p-1.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300" title="Copy URL">
                      <Copy size={15} />
                    </button>
                    <a href={`/s/${share.slug}`} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300" title="Open">
                      <ExternalLink size={15} />
                    </a>
                    <button
                      onClick={() => { if (confirm("Delete this share?")) deleteShare.mutate(share.id); }}
                      className="p-1.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-500 hover:text-red-500 dark:hover:text-red-400" title="Delete"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {shares.meta.total > shares.meta.per_page && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-500">
                {shares.meta.total} total · page {page}
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="secondary" size="sm" disabled={page * shares.meta.per_page >= shares.meta.total} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-20">
          <BarChart3 size={48} className="mx-auto mb-4 text-neutral-300 dark:text-neutral-700" />
          <p className="text-neutral-600 dark:text-neutral-400 text-lg mb-1">
            {search || typeFilter ? "No matches found" : "No shares yet"}
          </p>
          <p className="text-neutral-400 dark:text-neutral-600 text-sm mb-6">
            {search || typeFilter ? "Try adjusting your search or filter" : "Create your first share to get started"}
          </p>
          {!search && !typeFilter && (
            <Button onClick={() => setWizardOpen(true)}>
              <Plus size={16} /> New Share
            </Button>
          )}
        </div>
      )}

      <NewShareWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Eye }) {
  return (
    <div className="flex items-center gap-2 p-3 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg">
      <Icon size={16} className="text-neutral-500" />
      <div>
        <div className="text-lg font-bold text-neutral-900 dark:text-neutral-100">{value}</div>
        <div className="text-xs text-neutral-500">{label}</div>
      </div>
    </div>
  );
}
