import type { ModelCatalogEntry } from "@sanctuary/domain";

const WD_TAGS = {
  fileName: "selected_tags.csv",
  size: 308_468,
  sha256: "298633d94d0031d2081c0893f29c82eab7f0df00b08483ba8f29d1e979441217"
} as const;

function wdFiles(repository: string, size: number, sha256: string) {
  const root = `https://huggingface.co/${repository}/resolve/main`;
  return [
    { fileName: "model.onnx", url: `${root}/model.onnx`, size, sha256 },
    { ...WD_TAGS, url: `${root}/selected_tags.csv` }
  ];
}

export const MODEL_CATALOG: readonly ModelCatalogEntry[] = [
  {
    id: "wd-swinv2-tagger-v3",
    name: "WD SwinV2 Tagger v3",
    version: "v3/e6774bff34d4",
    author: "SmilingWolf",
    description: "纯净领域当前内置的二次元元素识别模型，速度、覆盖与资源占用均衡。",
    capability: "element_tagging",
    runtime: "wd_onnx",
    tier: "balanced",
    availability: "ready",
    license: "Apache-2.0",
    homepage: "https://huggingface.co/SmilingWolf/wd-swinv2-tagger-v3",
    downloadSize: 467_769_446,
    diskSize: 467_769_446,
    recommendedRamGb: 8,
    recommendedVramGb: 2,
    badges: ["内置", "日常推荐", "探索兼容"],
    files: wdFiles(
      "SmilingWolf/wd-swinv2-tagger-v3",
      467_460_978,
      "e6774bff34d43bd49f75a47db4ef217dce701c9847b546523eb85ff6dbba1db1"
    )
  },
  {
    id: "wd-convnext-tagger-v3",
    name: "WD ConvNeXt Tagger v3",
    version: "v3/1b8a7abf13d9",
    author: "SmilingWolf",
    description: "同代元素识别模型的轻巧替代选择，体积略小，适合希望比较不同标签器表现的用户。",
    capability: "element_tagging",
    runtime: "wd_onnx",
    tier: "light",
    availability: "ready",
    license: "Apache-2.0",
    homepage: "https://huggingface.co/SmilingWolf/wd-convnext-tagger-v3",
    downloadSize: 395_299_200,
    diskSize: 395_299_200,
    recommendedRamGb: 8,
    recommendedVramGb: 2,
    badges: ["轻量", "探索兼容"],
    files: wdFiles(
      "SmilingWolf/wd-convnext-tagger-v3",
      394_990_732,
      "1b8a7abf13d9b8368267df47501d523789c4aeae66b2296ad98483239dfa32eb"
    )
  },
  {
    id: "wd-vit-large-tagger-v3",
    name: "WD ViT Large Tagger v3",
    version: "v3/e4c8001b000a",
    author: "SmilingWolf",
    description: "更大的元素识别骨干，适合内存与显存更宽裕、愿意用体积换取模型差异的设备。",
    capability: "element_tagging",
    runtime: "wd_onnx",
    tier: "advanced",
    availability: "ready",
    license: "Apache-2.0",
    homepage: "https://huggingface.co/SmilingWolf/wd-vit-large-tagger-v3",
    downloadSize: 1_260_954_141,
    diskSize: 1_260_954_141,
    recommendedRamGb: 16,
    recommendedVramGb: 4,
    badges: ["大模型", "探索兼容"],
    files: wdFiles(
      "SmilingWolf/wd-vit-large-tagger-v3",
      1_260_645_673,
      "e4c8001b000a6c98f2db10794f7c406daa79873d071d6ca924330fa053fa1845"
    )
  },
  {
    id: "wd-eva02-large-tagger-v3",
    name: "WD EVA02 Large Tagger v3",
    version: "v3/9e768793060c",
    author: "SmilingWolf",
    description: "发烧级二次元元素识别骨干。下载和启动都更重，建议高配设备按需安装后实测。",
    capability: "element_tagging",
    runtime: "wd_onnx",
    tier: "advanced",
    availability: "ready",
    license: "Apache-2.0",
    homepage: "https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3",
    downloadSize: 1_260_744_467,
    diskSize: 1_260_744_467,
    recommendedRamGb: 16,
    recommendedVramGb: 4,
    badges: ["发烧级", "探索兼容"],
    files: wdFiles(
      "SmilingWolf/wd-eva02-large-tagger-v3",
      1_260_435_999,
      "9e768793060c7939b277ccb382783e8670e8a042d29d77aa736be0c8cc898bfc"
    )
  },
  {
    id: "danbooru-aesthetic-classifier",
    name: "Anime Aesthetic Classifier",
    version: "2026.08",
    author: "aipracticecafe",
    description: "基于动漫插画训练的整体观感分类头。它只负责整体观感，不替代六维美术评价。",
    capability: "aesthetic_scoring",
    runtime: "aesthetic_head",
    tier: "light",
    availability: "runtime_pending",
    license: "MIT",
    homepage: "https://huggingface.co/aipracticecafe/danbooru-aes-cls",
    downloadSize: 7_930_000,
    diskSize: 7_930_000,
    recommendedRamGb: 8,
    recommendedVramGb: 2,
    badges: ["动漫专用", "轻量", "接入准备"],
    files: []
  },
  {
    id: "qwen3-vl-2b-instruct-q4",
    name: "Qwen3-VL 2B · Q4",
    version: "Q4_K_M",
    author: "Qwen",
    description: "拟用于构图、色彩、光影、焦点、氛围和细节六维评价的本地视觉评论模型。",
    capability: "art_critic",
    runtime: "llama_cpp_vlm",
    tier: "balanced",
    availability: "runtime_pending",
    license: "Apache-2.0",
    homepage: "https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF",
    downloadSize: 1_555_000_000,
    diskSize: 1_555_000_000,
    recommendedRamGb: 16,
    recommendedVramGb: 4,
    badges: ["六维评价", "本地运行", "接入准备"],
    files: []
  }
] as const;
