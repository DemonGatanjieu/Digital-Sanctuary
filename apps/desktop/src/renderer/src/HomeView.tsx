import { Button } from "./Button";
import { ArtworkBackgroundControls, useArtworkBackground } from "./ArtworkBackgroundControls";

export type HomeDestination = "gallery" | "explore" | "inspiration";
export const HOME_TASKS: { id: HomeDestination; title: string; description: string; symbol: string }[] = [
  { id: "gallery", title: "看看我的收藏", description: "浏览、搜索作品，按元素筛选，继续上次阅读。", symbol: "▧" },
  { id: "explore", title: "发现新的作品", description: "浏览图片网站，保存喜欢的图；Pixiv 支持元素保护。", symbol: "◈" },
  { id: "inspiration", title: "找灵感，写点东西", description: "聊图、写故事、整理设定与提示词。", symbol: "✦" }
];

export function HomeView({ onSelect, onImport, importing, workCount }: {
  onSelect: (destination: HomeDestination) => void; onImport: () => void | Promise<void>;
  importing: boolean; workCount: number;
}) {
  const background=useArtworkBackground("home");
  return <section className={`home-view ${background.image?"home-with-background":""}`} aria-label="开始">
    {background.image&&<img className="home-background" src={background.image} alt="" aria-hidden="true" draggable={false}/>}
    <div className="home-content">
    <header className="home-heading">
      <div className="home-background-controls"><ArtworkBackgroundControls surface="home" background={background}/></div>
      <p className="eyebrow">DIGITAL SANCTUARY</p>
      <h1>今天想做什么？</h1>
      <p className="page-description">从一件想做的事开始。</p>
    </header>
    <div className="home-task-grid">
      {HOME_TASKS.map((task) => <button type="button" key={task.id} className="home-task-card"
        data-home-task={task.id} onClick={() => onSelect(task.id)}>
        <span className="home-task-symbol" aria-hidden="true">{task.symbol}</span>
        <span className="home-task-copy"><strong>{task.title}</strong><small>{task.description}</small></span>
        <span className="home-task-arrow" aria-hidden="true">→</span>
      </button>)}
    </div>
    <div className="home-library-entry">
      <p>{workCount ? "已有本地图片也可以随时导入。" : "第一次使用？先导入本地图片，或去探索保存作品。"}</p>
      <Button variant="secondary" busy={importing} onClick={() => void onImport()}>导入本地图片</Button>
    </div>
    </div>
  </section>;
}
