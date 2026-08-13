import type { ReactNode } from "react";
import { Button } from "./Button";

export function AppNotice({
  children,
  tone = "info",
  actionLabel,
  onAction,
  onDismiss,
  className = ""
}: {
  children: ReactNode;
  tone?: "info" | "success" | "error";
  actionLabel?: string | undefined;
  onAction?: (() => void | Promise<void>) | undefined;
  onDismiss?: (() => void) | undefined;
  className?: string;
}) {
  return (
    <div
      className={`app-notice app-notice--${tone} ${className}`.trim()}
      role={tone === "error" ? "alert" : "status"}
    >
      <span className="app-notice-mark" aria-hidden="true">
        {tone === "error" ? "!" : tone === "success" ? "✓" : "i"}
      </span>
      <div className="app-notice-content">{children}</div>
      {(actionLabel || onDismiss) && (
        <div className="app-notice-actions">
          {actionLabel && onAction && (
            <Button variant="ghost" size="small" onClick={() => void onAction()}>
              {actionLabel}
            </Button>
          )}
          {onDismiss && (
            <Button variant="ghost" size="icon" aria-label="关闭消息" onClick={onDismiss}>×</Button>
          )}
        </div>
      )}
    </div>
  );
}
