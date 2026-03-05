import type { ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  variant?: "default" | "primary" | "success" | "warning" | "danger";
}

const variants = {
  default: "bg-neutral-200 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300",
  primary: "bg-primary/10 dark:bg-primary/20 text-primary-dark dark:text-primary-light",
  success: "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400",
  warning: "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400",
  danger: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400",
};

export function Badge({ children, variant = "default" }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${variants[variant]}`}>
      {children}
    </span>
  );
}
