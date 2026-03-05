import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { api } from "../../api/client";
import { usePasskeys, useRenamePasskey, useDeletePasskey } from "../../api/hooks";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Spinner } from "../../components/ui/Spinner";
import { useToast } from "../../components/ui/Toast";
import { KeyRound, Plus, Trash2, Edit2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/settings/passkeys")({
  component: PasskeysPage,
});

function PasskeysPage() {
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
    <div>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
        Passkeys provide passwordless authentication using biometrics or security keys.
      </p>

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
    </div>
  );
}
