export const PROTECTION_MODE_ATTRIBUTE = "data-sanctuary-protection-mode";

export function applyProtectionModeAttribute(
  root: HTMLElement | null,
  enabled: boolean
): boolean {
  if (!root) return false;
  root.setAttribute(PROTECTION_MODE_ATTRIBUTE, enabled ? "on" : "off");
  return true;
}
