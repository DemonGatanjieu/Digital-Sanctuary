export const PROTECTION_MODE_ATTRIBUTE = "data-sanctuary-protection-mode";
export const MIN_IMAGE_CONTAINER_SIZE = 60;

export function applyProtectionModeAttribute(
  root: HTMLElement | null,
  enabled: boolean
): boolean {
  if (!root) return false;
  root.setAttribute(PROTECTION_MODE_ATTRIBUTE, enabled ? "on" : "off");
  return true;
}

export function hasUsableImageContainerBox(element: HTMLElement | null): boolean {
  if (!element?.isConnected) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > MIN_IMAGE_CONTAINER_SIZE && rect.height > MIN_IMAGE_CONTAINER_SIZE;
}
