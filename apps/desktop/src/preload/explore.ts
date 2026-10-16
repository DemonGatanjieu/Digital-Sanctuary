import { ipcRenderer, webFrame } from "electron";
import {
  applyProtectionModeAttribute,
  extractArtworkFileKey,
  findImageCardContainer,
  measureEffectiveImagePriority,
  normalizeArtworkUrl
} from "./explore-dom.js";

type ReviewPriority = "visible" | "near";
type ReviewState = "allowed" | "blocked" | "unavailable";

interface ReviewResultMessage {
  normalizedUrl: string;
  state: ReviewState;
  reasons: string[];
}

interface PreferenceCalibrationResult {
  success: boolean;
  feedbackId: string | null;
  pageKey: string;
  changes: Array<{
    label: string;
    confidence: number;
    oldThreshold: number;
    newThreshold: number;
  }>;
  personalChanges: Array<{
    label: string;
    oldWeight: number;
    newWeight: number;
    oldEvidence: number;
    newEvidence: number;
  }>;
}

interface DislikeTagCandidate {
  label: string;
  confidence: number;
  recommended: boolean;
  existingWeight: number;
  evidenceCount: number;
}

interface DislikeCandidatesResult {
  success: boolean;
  pageKey: string | null;
  candidates: DislikeTagCandidate[];
}

interface DislikeFeedbackResult {
  success: boolean;
  feedbackId: string;
  pageKey: string;
  selectedTags: Array<{ label: string; confidence: number }>;
  changes: Array<{
    label: string;
    oldWeight: number;
    newWeight: number;
    oldEvidence: number;
    newEvidence: number;
  }>;
}

const REVIEW_STATE_ATTRIBUTE = "data-sanctuary-review-state";
const REVIEW_RELOAD_ATTRIBUTE = "data-sanctuary-review-reloaded";
const MAX_PAGE_OUTCOMES = 500;
const outcomes = new Map<string, ReviewResultMessage>();
const trackedImages = new Map<HTMLImageElement, string>();
const nearImages = new Map<string, Set<HTMLImageElement>>();
const visibleImages = new Map<string, Set<HTMLImageElement>>();
const submittedPriorities = new Map<string, ReviewPriority>();
let protectionEnabled = true;
let activeDislikePopoverUrl: string | null = null;
let activeDislikePopoverCleanup: (() => void) | null = null;

function syncProtectionModeAttribute(): void {
  applyProtectionModeAttribute(document.documentElement, protectionEnabled);
}

syncProtectionModeAttribute();

const protectionCss = `
  html[data-sanctuary-protection-mode="on"] img[src*="i.pximg.net"][src*="/img-master/"]:not([${REVIEW_STATE_ATTRIBUTE}="allowed"]),
  html[data-sanctuary-protection-mode="on"] img[src*="i.pximg.net"][src*="/img-original/"]:not([${REVIEW_STATE_ATTRIBUTE}="allowed"]),
  html[data-sanctuary-protection-mode="on"] img[src*="i.pximg.net"][src*="/custom-thumb/"]:not([${REVIEW_STATE_ATTRIBUTE}="allowed"]),
  html[data-sanctuary-protection-mode="on"] img[srcset*="i.pximg.net"][srcset*="/img-master/"]:not([${REVIEW_STATE_ATTRIBUTE}="allowed"]),
  html[data-sanctuary-protection-mode="on"] img[srcset*="i.pximg.net"][srcset*="/img-original/"]:not([${REVIEW_STATE_ATTRIBUTE}="allowed"]),
  html[data-sanctuary-protection-mode="on"] img[srcset*="i.pximg.net"][srcset*="/custom-thumb/"]:not([${REVIEW_STATE_ATTRIBUTE}="allowed"]),
  html[data-sanctuary-protection-mode="on"] img[${REVIEW_STATE_ATTRIBUTE}="pending"],
  html[data-sanctuary-protection-mode="on"] img[${REVIEW_STATE_ATTRIBUTE}="unavailable"] {
    filter: blur(18px) saturate(0.72) !important;
    opacity: 0.08 !important;
    transition: filter 220ms ease, opacity 220ms ease !important;
  }
  html[data-sanctuary-protection-mode="on"] img[${REVIEW_STATE_ATTRIBUTE}="blocked"] {
    visibility: hidden !important;
    opacity: 0 !important;
  }
  img[${REVIEW_STATE_ATTRIBUTE}="allowed"] {
    filter: none !important;
    opacity: 1 !important;
    visibility: visible !important;
    transition: filter 180ms ease, opacity 180ms ease !important;
  }
  html[data-sanctuary-protection-mode="off"] .sanctuary-review-overlay {
    display: none !important;
  }
  html[data-sanctuary-protection-mode="off"] .sanctuary-dislike-control {
    display: none !important;
  }
  .sanctuary-review-overlay {
    position: absolute;
    inset: 0;
    z-index: 2147483640;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 9px;
    padding: 14px;
    background:
      radial-gradient(circle at 18% 12%, rgba(0, 150, 250, 0.1), transparent 42%),
      rgba(250, 251, 253, 0.965);
    border: 1px solid rgba(199, 207, 218, 0.72);
    border-radius: 12px;
    box-sizing: border-box;
    color: #344054;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    text-align: center;
    backdrop-filter: blur(14px);
    pointer-events: auto;
    cursor: default;
    min-height: 100%;
    min-width: 100%;
    transition: opacity 180ms ease;
    box-shadow: inset 0 1px rgba(255,255,255,0.8);
  }
  .sanctuary-review-overlay.unavailable {
    background: rgba(249, 250, 251, 0.97);
    border-style: dashed;
  }
  .sanctuary-review-overlay.compact {
    padding: 4px 2px;
    gap: 3px;
    border-radius: 6px;
  }
  .sanctuary-blocked-badge {
    font-size: 13px;
    font-weight: 700;
    color: #1f2937;
    display: flex;
    align-items: center;
    gap: 4px;
    line-height: 1.2;
  }
  .sanctuary-review-overlay.compact .sanctuary-blocked-badge {
    font-size: 10px;
  }
  .sanctuary-blocked-reason {
    font-size: 11px;
    color: #4b5563;
    max-width: 90%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: rgba(0, 0, 0, 0.05);
    padding: 2px 8px;
    border-radius: 4px;
  }
  .sanctuary-blocked-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }
  .sanctuary-blocked-btn {
    padding: 6px 14px;
    border: 1px solid #93c5fd;
    border-radius: 6px;
    background: #eff6ff;
    color: #1d4ed8;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    line-height: 1.2;
    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    transition: all 120ms ease;
  }
  .sanctuary-review-overlay.compact .sanctuary-blocked-btn {
    padding: 2px 5px;
    font-size: 9px;
    border-radius: 4px;
  }
  .sanctuary-blocked-btn:hover {
    background: #dbeafe;
    border-color: #3b82f6;
    transform: translateY(-1px);
    box-shadow: 0 3px 6px rgba(0,0,0,0.1);
  }
  .sanctuary-blocked-btn.calibrate {
    border-color: #a7f3d0;
    background: #ecfdf5;
    color: #047857;
  }
  .sanctuary-blocked-btn.calibrate:hover {
    background: #d1fae5;
    border-color: #10b981;
  }
  .sanctuary-blocked-btn.inspect {
    border-color: #ddd6fe;
    background: #f5f3ff;
    color: #6d28d9;
  }
  .sanctuary-blocked-btn.inspect:hover {
    background: #ede9fe;
    border-color: #8b5cf6;
  }
  .sanctuary-review-overlay.compact .sanctuary-blocked-btn.inspect {
    display: none;
  }
  .sanctuary-preference-toast {
    position: fixed;
    right: 24px;
    bottom: 24px;
    z-index: 2147483646;
    display: flex;
    max-width: min(460px, calc(100vw - 48px));
    align-items: center;
    gap: 12px;
    padding: 13px 15px;
    border: 1px solid rgba(16, 185, 129, 0.28);
    border-radius: 14px;
    color: #065f46;
    background: rgba(236, 253, 245, 0.97);
    box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
    font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    backdrop-filter: blur(16px);
  }
  .sanctuary-preference-toast span { flex: 1; }
  .sanctuary-preference-toast button {
    padding: 5px 9px;
    border: 1px solid rgba(5, 150, 105, 0.36);
    border-radius: 8px;
    color: #047857;
    background: rgba(255,255,255,0.72);
    cursor: pointer;
    font: inherit;
    font-weight: 700;
  }
  .sanctuary-dislike-control {
    position: absolute;
    top: 10px;
    left: 10px;
    z-index: 2147483638;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 7px 10px;
    border: 1px solid rgba(255, 255, 255, 0.7);
    border-radius: 999px;
    color: #374151;
    background: rgba(255, 255, 255, 0.88);
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.13);
    font: 600 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    opacity: 0;
    transform: translateY(-3px);
    transition: opacity 150ms ease, transform 150ms ease, background 150ms ease;
    cursor: pointer;
    backdrop-filter: blur(14px);
    box-sizing: border-box !important;
    width: auto !important;
    min-width: max-content !important;
    max-width: none !important;
    height: 30px !important;
    white-space: nowrap !important;
    writing-mode: horizontal-tb !important;
    line-height: 1 !important;
  }
  *:hover > .sanctuary-dislike-control,
  *:focus-within > .sanctuary-dislike-control,
  .sanctuary-dislike-control:focus-visible,
  .sanctuary-dislike-control[aria-expanded="true"] {
    opacity: 1;
    transform: translateY(0);
  }
  .sanctuary-dislike-control:hover {
    color: #111827;
    background: rgba(255, 255, 255, 0.98);
  }
  .sanctuary-dislike-control:focus-visible {
    outline: 2px solid rgba(0, 150, 250, 0.62);
    outline-offset: 2px;
  }
  .sanctuary-dislike-popover {
    position: fixed;
    z-index: 2147483647;
    width: min(390px, calc(100vw - 28px));
    padding: 18px;
    box-sizing: border-box;
    border: 1px solid rgba(209, 213, 219, 0.86);
    border-radius: 18px;
    color: #1f2937;
    background: rgba(255, 255, 255, 0.975);
    box-shadow: 0 24px 70px rgba(15, 23, 42, 0.22);
    font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    backdrop-filter: blur(22px);
  }
  .sanctuary-dislike-popover h3 {
    margin: 0;
    color: #111827;
    font-size: 16px;
    line-height: 1.35;
  }
  .sanctuary-dislike-popover p {
    margin: 6px 0 14px;
    color: #6b7280;
  }
  .sanctuary-dislike-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    max-height: 190px;
    overflow: auto;
    padding: 1px;
  }
  .sanctuary-dislike-tag {
    padding: 7px 10px;
    border: 1px solid #e5e7eb;
    border-radius: 999px;
    color: #4b5563;
    background: #f9fafb;
    font: inherit;
    cursor: pointer;
    transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
  }
  .sanctuary-dislike-tag[aria-pressed="true"] {
    border-color: rgba(0, 150, 250, 0.52);
    color: #075985;
    background: #f0f9ff;
  }
  .sanctuary-dislike-tag small {
    margin-left: 4px;
    color: #9ca3af;
  }
  .sanctuary-dislike-empty {
    padding: 12px;
    border-radius: 12px;
    color: #6b7280;
    background: #f9fafb;
  }
  .sanctuary-dislike-footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
  }
  .sanctuary-dislike-footer button {
    padding: 8px 12px;
    border: 1px solid #d1d5db;
    border-radius: 10px;
    color: #4b5563;
    background: #fff;
    font: inherit;
    font-weight: 650;
    cursor: pointer;
  }
  .sanctuary-dislike-footer button.primary {
    border-color: #0096fa;
    color: #fff;
    background: linear-gradient(135deg, #00a8ff, #0088e8);
    box-shadow: 0 8px 22px rgba(0, 150, 250, 0.24);
  }
  .sanctuary-dislike-footer button:disabled {
    opacity: 0.55;
    cursor: wait;
  }
`;

webFrame.insertCSS(protectionCss, { cssOrigin: "user" });

function artworkUrlForImage(image: HTMLImageElement): string | null {
  return normalizeArtworkUrl(
    image.currentSrc || image.getAttribute("src") || image.getAttribute("srcset")?.split(/[ ,]/)[0]
  );
}

function setMembership(
  collection: Map<string, Set<HTMLImageElement>>,
  url: string,
  image: HTMLImageElement,
  active: boolean
): void {
  const members = collection.get(url);
  if (active) {
    if (members) members.add(image);
    else collection.set(url, new Set([image]));
    return;
  }
  members?.delete(image);
  if (members?.size === 0) collection.delete(url);
}

function removeImageMembership(image: HTMLImageElement, url: string): void {
  setMembership(nearImages, url, image, false);
  setMembership(visibleImages, url, image, false);
  syncCandidate(url);
}

function syncCandidate(normalizedUrl: string): void {
  if (!protectionEnabled) return;
  if (findOutcomeForUrl(normalizedUrl)) {
    submittedPriorities.delete(normalizedUrl);
    return;
  }
  const priority: ReviewPriority | null = visibleImages.has(normalizedUrl)
    ? "visible"
    : nearImages.has(normalizedUrl)
      ? "near"
      : null;
  const submitted = submittedPriorities.get(normalizedUrl);
  if (!priority) {
    if (submitted) {
      submittedPriorities.delete(normalizedUrl);
      ipcRenderer.send("explore:review-inactive", { normalizedUrl });
    }
    return;
  }
  if (submitted === priority) return;
  submittedPriorities.set(normalizedUrl, priority);
  ipcRenderer.send("explore:review-candidate", {
    normalizedUrl,
    priority,
    referrer: location.href
  });
}

function reloadFailedImage(image: HTMLImageElement, normalizedUrl: string): void {
  if (!image.complete || image.naturalWidth > 0) return;
  if (image.getAttribute(REVIEW_RELOAD_ATTRIBUTE) === normalizedUrl) return;
  const source = image.getAttribute("src");
  const sourceSet = image.getAttribute("srcset");
  if (!source && !sourceSet) return;
  image.setAttribute(REVIEW_RELOAD_ATTRIBUTE, normalizedUrl);
  if (source) image.removeAttribute("src");
  if (sourceSet) image.removeAttribute("srcset");
  queueMicrotask(() => {
    if (sourceSet) image.setAttribute("srcset", sourceSet);
    if (source) image.setAttribute("src", source);
  });
}

function removeReviewOverlay(image: HTMLImageElement, url: string): void {
  const targetKey = extractArtworkFileKey(url);
  const container = findImageCardContainer(image);
  const existing = container.querySelector(`[data-sanctuary-review-overlay]`);
  if (existing) existing.remove();
  for (const el of document.querySelectorAll(`[data-sanctuary-review-overlay]`)) {
    const elUrl = el.getAttribute("data-sanctuary-review-overlay");
    if (elUrl === url || (targetKey && extractArtworkFileKey(elUrl) === targetKey)) {
      el.remove();
    }
  }
}

function removeAllowedControl(image: HTMLImageElement, url: string): void {
  const container = findImageCardContainer(image);
  for (const control of container.querySelectorAll<HTMLElement>("[data-sanctuary-dislike-control]")) {
    if (control.getAttribute("data-sanctuary-dislike-control") === url) control.remove();
  }
  if (activeDislikePopoverUrl === url) closeDislikePopover();
}

function closeDislikePopover(): void {
  activeDislikePopoverCleanup?.();
  activeDislikePopoverCleanup = null;
  document.querySelector(".sanctuary-dislike-popover")?.remove();
  for (const control of document.querySelectorAll<HTMLElement>(".sanctuary-dislike-control")) {
    control.setAttribute("aria-expanded", "false");
  }
  activeDislikePopoverUrl = null;
}

function renderAllowedControl(image: HTMLImageElement, normalizedUrl: string): void {
  const container = findImageCardContainer(image);
  if (!container || !container.isConnected || container === image) return;
  const existing = [...container.querySelectorAll<HTMLElement>("[data-sanctuary-dislike-control]")]
    .find((control) => control.getAttribute("data-sanctuary-dislike-control") === normalizedUrl);
  if (existing) return;

  const control = document.createElement("button");
  control.type = "button";
  control.className = "sanctuary-dislike-control";
  control.setAttribute("data-sanctuary-dislike-control", normalizedUrl);
  control.setAttribute("aria-expanded", "false");
  control.textContent = "−  少看类似";
  control.title = "不喜欢这张？选择希望以后少见的画面元素";
  control.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (activeDislikePopoverUrl === normalizedUrl) {
      closeDislikePopover();
      return;
    }
    closeDislikePopover();
    control.disabled = true;
    const originalText = control.textContent;
    control.textContent = "读取标签…";
    try {
      const result = await ipcRenderer.invoke(
        "explore:get-dislike-candidates",
        { normalizedUrl }
      ) as DislikeCandidatesResult;
      if (!result.success) throw new Error("无法读取本地分析结果");
      openDislikePopover(control, normalizedUrl, result.candidates);
    } catch (error) {
      console.warn("[explore] failed to load dislike candidates", error);
      showSimplePreferenceToast(error instanceof Error ? error.message : "标签读取失败，请稍后重试", "error");
    } finally {
      control.disabled = false;
      control.textContent = originalText;
    }
  });

  if (getComputedStyle(container).position === "static") {
    container.style.setProperty("position", "relative", "important");
  }
  container.appendChild(control);
}

function openDislikePopover(
  trigger: HTMLButtonElement,
  normalizedUrl: string,
  candidates: readonly DislikeTagCandidate[]
): void {
  closeDislikePopover();
  activeDislikePopoverUrl = normalizedUrl;
  trigger.setAttribute("aria-expanded", "true");
  const popover = document.createElement("section");
  popover.className = "sanctuary-dislike-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", "少看类似元素");
  popover.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  const title = document.createElement("h3");
  title.textContent = "这张图里，哪些元素不合口味？";
  const description = document.createElement("p");
  description.textContent = "只使用本地 WD Tagger 已识别的标签。推荐项已勾选，你可以再调整。";
  const tags = document.createElement("div");
  tags.className = "sanctuary-dislike-tags";
  const selected = new Set(
    candidates.filter((candidate) => candidate.recommended).slice(0, 4).map((candidate) => candidate.label)
  );
  const tagButtons = new Map<string, HTMLButtonElement>();

  if (candidates.length === 0) {
    const empty = document.createElement("div");
    empty.className = "sanctuary-dislike-empty";
    empty.textContent = "这张图片没有足够明确的候选标签。你仍可以只隐藏当前作品。";
    tags.appendChild(empty);
  } else {
    for (const candidate of candidates) {
      const tag = document.createElement("button");
      tag.type = "button";
      tag.className = "sanctuary-dislike-tag";
      tag.setAttribute("aria-pressed", selected.has(candidate.label) ? "true" : "false");
      tag.append(document.createTextNode(candidate.label));
      const confidence = document.createElement("small");
      confidence.textContent = `${Math.round(candidate.confidence * 100)}%`;
      tag.appendChild(confidence);
      tag.title = candidate.evidenceCount > 0
        ? `已有 ${candidate.evidenceCount} 次证据 · 当前偏好权重 ${Math.round(candidate.existingWeight * 100)}%`
        : "尚未学习这个标签";
      tag.addEventListener("click", () => {
        if (selected.has(candidate.label)) selected.delete(candidate.label);
        else if (selected.size < 5) selected.add(candidate.label);
        tag.setAttribute("aria-pressed", selected.has(candidate.label) ? "true" : "false");
        updatePrimaryLabel();
      });
      tagButtons.set(candidate.label, tag);
      tags.appendChild(tag);
    }
  }

  const footer = document.createElement("div");
  footer.className = "sanctuary-dislike-footer";
  const exactOnly = document.createElement("button");
  exactOnly.type = "button";
  exactOnly.textContent = "仅隐藏这张";
  const learn = document.createElement("button");
  learn.type = "button";
  learn.className = "primary";
  const updatePrimaryLabel = (): void => {
    learn.textContent = selected.size > 0 ? `少看类似（${selected.size}）` : "选择元素后学习";
    learn.disabled = selected.size === 0;
  };
  updatePrimaryLabel();

  const submit = async (selectedLabels: string[]): Promise<void> => {
    exactOnly.disabled = true;
    learn.disabled = true;
    for (const button of tagButtons.values()) button.disabled = true;
    try {
      const result = await ipcRenderer.invoke("explore:record-dislike", {
        normalizedUrl,
        selectedLabels
      }) as DislikeFeedbackResult;
      if (!result.success) throw new Error("偏好没有保存成功");
      closeDislikePopover();
      showDislikePreferenceToast(result);
      const nextOutcome: ReviewResultMessage = {
        normalizedUrl,
        state: "blocked",
        reasons: [selectedLabels.length > 0 ? "个人偏好：少看类似元素" : "个人偏好：仅隐藏这张"]
      };
      outcomes.set(normalizedUrl, nextOutcome);
      const outcomeKey = extractArtworkFileKey(normalizedUrl);
      for (const [trackedImage, url] of trackedImages) {
        if (url === normalizedUrl || (outcomeKey && extractArtworkFileKey(url) === outcomeKey)) {
          applyOutcome(trackedImage, nextOutcome);
        }
      }
    } catch (error) {
      console.warn("[explore] failed to record dislike", error);
      showSimplePreferenceToast(error instanceof Error ? error.message : "偏好保存失败，请重试", "error");
      exactOnly.disabled = false;
      for (const button of tagButtons.values()) button.disabled = false;
      updatePrimaryLabel();
    }
  };
  exactOnly.addEventListener("click", () => void submit([]));
  learn.addEventListener("click", () => void submit([...selected]));
  footer.append(exactOnly, learn);
  popover.append(title, description, tags, footer);
  document.documentElement.appendChild(popover);

  const triggerRect = trigger.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  const left = Math.min(
    window.innerWidth - popoverRect.width - 14,
    Math.max(14, triggerRect.left)
  );
  const below = triggerRect.bottom + 10;
  const top = below + popoverRect.height <= window.innerHeight - 14
    ? below
    : Math.max(14, triggerRect.top - popoverRect.height - 10);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;

  const closeOnPointer = (event: PointerEvent): void => {
    if (popover.contains(event.target as Node) || trigger.contains(event.target as Node)) return;
    closeDislikePopover();
  };
  const closeOnEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    closeDislikePopover();
    trigger.focus();
  };
  const cleanup = (): void => {
    document.removeEventListener("pointerdown", closeOnPointer, true);
    document.removeEventListener("keydown", closeOnEscape, true);
  };
  activeDislikePopoverCleanup = cleanup;
  queueMicrotask(() => {
    if (activeDislikePopoverCleanup !== cleanup) return;
    document.addEventListener("pointerdown", closeOnPointer, true);
    document.addEventListener("keydown", closeOnEscape, true);
  });
}

function renderBlockedOverlay(image: HTMLImageElement, outcome: ReviewResultMessage): void {
  const container = findImageCardContainer(image);
  if (!container || !container.isConnected) return;
  removeReviewOverlay(image, outcome.normalizedUrl);

  const overlay = document.createElement("div");
  overlay.setAttribute("data-sanctuary-review-overlay", outcome.normalizedUrl);
  overlay.className = "sanctuary-review-overlay blocked";
  overlay.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  const rect = container.getBoundingClientRect();
  const isCompact = (rect.width > 0 && rect.width < 140) || (rect.height > 0 && rect.height < 140);
  if (isCompact) {
    overlay.classList.add("compact");
  }

  const reasonText = outcome.reasons.length ? `命中：${outcome.reasons.join("、")}` : "特征黑名单拦截";
  overlay.title = `AI 画面拦截 (${reasonText})`;

  const badge = document.createElement("div");
  badge.className = "sanctuary-blocked-badge";
  badge.textContent = isCompact ? "已隐藏" : "已按你的规则隐藏";

  const btnRow = document.createElement("div");
  btnRow.className = "sanctuary-blocked-actions";

  const revealBtn = document.createElement("button");
  revealBtn.type = "button";
  revealBtn.className = "sanctuary-blocked-btn";
  revealBtn.textContent = isCompact ? "查看" : "仅本次查看";
  revealBtn.title = "临时放行查看该图片";
  revealBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    ipcRenderer.send("explore:reveal-artwork", { normalizedUrl: outcome.normalizedUrl });
    const nextOutcome: ReviewResultMessage = { normalizedUrl: outcome.normalizedUrl, state: "allowed", reasons: [] };
    outcomes.set(outcome.normalizedUrl, nextOutcome);
    overlay.remove();
    const outcomeKey = extractArtworkFileKey(outcome.normalizedUrl);
    for (const [img, url] of trackedImages) {
      if (url === outcome.normalizedUrl || (outcomeKey && extractArtworkFileKey(url) === outcomeKey)) {
        applyOutcome(img, nextOutcome);
      }
    }
  });

  const calibrateBtn = document.createElement("button");
  calibrateBtn.type = "button";
  calibrateBtn.className = "sanctuary-blocked-btn calibrate";
  calibrateBtn.textContent = isCompact ? "记住偏好" : "这张不该隐藏";
  calibrateBtn.title = "永久放行这张，并逐步学习你的元素偏好";
  calibrateBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    calibrateBtn.textContent = "正在记住…";
    calibrateBtn.disabled = true;
    try {
      const result = await ipcRenderer.invoke(
        "explore:mark-false-positive",
        { normalizedUrl: outcome.normalizedUrl }
      ) as PreferenceCalibrationResult;
      showPreferenceToast(result);
    } catch (err) {
      console.warn("[explore] failed to remember preference", err);
      calibrateBtn.textContent = isCompact ? "重试" : "记忆失败，请重试";
      calibrateBtn.disabled = false;
      return;
    }
    const nextOutcome: ReviewResultMessage = { normalizedUrl: outcome.normalizedUrl, state: "allowed", reasons: [] };
    outcomes.set(outcome.normalizedUrl, nextOutcome);
    overlay.remove();
    const outcomeKey = extractArtworkFileKey(outcome.normalizedUrl);
    for (const [img, url] of trackedImages) {
      if (url === outcome.normalizedUrl || (outcomeKey && extractArtworkFileKey(url) === outcomeKey)) {
        applyOutcome(img, nextOutcome);
      }
    }
  });

  const inspectBtn = document.createElement("button");
  inspectBtn.type = "button";
  inspectBtn.className = "sanctuary-blocked-btn inspect";
  inspectBtn.textContent = isCompact ? "透视" : "🔍 元素透视";
  inspectBtn.title = "查看该作品的 AI 视觉标签";
  inspectBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    ipcRenderer.send("explore:inspect-url", { url: outcome.normalizedUrl });
  });

  btnRow.append(revealBtn, calibrateBtn, inspectBtn);
  overlay.append(badge);

  if (!isCompact) {
    const reasonEl = document.createElement("div");
    reasonEl.className = "sanctuary-blocked-reason";
    reasonEl.textContent = reasonText;
    overlay.append(reasonEl);
  }

  overlay.append(btnRow);

  if (getComputedStyle(container).position === "static") {
    container.style.setProperty("position", "relative", "important");
  }
  container.appendChild(overlay);
}

function renderUnavailableOverlay(image: HTMLImageElement, outcome: ReviewResultMessage): void {
  const container = findImageCardContainer(image);
  if (!container || !container.isConnected) return;
  removeReviewOverlay(image, outcome.normalizedUrl);

  const overlay = document.createElement("div");
  overlay.setAttribute("data-sanctuary-review-overlay", outcome.normalizedUrl);
  overlay.className = "sanctuary-review-overlay unavailable";
  overlay.addEventListener("click", (event) => event.stopPropagation());

  const rect = container.getBoundingClientRect();
  const isCompact = (rect.width > 0 && rect.width < 140) || (rect.height > 0 && rect.height < 140);
  if (isCompact) overlay.classList.add("compact");

  const badge = document.createElement("div");
  badge.className = "sanctuary-blocked-badge";
  badge.textContent = isCompact ? "暂未检查" : "这张图片暂未完成检查";
  overlay.appendChild(badge);

  if (!isCompact) {
    const reason = document.createElement("div");
    reason.className = "sanctuary-blocked-reason";
    reason.textContent = "这不是拦截结论，可以稍后重试";
    overlay.appendChild(reason);
  }

  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "sanctuary-blocked-btn";
  retry.textContent = "重新检查";
  retry.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    outcomes.delete(outcome.normalizedUrl);
    submittedPriorities.delete(outcome.normalizedUrl);
    overlay.remove();
    image.setAttribute(REVIEW_STATE_ATTRIBUTE, "pending");
    intersectionObserver.observe(image);
  });
  overlay.appendChild(retry);

  if (getComputedStyle(container).position === "static") {
    container.style.setProperty("position", "relative", "important");
  }
  container.appendChild(overlay);
}

function showPreferenceToast(result: PreferenceCalibrationResult): void {
  const thresholdChanges = result.changes ?? [];
  const personalChanges = result.personalChanges ?? [];
  const details = [
    ...thresholdChanges.map((change) =>
      `${change.label} 阈值 ${change.oldThreshold}%→${change.newThreshold}%`
    ),
    ...personalChanges.map((change) =>
      `${change.label} 偏好 ${change.oldWeight}%→${change.newWeight}%`
    )
  ];
  showSimplePreferenceToast(
    details.length > 0
      ? `已永久放行本图；${details.join("，")}`
      : "已永久放行这张图片；本次没有修改其他规则。",
    "success",
    result.feedbackId
  );
}

function showDislikePreferenceToast(result: DislikeFeedbackResult): void {
  const details = result.changes.map((change) =>
    `${change.label} ${change.oldWeight}%→${change.newWeight}%（证据 ${change.oldEvidence}→${change.newEvidence}）`
  );
  showSimplePreferenceToast(
    details.length > 0
      ? `已隐藏本图；逐步学习：${details.join("，")}`
      : "已只隐藏当前作品，没有修改相似图片规则。",
    "success",
    result.feedbackId
  );
}

function showSimplePreferenceToast(
  text: string,
  tone: "success" | "error" = "success",
  feedbackId: string | null = null
): void {
  document.querySelector(".sanctuary-preference-toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "sanctuary-preference-toast";
  if (tone === "error") {
    toast.style.setProperty("border-color", "rgba(244, 63, 94, 0.3)");
    toast.style.setProperty("color", "#9f1239");
    toast.style.setProperty("background", "rgba(255, 241, 242, 0.98)");
  }
  const message = document.createElement("span");
  message.textContent = text;
  toast.appendChild(message);

  if (feedbackId) {
    const undo = document.createElement("button");
    undo.type = "button";
    undo.textContent = "撤销";
    undo.addEventListener("click", async () => {
      undo.disabled = true;
      try {
        await ipcRenderer.invoke("explore:undo-preference-feedback", { feedbackId });
        location.reload();
      } catch (error) {
        console.warn("[explore] failed to undo preference feedback", error);
        undo.textContent = "撤销失败";
      }
    });
    toast.appendChild(undo);
  }
  document.documentElement.appendChild(toast);
  window.setTimeout(() => toast.remove(), 9_000);
}

function applyOutcome(image: HTMLImageElement, outcome: ReviewResultMessage): void {
  image.setAttribute(REVIEW_STATE_ATTRIBUTE, outcome.state);
  intersectionObserver.unobserve(image);
  removeImageMembership(image, outcome.normalizedUrl);
  if (outcome.state === "allowed") {
    removeReviewOverlay(image, outcome.normalizedUrl);
    image.style.visibility = "visible";
    image.style.opacity = "1";
    image.style.filter = "none";
    reloadFailedImage(image, outcome.normalizedUrl);
    renderAllowedControl(image, outcome.normalizedUrl);
  } else if (outcome.state === "blocked") {
    removeAllowedControl(image, outcome.normalizedUrl);
    renderBlockedOverlay(image, outcome);
  } else {
    removeAllowedControl(image, outcome.normalizedUrl);
    renderUnavailableOverlay(image, outcome);
  }
}

function findOutcomeForUrl(url: string): ReviewResultMessage | null {
  const direct = outcomes.get(url);
  if (direct) return direct;
  const key = extractArtworkFileKey(url);
  if (!key) return null;
  for (const [candidateUrl, outcome] of outcomes) {
    if (extractArtworkFileKey(candidateUrl) === key) return outcome;
  }
  return null;
}

function evaluateImageViewport(image: HTMLImageElement, normalizedUrl: string, intersectingHint = false): void {
  const priority = measureEffectiveImagePriority(image, window.innerWidth, window.innerHeight);
  setMembership(nearImages, normalizedUrl, image, priority !== null || intersectingHint);
  setMembership(visibleImages, normalizedUrl, image, priority === "visible");
}

function trackImage(image: HTMLImageElement): void {
  const nextUrl = artworkUrlForImage(image);
  const previousUrl = trackedImages.get(image);
  if (previousUrl && previousUrl !== nextUrl) {
    intersectionObserver.unobserve(image);
    removeImageMembership(image, previousUrl);
    removeAllowedControl(image, previousUrl);
    removeReviewOverlay(image, previousUrl);
    trackedImages.delete(image);
    image.removeAttribute(REVIEW_STATE_ATTRIBUTE);
    image.removeAttribute(REVIEW_RELOAD_ATTRIBUTE);
  }
  if (!nextUrl) return;
  trackedImages.set(image, nextUrl);
  if (!protectionEnabled) {
    intersectionObserver.unobserve(image);
    removeReviewOverlay(image, nextUrl);
    removeAllowedControl(image, nextUrl);
    image.setAttribute(REVIEW_STATE_ATTRIBUTE, "allowed");
    image.style.visibility = "visible";
    image.style.opacity = "1";
    image.style.filter = "none";
    return;
  }
  const outcome = findOutcomeForUrl(nextUrl);
  if (outcome) {
    applyOutcome(image, outcome);
    return;
  }
  image.setAttribute(REVIEW_STATE_ATTRIBUTE, "pending");
  intersectionObserver.unobserve(image);
  intersectionObserver.observe(image);
  evaluateImageViewport(image, nextUrl);
  syncCandidate(nextUrl);
}

const intersectionObserver = new IntersectionObserver(
  (entries) => {
    const changedUrls = new Set<string>();
    for (const entry of entries) {
      if (!(entry.target instanceof HTMLImageElement)) continue;
      const image = entry.target;
      const normalizedUrl = trackedImages.get(image);
      if (!normalizedUrl) continue;
      const existingOutcome = findOutcomeForUrl(normalizedUrl);
      if (existingOutcome) {
        applyOutcome(image, existingOutcome);
        continue;
      }
      evaluateImageViewport(image, normalizedUrl, entry.isIntersecting);
      changedUrls.add(normalizedUrl);
    }
    for (const normalizedUrl of changedUrls) syncCandidate(normalizedUrl);
  },
  { rootMargin: "400px 0px", threshold: 0 }
);

function inspectNode(node: Node): void {
  if (node instanceof HTMLImageElement) trackImage(node);
  if (node instanceof HTMLSourceElement && node.parentElement instanceof HTMLPictureElement) {
    const image = node.parentElement.querySelector("img");
    if (image) trackImage(image);
  }
  if (!(node instanceof Element)) return;
  for (const image of node.querySelectorAll("img")) trackImage(image);
}

function untrackImage(image: HTMLImageElement): void {
  const normalizedUrl = trackedImages.get(image);
  if (!normalizedUrl) return;
  intersectionObserver.unobserve(image);
  removeAllowedControl(image, normalizedUrl);
  removeReviewOverlay(image, normalizedUrl);
  trackedImages.delete(image);
  removeImageMembership(image, normalizedUrl);
}

function untrackNode(node: Node): void {
  if (node instanceof HTMLImageElement) untrackImage(node);
  if (!(node instanceof Element)) return;
  for (const image of node.querySelectorAll("img")) untrackImage(image);
}

function handleImageLifecycle(event: Event): void {
  if (event.target instanceof HTMLImageElement) trackImage(event.target);
}

let viewportSweepScheduled = false;
function schedulePendingViewportSweep(): void {
  if (viewportSweepScheduled || !protectionEnabled) return;
  viewportSweepScheduled = true;
  window.requestAnimationFrame(() => {
    viewportSweepScheduled = false;
    const changedUrls = new Set<string>();
    for (const [image, normalizedUrl] of trackedImages) {
      if (!image.isConnected || findOutcomeForUrl(normalizedUrl)) continue;
      evaluateImageViewport(image, normalizedUrl);
      changedUrls.add(normalizedUrl);
    }
    for (const normalizedUrl of changedUrls) syncCandidate(normalizedUrl);
  });
}

function startObserver(): void {
  syncProtectionModeAttribute();
  for (const image of document.images) trackImage(image);
  const mutationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") inspectNode(mutation.target);
      else {
        for (const node of mutation.addedNodes) inspectNode(node);
        for (const node of mutation.removedNodes) untrackNode(node);
      }
    }
  });
  mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "srcset"]
  });
  document.addEventListener("load", handleImageLifecycle, true);
  document.addEventListener("error", handleImageLifecycle, true);
  window.addEventListener("scroll", schedulePendingViewportSweep, { capture: true, passive: true });
  window.addEventListener("resize", schedulePendingViewportSweep, { passive: true });
  window.addEventListener("pagehide", () => {
    closeDislikePopover();
    mutationObserver.disconnect();
    intersectionObserver.disconnect();
    document.removeEventListener("load", handleImageLifecycle, true);
    document.removeEventListener("error", handleImageLifecycle, true);
    window.removeEventListener("scroll", schedulePendingViewportSweep, true);
    window.removeEventListener("resize", schedulePendingViewportSweep);
  }, { once: true });
}

function setProtectionEnabled(enabled: boolean): void {
  if (protectionEnabled === enabled) {
    syncProtectionModeAttribute();
    return;
  }
  protectionEnabled = enabled;
  syncProtectionModeAttribute();
  outcomes.clear();
  submittedPriorities.clear();
  nearImages.clear();
  visibleImages.clear();
  for (const [image, url] of trackedImages) {
    intersectionObserver.unobserve(image);
    removeReviewOverlay(image, url);
    removeAllowedControl(image, url);
    image.removeAttribute(REVIEW_RELOAD_ATTRIBUTE);
    if (enabled) {
      image.removeAttribute(REVIEW_STATE_ATTRIBUTE);
      trackImage(image);
    } else {
      image.setAttribute(REVIEW_STATE_ATTRIBUTE, "allowed");
      image.style.visibility = "visible";
      image.style.opacity = "1";
      image.style.filter = "none";
      reloadFailedImage(image, url);
    }
  }
}

ipcRenderer.on("explore:protection-mode", (_event, value: unknown) => {
  if (!value || typeof value !== "object") return;
  const enabled = (value as { enabled?: unknown }).enabled;
  if (typeof enabled === "boolean") setProtectionEnabled(enabled);
});

ipcRenderer.on("explore:review-result", (_event, value: unknown) => {
  if (!value || typeof value !== "object") return;
  const candidate = value as Partial<ReviewResultMessage>;
  const normalizedUrl = normalizeArtworkUrl(candidate.normalizedUrl);
  if (
    !normalizedUrl ||
    (candidate.state !== "allowed" && candidate.state !== "blocked" && candidate.state !== "unavailable") ||
    !Array.isArray(candidate.reasons)
  ) {
    return;
  }
  const outcome: ReviewResultMessage = {
    normalizedUrl,
    state: candidate.state,
    reasons: candidate.reasons.filter((reason): reason is string => typeof reason === "string")
  };
  outcomes.delete(normalizedUrl);
  outcomes.set(normalizedUrl, outcome);
  while (outcomes.size > MAX_PAGE_OUTCOMES) {
    const oldestUrl = outcomes.keys().next().value as string | undefined;
    if (!oldestUrl) break;
    outcomes.delete(oldestUrl);
  }
  submittedPriorities.delete(normalizedUrl);
  const incomingKey = extractArtworkFileKey(normalizedUrl);
  for (const [image, imageUrl] of trackedImages) {
    if (imageUrl === normalizedUrl || (incomingKey && extractArtworkFileKey(imageUrl) === incomingKey)) {
      applyOutcome(image, outcome);
    }
  }
});

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", startObserver, { once: true });
} else {
  startObserver();
}
