import { describe, expect, it } from "vitest";
import { filterQuickActions, nextQuickActionIndex, type QuickActionDescriptor } from "./quick-action-model";

const actions: QuickActionDescriptor[] = [
  { id: "library", label: "浏览图库", description: "查看全部作品与相册", keywords: ["gallery", "图片"] },
  { id: "import", label: "导入图片", description: "选择本地图片文件", keywords: ["import", "添加"], disabled: true, disabledReason: "正在导入" },
  { id: "models", label: "本地模型", description: "安装创作与探索模型", keywords: ["AI", "模型设置"] },
  { id: "appearance", label: "外观与显示", description: "主题、字体与性能档位", keywords: ["换肤", "流畅", "theme"] }
];

describe("quick action search", () => {
  it("matches Chinese descriptions and aliases while preserving action order", () => {
    expect(filterQuickActions(actions, "相册").map((action) => action.id)).toEqual(["library"]);
    expect(filterQuickActions(actions, "流畅").map((action) => action.id)).toEqual(["appearance"]);
    expect(filterQuickActions(actions, "模型").map((action) => action.id)).toEqual(["models"]);
  });

  it("normalizes full-width Latin words and requires every search word to match", () => {
    expect(filterQuickActions(actions, "　ＡＩ 设置　").map((action) => action.id)).toEqual(["models"]);
    expect(filterQuickActions(actions, "模型 相册")).toEqual([]);
    expect(filterQuickActions(actions, " GALLERY ").map((action) => action.id)).toEqual(["library"]);
  });

  it("shows disabled actions and their explanations without changing the source list", () => {
    const result = filterQuickActions(actions, "导入");
    expect(result).toEqual([actions[1]]);
    expect(result[0]?.disabledReason).toBe("正在导入");
    expect(filterQuickActions(actions, "  ")).toEqual(actions);
    expect(filterQuickActions(actions, "  ")).not.toBe(actions);
  });
});

describe("quick action keyboard navigation", () => {
  it("skips unavailable actions in both directions and wraps the ends", () => {
    expect(nextQuickActionIndex(actions, 0, 1)).toBe(2);
    expect(nextQuickActionIndex(actions, 2, -1)).toBe(0);
    expect(nextQuickActionIndex(actions, 3, 1)).toBe(0);
    expect(nextQuickActionIndex(actions, 0, -1)).toBe(3);
  });

  it("starts at the first or last available action for a missing selection", () => {
    expect(nextQuickActionIndex(actions, -1, 1)).toBe(0);
    expect(nextQuickActionIndex(actions, -1, -1)).toBe(3);
    expect(nextQuickActionIndex(actions, 99, 1)).toBe(0);
  });

  it("cannot select an action when every result is disabled or the list is empty", () => {
    expect(nextQuickActionIndex([], -1, 1)).toBe(-1);
    expect(nextQuickActionIndex(actions.map((action) => ({ ...action, disabled: true })), 0, 1)).toBe(-1);
    expect(nextQuickActionIndex([actions[1]!], -1, -1)).toBe(-1);
    expect(nextQuickActionIndex([actions[0]!], 0, -1)).toBe(0);
  });
});
