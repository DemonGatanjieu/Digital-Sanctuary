import type { ModelCatalogEntry } from "@sanctuary/domain";

const WD_TAGS = {
  fileName: "selected_tags.csv",
  size: 308_468,
  sha256: "298633d94d0031d2081c0893f29c82eab7f0df00b08483ba8f29d1e979441217"
} as const;

const LLAMA_CPP_B10516_VULKAN = {
  fileName: "llama-b10516-bin-win-vulkan-x64.zip",
  url: "https://github.com/ggml-org/llama.cpp/releases/download/b10516/llama-b10516-bin-win-vulkan-x64.zip",
  size: 34_861_181,
  sha256: "530f57d2a874ce017827c1e5a926812b9d5de4667248575d1372b1c0acf94d83",
  extract: "zip" as const
};

const LLAMA_CPP_VLM_RUNTIME_FILES = [
  "llama-server.exe",
  "llama-server-impl.dll",
  "llama-common.dll",
  "llama.dll",
  "ggml.dll",
  "ggml-base.dll",
  "ggml-vulkan.dll",
  "mtmd.dll"
] as const;

export const SEMANTIC_MODEL_ID = "embeddinggemma-2";
const EMBEDDING_GEMMA_REVISION = "914f7f89142e33e77833254d9c9b90c3cef7303b";

function gemmaFile(fileName: string, size: number, sha256: string) {
  return { fileName, url: `https://huggingface.co/google/embeddinggemma-2/resolve/${EMBEDDING_GEMMA_REVISION}/${fileName}`, size, sha256 };
}

/**
 * The frozen picture-search worker (services/semantic, built by `npm run build:semantic-bundle`).
 * Published as a release asset of this repository under tag `semantic-runtime-1`; never replace it in place.
 */
const SEMANTIC_RUNTIME = {
  fileName: "sanctuary-semantic-runtime-1.zip",
  url: "https://github.com/DemonGatanjieu/Digital-Sanctuary/releases/download/semantic-runtime-1/sanctuary-semantic-runtime-1.zip",
  size: 250_683_998,
  sha256: "7d589553b4bdf2c15377213e86422b587caf5619ccbf6e6c1ef3bae0eeaaa1f6",
  extract: "zip" as const
};

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
    id: SEMANTIC_MODEL_ID,
    name: "EmbeddingGemma 2",
    version: EMBEDDING_GEMMA_REVISION.slice(0, 12),
    author: "Google DeepMind",
    description: "用一句话描述画面，在图库里按内容找图。只在找图时用 CPU 加载，闲置后自动释放。",
    capability: "semantic_embedding",
    runtime: "semantic_runtime",
    tier: "balanced",
    availability: "ready",
    license: "Apache-2.0",
    homepage: "https://huggingface.co/google/embeddinggemma-2",
    downloadSize: 1_525_810_123 + SEMANTIC_RUNTIME.size,
    diskSize: 3_600_000_000,
    recommendedRamGb: 8,
    recommendedVramGb: 0,
    badges: ["按画面找图", "本地运行", "版本锁定"],
    // The runtime pack goes first: if it is not published yet, the install stops before 1.5 GB of weights.
    files: [
      SEMANTIC_RUNTIME,
      gemmaFile("1_Pooling/config.json", 90, "8759bdf7c77efc7df7723f64856a593c8943b71ee38baf2a88771fbaf78438f9"),
      gemmaFile("2_Normalize/config.json", 97, "cdb09dfca347a56aa2d691744e38d5ad3c7cbc2834e7181272b9a15328b82524"),
      gemmaFile("modules.json", 413, "3d02572a0455b832de67fb8e63a54981bc7e8b46e337c95e917bd8122a533bfd"),
      gemmaFile("preprocessor_config.json", 511, "ea2ae257e901064abdd98dceb19f2b0da06af600bed15e0f99f5c85c37ee9d78"),
      gemmaFile("sentence_bert_config.json", 747, "b1bcd9f2dce3ae863b359e87d0710b5dbc3314a59ecb4e2f97c7778fc8e4b228"),
      gemmaFile("chat_template.jinja", 1_016, "4b852efc0b9960283e735363331e6f325b33bc74bdbaa076f595bc4e9b94d85e"),
      gemmaFile(".gitattributes", 1_301, "bcdccfaa66bc1240c7192dbd374cfb39b695bb1d8ff6b7ce0113aa5e9ac21a44"),
      gemmaFile("config_sentence_transformers.json", 1_565, "031e56a498d33c349ab489a21885bcfe25b4fcba841149dc99e1e90d4a7c28f5"),
      gemmaFile("tokenizer_config.json", 1_599, "17bd5d6e9364ca49a534e1502076593317c298d4a663623091ed45388f004874"),
      gemmaFile("processor_config.json", 1_788, "168f6a08522f3ce5dea596d94d003af2fd691742d4f41fe1f9d8cce76bfbf69c"),
      gemmaFile("config.json", 4_455, "b8f1e9931b57fbc054acdb445c41765d55b0074c58d145fa82839941ad1b5bb3"),
      gemmaFile("README.md", 21_730, "b677a0ee2818c36f091b65fd3d9b4baea9f04d53b02b49cae916c74bf9682037"),
      gemmaFile("tokenizer.model", 4_689_013, "e594c8a90eb08d8bda498ff4747977dc827ae0c3c56b5c0d41a605a22d02ef03"),
      gemmaFile("tokenizer.json", 32_170_510, "4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4"),
      gemmaFile("model.safetensors", 1_488_915_288, "197a32965d4b1105faf060417baa899e193fb73cd401f42ec9295234d5553d79")
    ],
    requiredRuntimeFiles: ["sanctuary-semantic/sanctuary-semantic.exe"],
    snapshot: { repository: "google/embeddinggemma-2", revision: EMBEDDING_GEMMA_REVISION }
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
    description: "本地视觉评论模型：既能按标准美术六维评价，也能针对每张作品自行挑选最有解释力的六个维度。",
    capability: "art_critic",
    runtime: "llama_cpp_vlm",
    tier: "balanced",
    availability: "ready",
    license: "Apache-2.0 / MIT",
    homepage: "https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF",
    downloadSize: 1_587_324_349,
    diskSize: 1_660_000_000,
    recommendedRamGb: 16,
    recommendedVramGb: 4,
    badges: ["六维评价", "自选维度", "本地运行", "Vulkan"],
    files: [
      {
        fileName: "Qwen3VL-2B-Instruct-Q4_K_M.gguf",
        url: "https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/main/Qwen3VL-2B-Instruct-Q4_K_M.gguf",
        size: 1_107_409_952,
        sha256: "089d75c52f4b7ffc56ba998ffc50aae89fcafc755f9e7208aacca281dca6c2ae"
      },
      {
        fileName: "mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf",
        url: "https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/main/mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf",
        size: 445_053_216,
        sha256: "f9a68fabba69c3b81e153367b2c7521030b0fa8bb0de400c9599c8e6725f9c82"
      },
      {
        ...LLAMA_CPP_B10516_VULKAN
      }
    ],
    requiredRuntimeFiles: [...LLAMA_CPP_VLM_RUNTIME_FILES]
  },
  {
    id: "gemma-4-e2b-it-q4",
    name: "Gemma 4 E2B · Q4",
    version: "Q4_0/b4243c156154",
    author: "Google DeepMind / ggml-org",
    description: "新一代轻量多模态画评模型。比 Qwen 2B 更擅长组织自然语言，同时优先照顾 4–6GB 显存设备。",
    capability: "art_critic",
    runtime: "llama_cpp_vlm",
    tier: "balanced",
    availability: "ready",
    license: "Apache-2.0",
    homepage: "https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF",
    downloadSize: 3_433_710_429,
    diskSize: 3_500_000_000,
    recommendedRamGb: 16,
    recommendedVramGb: 4,
    badges: ["流畅画评", "多模态", "本地运行", "版本锁定"],
    files: [
      {
        fileName: "gemma-4-E2B-it-Q4_0.gguf",
        url: "https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/b4243c156154b6dca9324415f8c7ccc098b4aed1/gemma-4-E2B-it-Q4_0.gguf",
        size: 2_841_481_184,
        sha256: "8e30dff3ac4c8434c49a7036fa15564bdbb6044e42bf04550bf1a096ad7e6a52"
      },
      {
        fileName: "mmproj-gemma-4-E2B-it-Q8_0.gguf",
        url: "https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/b4243c156154b6dca9324415f8c7ccc098b4aed1/mmproj-gemma-4-E2B-it-Q8_0.gguf",
        size: 557_368_064,
        sha256: "9406f99c16d68cda4f1f0552192dcc99021ea1fc6d2fd50b1dc3ccf30d04b292"
      },
      { ...LLAMA_CPP_B10516_VULKAN }
    ],
    requiredRuntimeFiles: [...LLAMA_CPP_VLM_RUNTIME_FILES]
  },
  {
    id: "gemma-4-e4b-it-q4",
    name: "Gemma 4 E4B · Q4",
    version: "Q4_0/1288d42c1f05",
    author: "Google DeepMind / ggml-org",
    description: "纯净领域推荐的高质量本地画评模型。语言、推理与画面细节表达更充分；6GB 显存可尝试，8GB 以上更从容。",
    capability: "art_critic",
    runtime: "llama_cpp_vlm",
    tier: "advanced",
    availability: "ready",
    license: "Apache-2.0",
    homepage: "https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF",
    downloadSize: 5_185_543_389,
    diskSize: 5_260_000_000,
    recommendedRamGb: 24,
    recommendedVramGb: 8,
    badges: ["画评推荐", "表达增强", "多模态", "版本锁定"],
    files: [
      {
        fileName: "gemma-4-E4B-it-Q4_0.gguf",
        url: "https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF/resolve/1288d42c1f05addc1e3d947f29c8a5669c25182f/gemma-4-E4B-it-Q4_0.gguf",
        size: 4_590_807_392,
        sha256: "a555b900214b477d8880e7832e0b8925e139b0159640036b09fe472b6f2097f2"
      },
      {
        fileName: "mmproj-gemma-4-E4B-it-Q8_0.gguf",
        url: "https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF/resolve/1288d42c1f05addc1e3d947f29c8a5669c25182f/mmproj-gemma-4-E4B-it-Q8_0.gguf",
        size: 559_874_816,
        sha256: "197f49a93027f9843772bd24a6a9e0be2a32a788de5a3def330e9c585d86edd1"
      },
      { ...LLAMA_CPP_B10516_VULKAN }
    ],
    requiredRuntimeFiles: [...LLAMA_CPP_VLM_RUNTIME_FILES]
  }
] as const;
