import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { api } from "../api/client";
import {
  usePasskeys, useRenamePasskey, useDeletePasskey,
  useApiKeys, useCreateApiKey, useDeleteApiKey,
} from "../api/hooks";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../components/ui/Toast";
import { KeyRound, Plus, Trash2, Edit2, Key, Copy, Check, Shield } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Settings</h1>
      <PasskeysSection />
      <ApiKeysSection />
    </div>
  );
}

function PasskeysSection() {
  const { data: passkeys, isLoading } = usePasskeys();
  const renamePasskey = useRenamePasskey();
  const deletePasskey = useDeletePasskey();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [addingPasskey, setAddingPasskey] = useState(false);
  const [newPasskeyName, setNewPasskeyName] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleRename = (id: string) => {
    renamePasskey.mutate(
      { id, name: editName },
      {
        onSuccess: () => { setEditingId(null); toast("success", "Passkey renamed"); },
        onError: (e) => toast("error", e.message),
      }
    );
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this passkey?")) return;
    deletePasskey.mutate(id, {
      onError: (e) => toast("error", e.message),
      onSuccess: () => toast("success", "Passkey deleted"),
    });
  };

  const handleAddPasskey = async () => {
    setAddingPasskey(true);
    try {
      const options = await api.post<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/api/passkeys/register/options");
      const credential = await startRegistration({ optionsJSON: options });
      await api.post("/api/passkeys/register/verify", { credential, name: newPasskeyName || "New passkey" });
      queryClient.invalidateQueries({ queryKey: ["passkeys"] });
      setNewPasskeyName("");
      toast("success", "Passkey added!");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to add passkey");
    } finally {
      setAddingPasskey(false);
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield size={20} className="text-primary" />
          <h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-200">Passkeys</h2>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : (
        <div className="space-y-2">
          {passkeys?.map((pk) => (
            <div key={pk.id} className="flex items-center gap-4 p-4 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg">
              <KeyRound size={18} className="text-neutral-500 dark:text-neutral-400 shrink-0" />
              <div className="flex-1 min-w-0">
                {editingId === pk.id ? (
                  <div className="flex gap-2">
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="flex-1" autoFocus onKeyDown={(e) => e.key === "Enter" && handleRename(pk.id)} />
                    <Button size="sm" onClick={() => handleRename(pk.id)}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                  </div>
                ) : (
                  <>
                    <div className="font-medium text-neutral-800 dark:text-neutral-200">{pk.name || "Unnamed passkey"}</div>
                    <div className="text-xs text-neutral-500">
                      Created {new Date(pk.created_at).toLocaleDateString()}
                      {pk.last_used_at && ` · Last used ${new Date(pk.last_used_at).toLocaleDateString()}`}
                    </div>
                  </>
                )}
              </div>
              {editingId !== pk.id && (
                <div className="flex gap-1">
                  <button onClick={() => { setEditingId(pk.id); setEditName(pk.name || ""); }} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"><Edit2 size={16} /></button>
                  <button onClick={() => handleDelete(pk.id)} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 hover:text-red-500 dark:hover:text-red-400"><Trash2 size={16} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <Input value={newPasskeyName} onChange={(e) => setNewPasskeyName(e.target.value)} placeholder="Passkey name (optional)" className="flex-1" />
        <Button onClick={handleAddPasskey} loading={addingPasskey} variant="secondary">
          <Plus size={16} /> Add Passkey
        </Button>
      </div>
    </section>
  );
}

function ApiKeysSection() {
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
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Key size={20} className="text-accent" />
          <h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-200">API Keys</h2>
        </div>
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
        <div className="text-center py-6 text-neutral-500 text-sm">No API keys.</div>
      )}

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
    </section>
  );
}
