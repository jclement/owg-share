import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useApiKeys, useCreateApiKey, useDeleteApiKey } from "../../api/hooks";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Spinner } from "../../components/ui/Spinner";
import { useToast } from "../../components/ui/Toast";
import { Key, Plus, Trash2, Copy, Check } from "lucide-react";

export const Route = createFileRoute("/settings/api-keys")({
  component: ApiKeysPage,
});

function ApiKeysPage() {
  const { data: apiKeys, isLoading } = useApiKeys();
  const createApiKey = useCreateApiKey();
  const deleteApiKey = useDeleteApiKey();
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyResult, setNewKeyResult] = useState<{ key: string; name: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const { toast } = useToast();

  const handleCreate = () => {
    if (!newKeyName.trim()) { toast("error", "Name is required"); return; }
    createApiKey.mutate(
      { name: newKeyName.trim() },
      {
        onSuccess: (data) => {
          setNewKeyResult({ key: data.key, name: data.name });
          setNewKeyName("");
        },
        onError: (e) => toast("error", e.message),
      }
    );
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this API key?")) return;
    deleteApiKey.mutate(id, { onSuccess: () => toast("success", "API key deleted") });
  };

  const copyKey = () => {
    if (newKeyResult) {
      navigator.clipboard.writeText(newKeyResult.key);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            API keys allow programmatic access to create and manage shares.
          </p>
          <Button size="sm" variant="secondary" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> Create Key
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : apiKeys && apiKeys.length > 0 ? (
          <div className="space-y-2">
            {apiKeys.map((key) => (
              <div key={key.id} className="flex items-center gap-4 p-4 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg">
                <Key size={18} className="text-neutral-500 dark:text-neutral-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-neutral-800 dark:text-neutral-200">{key.name}</div>
                  <div className="text-xs text-neutral-500">
                    <span className="font-mono">{key.key_prefix}...</span>
                    {" · "}Created {new Date(key.created_at).toLocaleDateString()}
                    {key.last_used_at && ` · Last used ${new Date(key.last_used_at).toLocaleDateString()}`}
                  </div>
                </div>
                <button onClick={() => handleDelete(key.id)} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 hover:text-red-500 dark:hover:text-red-400">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-neutral-500 text-sm">No API keys yet. Create one to get started.</div>
        )}
      </div>

      {/* API Usage Examples */}
      <div>
        <h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-200 mb-3">API Usage</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
          Use your API key in the <code className="text-xs bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded font-mono">Authorization</code> header.
        </p>
        <div className="space-y-4">
          <CurlExample
            title="Create a link share"
            command={`curl -X POST $BASE_URL/api/shares/links \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://example.com",
    "title": "Example Link",
    "comment": "Internal note"
  }'`}
          />
          <CurlExample
            title="Create a markdown share"
            command={`curl -X POST $BASE_URL/api/shares/markdown \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "content": "# Hello World\\nSome **markdown** content.",
    "title": "My Document"
  }'`}
          />
          <CurlExample
            title="Create a code share"
            command={`curl -X POST $BASE_URL/api/shares/code \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "content": "console.log(\\\"hello world\\\");",
    "language": "javascript",
    "filename": "hello.js",
    "title": "Hello World"
  }'`}
          />
          <CurlExample
            title="Upload a file (two steps)"
            command={`# Step 1: Get an upload URL
curl -X POST $BASE_URL/api/upload/presign \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "filename": "photo.jpg",
    "contentType": "image/jpeg",
    "size": 102400
  }'
# Returns: { "uploadId": "...", "r2Key": "..." }

# Step 2: Upload the file
curl -X PUT $BASE_URL/api/upload/file/UPLOAD_ID \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  --data-binary @photo.jpg

# Step 3: Create the file share
curl -X POST $BASE_URL/api/shares/files \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "filename": "photo.jpg",
    "content_type": "image/jpeg",
    "size": 102400,
    "r2_key": "R2_KEY_FROM_STEP_1",
    "title": "My Photo"
  }'`}
          />
          <CurlExample
            title="List all shares"
            command={`curl $BASE_URL/api/shares \\
  -H "Authorization: Bearer YOUR_API_KEY"`}
          />
          <CurlExample
            title="Delete a share"
            command={`curl -X DELETE $BASE_URL/api/shares/SHARE_ID \\
  -H "Authorization: Bearer YOUR_API_KEY"`}
          />
        </div>
      </div>

      <Modal open={showCreate} onClose={() => { setShowCreate(false); setNewKeyResult(null); }} title="Create API Key">
        {newKeyResult ? (
          <div className="space-y-4">
            <p className="text-sm text-neutral-700 dark:text-neutral-300">Your API key has been created. Copy it now — you won't be able to see it again.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm text-green-600 dark:text-green-400 bg-neutral-100 dark:bg-neutral-950 px-3 py-2 rounded-lg font-mono break-all">
                {newKeyResult.key}
              </code>
              <Button variant="secondary" size="sm" onClick={copyKey}>
                {copiedKey ? <Check size={16} /> : <Copy size={16} />}
              </Button>
            </div>
            <Button onClick={() => { setShowCreate(false); setNewKeyResult(null); }} className="w-full" variant="secondary">
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Input label="Key name" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="My script" autoFocus onKeyDown={(e) => e.key === "Enter" && handleCreate()} />
            <Button onClick={handleCreate} loading={createApiKey.isPending} className="w-full">Create Key</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function CurlExample({ title, command }: { title: string; command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200 dark:border-neutral-800">
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{title}</span>
        <button onClick={copy} className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300">
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre className="p-3 text-xs font-mono text-neutral-800 dark:text-neutral-200 overflow-x-auto whitespace-pre">{command}</pre>
    </div>
  );
}
