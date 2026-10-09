import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SemanticAvailability } from "@sanctuary/domain";

export const SEMANTIC_VERSION = "embeddinggemma2:914f7f89142e33e77833254d9c9b90c3cef7303b:rgb1024:768:v1";
export function validVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 768 && value.every(n => typeof n === "number" && Number.isFinite(n))
    && Math.abs(value.reduce((sum,n) => sum+n*n,0)-1) < 0.02;
}
export class SemanticVectorStore {
  #database: DatabaseSync;
  constructor(path: string) {
    this.#database = new DatabaseSync(path);
    this.#database.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS vectors (hash TEXT NOT NULL, version TEXT NOT NULL, vector TEXT NOT NULL, used_at INTEGER NOT NULL, PRIMARY KEY(hash, version))");
  }
  get(hash: string): number[] | null {
    const row = this.#database.prepare("SELECT vector FROM vectors WHERE hash=? AND version=?").get(hash,SEMANTIC_VERSION);
    if (!row) return null;
    try { const vector: unknown = JSON.parse(String(row.vector)); if (!validVector(vector)) return null;
      this.#database.prepare("UPDATE vectors SET used_at=? WHERE hash=? AND version=?").run(Date.now(),hash,SEMANTIC_VERSION); return vector;
    } catch { return null; }
  }
  put(hash: string, vector: number[]) {
    if (!validVector(vector)) throw new Error("找图向量无效，请重新分析");
    this.#database.prepare("INSERT OR REPLACE INTO vectors VALUES(?,?,?,?)").run(hash,SEMANTIC_VERSION,JSON.stringify(vector),Date.now());
    this.#database.exec("DELETE FROM vectors WHERE rowid IN (SELECT rowid FROM vectors ORDER BY used_at DESC LIMIT -1 OFFSET 10000)");
  }
  close() { this.#database.close(); }
}

export interface SemanticRuntime { command: string; args: string[]; required: string[] }
/** What the model center installs: the frozen worker beside the verified model snapshot. */
export function installedSemanticRuntime(modelDirectory: string): SemanticRuntime {
  const command=join(modelDirectory,"sanctuary-semantic","sanctuary-semantic.exe");
  return {command,args:[modelDirectory],required:[command,join(modelDirectory,"sanctuary.manifest.json"),join(modelDirectory,"sanctuary-model.json")]};
}
/** A development checkout: the project's own Python environment and model folder. */
export function developmentSemanticRuntime(root: string): SemanticRuntime {
  const python=join(root,".venv-semantic","Scripts","python.exe"),server=join(root,"services","semantic","server.py"),model=join(root,"models","embeddinggemma-2");
  return {command:python,args:["-u",server,model],required:[python,server,join(model,"sanctuary.manifest.json")]};
}

/** One on-demand CPU worker; never competes for exploration GPU memory. */
export class SemanticClient {
  #child: ChildProcessWithoutNullStreams | undefined;
  #startup: Promise<void> | undefined;
  #pending = new Map<string, { resolve: (v: number[]) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  #idle?: ReturnType<typeof setTimeout>;
  constructor(private runtimes: readonly SemanticRuntime[]) {}
  #runtime(): SemanticRuntime | undefined { return this.runtimes.find(runtime=>runtime.required.every(path=>existsSync(path))); }
  availability(): SemanticAvailability {
    const available = Boolean(this.#runtime());
    return { available, model: "EmbeddingGemma 2", device: "cpu", message: available
      ? "本地离线找图 · CPU · 首次查询需要加载模型，闲置后自动释放"
      : "按画面找图需要先下载找图模型：设置 → 模型管理 → 按画面找图" };
  }
  async encode(kind: "image" | "query", value: string): Promise<number[]> {
    if (this.#idle) clearTimeout(this.#idle);
    await this.#ensure();
    const child = this.#child;
    if (!child) throw new Error("找图模型已停止，请重试");
    const id = randomUUID();
    try {
      return await new Promise<number[]>((resolve,reject) => {
        const timer = setTimeout(() => this.close(new Error("找图模型响应超时，请重试")),90_000);
        this.#pending.set(id,{resolve,reject,timer});
        child.stdin.write(JSON.stringify({id,kind,value})+"\n",error => { if(error) this.close(new Error("找图模型连接中断，请重试")); });
      });
    } finally { this.#idle = setTimeout(() => this.close(),60_000); this.#idle.unref(); }
  }
  close(error = new Error("找图模型已停止")) {
    if(this.#idle) clearTimeout(this.#idle);
    const child=this.#child; this.#child=undefined; this.#startup=undefined; child?.kill();
    for(const p of this.#pending.values()){clearTimeout(p.timer);p.reject(error);} this.#pending.clear();
  }
  #ensure(): Promise<void> {
    if(this.#startup) return this.#startup;
    const runtime=this.#runtime();
    if(!runtime) return Promise.reject(new Error(this.availability().message));
    const child=spawn(runtime.command,runtime.args,
      {windowsHide:true,stdio:["pipe","pipe","pipe"],env:{...process.env,HF_HUB_OFFLINE:"1",TRANSFORMERS_OFFLINE:"1",HF_HUB_DISABLE_TELEMETRY:"1"}});
    this.#child=child;
    let diagnostics="";
    this.#startup=new Promise<void>((resolve,reject)=>{
      let ready=false;
      const timeout=setTimeout(()=>fail(new Error("找图模型启动超时，请检查本地环境")),180_000);
      const fail=(e: Error)=>{clearTimeout(timeout);if(!ready)reject(e);if(this.#child===child){if(diagnostics)console.warn("[semantic]",diagnostics.slice(-4000));this.close(e);}};
      createInterface({input:child.stdout}).on("line",line=>{
        if(line.length>64_000){fail(new Error("找图模型返回内容异常"));return;}
        try {
          const response=JSON.parse(line) as {ready?:boolean;id?:string;vector?:unknown;error?:string};
          if(response.ready){ready=true;clearTimeout(timeout);resolve();return;}
          if(!response.id){if(response.error)fail(new Error(response.error));return;}
          const pending=this.#pending.get(response.id);if(!pending)return;
          clearTimeout(pending.timer);this.#pending.delete(response.id);
          if(validVector(response.vector))pending.resolve(response.vector);else {if(diagnostics)console.warn("[semantic]",diagnostics.slice(-4000));pending.reject(new Error(response.error||"找图模型返回了无效结果"));}
        }catch{fail(new Error("找图模型返回格式异常"));}
      });
      child.stderr.on("data",chunk=>{diagnostics=(diagnostics+String(chunk)).slice(-8000);});
      child.on("error",()=>fail(new Error("无法启动找图模型，请在模型管理中重新安装")));
      child.on("exit",()=>fail(new Error("找图模型已退出，请重试")));
    });
    return this.#startup;
  }
}
