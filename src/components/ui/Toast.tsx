import { useState, useCallback, createContext, useContext, type ReactNode } from "react";
import { X, CheckCircle, AlertCircle, Info } from "lucide-react";

interface Toast {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

interface ToastContextValue {
  toast: (type: Toast["type"], message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((type: Toast["type"], message: string) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border backdrop-blur-sm min-w-[300px] animate-in slide-in-from-right ${
              t.type === "success"
                ? "bg-green-50/90 dark:bg-green-950/80 border-green-300 dark:border-green-800 text-green-800 dark:text-green-200"
                : t.type === "error"
                  ? "bg-red-50/90 dark:bg-red-950/80 border-red-300 dark:border-red-800 text-red-800 dark:text-red-200"
                  : "bg-blue-50/90 dark:bg-blue-950/80 border-blue-300 dark:border-blue-800 text-blue-800 dark:text-blue-200"
            }`}
          >
            {t.type === "success" && <CheckCircle size={18} />}
            {t.type === "error" && <AlertCircle size={18} />}
            {t.type === "info" && <Info size={18} />}
            <span className="flex-1 text-sm">{t.message}</span>
            <button onClick={() => removeToast(t.id)} className="opacity-60 hover:opacity-100">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
