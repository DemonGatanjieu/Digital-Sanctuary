import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { connectElectronMainInspector, showElectronTestWindow } from "./electron-smoke-support.mjs";

// Real local models and production IPC; all images/libraries/destinations are disposable.
const root=await mkdtemp(join(resolve(tmpdir()),"sanctuary-workbench-smoke-"));
const folder=join(root,"folder"),destination=join(root,"output"),userData=join(root,"user-data");
for(const directory of [folder,destination,userData,join(folder,"sub")])await mkdir(directory,{recursive:true});
const names=["blue-sky-and-sun","night-moon-and-stars","red-square"];
for(const name of names)await copyFile(resolve(`.tmp/semantic-smoke/${name}.png`),join(folder,`${name}.png`));
await copyFile(join(folder,`${names[0]}.png`),join(folder,"sub","nested.png"));
await writeFile(join(folder,"broken.png"),"broken image fixture");
const database=new DatabaseSync(join(userData,"library.db")),timestamp=new Date().toISOString();
database.exec(`CREATE TABLE artworks(id TEXT PRIMARY KEY,path TEXT NOT NULL COLLATE NOCASE UNIQUE,file_name TEXT NOT NULL,imported_at TEXT NOT NULL,assessment_json TEXT,decision_json TEXT,source_platform TEXT,source_work_id TEXT,source_page_index INTEGER,author_id TEXT,author_name TEXT,work_title TEXT);
  CREATE TABLE collections(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',cover_artwork_id TEXT,created_at TEXT NOT NULL);
  CREATE TABLE collection_artworks(collection_id TEXT NOT NULL,artwork_id TEXT NOT NULL,PRIMARY KEY(collection_id,artwork_id));
  CREATE TABLE user_preferences(key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at TEXT NOT NULL);`);
const album={id:"smoke-album"};database.prepare("INSERT INTO collections(id,name,created_at)VALUES(?,?,?)").run(album.id,"找图结果",timestamp);
for(let index=0;index<2;index++){
  const path=join(root,`456_p${index}.png`);await copyFile(join(folder,`${names[index]}.png`),path);
  database.prepare("INSERT INTO artworks(id,path,file_name,imported_at,source_platform,source_work_id,source_page_index,author_id,author_name,work_title)VALUES(?,?,?,?,'pixiv','456',?,'789','测试画师','双页测试作品')").run(`seed-${index}`,path,basename(path),timestamp,index);
}
database.prepare("INSERT INTO user_preferences VALUES(?,?,?)").run("library.preferences",JSON.stringify({defaultView:"flat",defaultSortBy:"savedAt",defaultSortDirection:"desc",gridDensity:"comfortable",downloadDirectory:join(root,"Storage","Pixiv")}),timestamp);database.close();
const port=await availablePort(),mainPort=await availablePort(),screenshots=resolve(".tmp/image-workbench-smoke");await mkdir(screenshots,{recursive:true});
const child=spawn(resolve("node_modules/electron/dist/electron.exe"),[resolve("apps/desktop/out/main/index.js"),`--inspect=127.0.0.1:${mainPort}`,`--remote-debugging-port=${port}`,`--user-data-dir=${userData}`,"--host-resolver-rules=MAP pixiv.net ~NOTFOUND, MAP *.pixiv.net ~NOTFOUND"],{windowsHide:true,stdio:["ignore","pipe","pipe"],env:{...process.env,LOCALAPPDATA:join(root,"LocalAppData")}});
let main,cdp,stderr="";child.stderr.on("data",chunk=>{stderr+=String(chunk);});const checks=[];
try{
  main=await connectElectronMainInspector(mainPort);await showElectronTestWindow(main);cdp=await renderer();
  await main.evaluate(`(()=>{const electron=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    globalThis.__workbenchSmoke={picks:[]};electron.dialog.showOpenDialog=async(...args)=>{const options=args.at(-1);__workbenchSmoke.picks.push(options.title);return {canceled:false,filePaths:[options.title.includes('复制原图')?${JSON.stringify(destination)}:${JSON.stringify(folder)}]};};return true;})()`);
  await cdp.send("Emulation.setDeviceMetricsOverride",{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  await click('[data-home-task="organize"]');await clickText('[aria-label="图片来源"] button',"本地文件夹");
  await clickText('.image-workbench-controls button',"选择图片文件夹");
  await waitFor("(async()=>{const s=await window.sanctuary.currentWorkbench('folder');return s?.phase==='ready'&&s.total===4})()");
  let session=await cdp.evaluate("window.sanctuary.currentWorkbench('folder')");
  assert.equal(await countWorks(),1);assert.equal(session.recursive,false);
  await waitFor("Array.from(document.querySelectorAll('.workbench-image-grid img')).filter(i=>!i.alt.includes('broken')).every(i=>i.complete&&i.naturalWidth>0)");
  await shot("folder-preview-1280");checks.push("native-folder-preview-without-import-and-bounded-thumbnail-protocol");
  console.log("Folder preview passed; checking WD analysis");
  await waitFor("(async()=>{const s=await window.sanctuary.status();return s.visionReady&&s.modelBacked})()",90000);
  await clickText('.image-workbench-controls button',"分析并排查");await finished("folder");
  session=await cdp.evaluate("window.sanctuary.currentWorkbench('folder')");assert.equal(session.failed,1);assert.equal(session.processed,4);assert.equal(await countWorks(),1);
  checks.push("real-WD-rule-analysis-keeps-failures-separate-and-does-not-import");
  console.log("WD analysis passed; checking real Chinese semantic query");
  await clickText('[aria-label="文件夹查找方式"] button',"按画面描述");
  await fill('[aria-label="画面描述"]',"夜晚，月亮和星星");
  assert.equal((await cdp.evaluate("window.sanctuary.semanticAvailability()")).available,true);
  await assertFindActionVisible();
  const started=Date.now();await clickText('.image-workbench-controls button',"按描述找图");
  await click('[aria-label="任务与进度"]');await waitFor("document.querySelector('[data-task-kind=workbench]')?.textContent.includes('处理中')");
  await clickText('[data-task-kind=workbench] button',"返回找图与取用");await waitFor("document.querySelector('[aria-label=\"画面描述\"]')?.value==='夜晚，月亮和星星'");
  checks.push("model-cold-load-keeps-task-center-responsive-and-restores-pending-query");
  await finished("folder",180000);
  let ranked=await cdp.evaluate(`window.sanctuary.getWorkbench(${JSON.stringify(session.id)},0,'matches')`);
  assert.equal(ranked.items[0].fileName,"night-moon-and-stars.png");assert.equal(ranked.failed,1);assert.equal(ranked.matched,3);
  checks.push({name:"real-offline-EmbeddingGemma2-Chinese-query-ranks-image-content",elapsedMs:Date.now()-started});
  const warmStarted=Date.now();await fill('[aria-label="画面描述"]',"白色背景上的红色正方形");await clickText('.image-workbench-controls button',"按描述找图");await finished("folder");
  ranked=await cdp.evaluate(`window.sanctuary.getWorkbench(${JSON.stringify(session.id)},0,'matches')`);assert.equal(ranked.items[0].fileName,"red-square.png");
  const cache=new DatabaseSync(join(userData,"semantic-index.db"));assert.equal(cache.prepare("SELECT COUNT(*) AS count FROM vectors").get().count,3);cache.close();
  assert.equal(await countWorks(),1);checks.push({name:"second-query-reuses-three-persistent-content-vectors",elapsedMs:Date.now()-warmStarted});await shot("folder-Chinese-description-results-1280");
  await cdp.evaluate("document.querySelector('.workbench-image-grid input').click()");
  await writeFile(join(destination,"red-square.png"),"existing file");await clickText('.workbench-result-actions button',"复制所选原图");
  await waitFor("(async()=>{const b=await window.sanctuary.currentImageExport();return b?.phase==='completed'})()");
  const output=await cdp.evaluate("window.sanctuary.currentImageExport()");assert.equal(output.items.length,1);assert.equal(output.items[0].status,"copied");
  console.log("Chinese queries and original export passed; checking clipboard/import and task return");
  assert.equal(await readFile(join(destination,"red-square.png"),"utf8"),"existing file");assert.deepEqual(await readFile(join(destination,"red-square (2).png")),await readFile(join(folder,"red-square.png")));
  checks.push("UI-copy-selected-original-preserves-conflicting-file-and-original-bytes");
  await clickText('.workbench-image-grid button',"取用此图");
  await main.evaluate(`(()=>{const {clipboard}=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');globalThis.__clipboardBefore=clipboard.availableFormats().map(format=>[format,clipboard.readBuffer(format).toString('base64')]);return true;})()`);
  await clickText('.workbench-single-output button',"复制图片");await waitFor("document.querySelector('.workbench-single-output').textContent.includes('图片已复制')");
  assert.equal(await main.evaluate(`(()=>{const {clipboard}=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');return !clipboard.readImage().isEmpty()})()`),true);await restoreClipboard();
  checks.push("real-clipboard-image-from-selected-folder-capability");
  await clickText('.workbench-result-actions button',"导入所选图片");await waitFor("Boolean(document.querySelector('.import-images-dialog [data-import-action=start]'))");
  assert.equal(await cdp.evaluate("document.querySelector('.import-images-dialog').textContent.includes('已选择 1 张图片')"),true);await click('.import-images-dialog [data-import-action="start"]');
  await waitFor("document.querySelector('.import-images-dialog h2')?.textContent==='导入结果'");assert.equal(await countWorks(),2);
  await key("Escape");checks.push("selected-only-import-reuses-existing-confirmation-and-keeps-source-files");
  await click('[data-nav="settings"]');await click('[data-nav="home"]');await click('[data-home-task="organize"]');await clickText('[aria-label="图片来源"] button',"本地文件夹");
  await waitFor("document.querySelector('[aria-label=\"画面描述\"]')?.value==='白色背景上的红色正方形'");assert.equal((await cdp.evaluate("window.sanctuary.currentWorkbench('folder')")).id,session.id);
  checks.push("return-to-folder-restores-session-and-query-without-running-model");
  await click('[aria-label="任务与进度"]');await waitFor("Boolean(document.querySelector('[data-task-kind=workbench]'))");
  assert.equal(await cdp.evaluate("Boolean(document.querySelector('[data-task-kind=copy]'))"),true);
  await clickText('[data-task-kind=copy] button',"返回找图与取用");
  await waitFor("Boolean(document.querySelector('.workbench-result-actions .image-output-progress'))");
  assert.equal((await cdp.evaluate("window.sanctuary.currentWorkbench('folder')")).id,session.id);
  checks.push("task-center-exposes-copy-and-analysis-and-returns-to-progress-without-reselection");
  await clickText('[aria-label="图片来源"] button',"我的图库");await clickText('[aria-label="整理方式"] button',"按画面描述");
  await clickText('.image-workbench-controls button',"载入当前图库范围");await waitFor("(async()=>{const s=await window.sanctuary.currentWorkbench('library');return s?.phase==='ready'&&s.total===3})()");
  await fill('[aria-label="画面描述"]',"夜晚，月亮和星星");await clickText('.image-workbench-controls button',"按描述找图");await finished("library");
  const library=await cdp.evaluate("window.sanctuary.currentWorkbench('library')");ranked=await cdp.evaluate(`window.sanctuary.getWorkbench(${JSON.stringify(library.id)},0,'matches')`);assert.equal(ranked.items[0].fileName,"456_p1.png");
  await cdp.evaluate("document.querySelector('.workbench-image-grid input').click()");await fill('[aria-label="找图结果相册"]',album.id);await clickText('.workbench-result-actions button',"加入相册");
  await waitFor("document.querySelector('.image-workbench-controls').textContent.includes('已将 1 张所选图片加入相册')");
  const pages=await cdp.evaluate(`window.sanctuary.listScopedArtworks({kind:'collection',collectionId:${JSON.stringify(album.id)}})`);assert.equal(pages.length,1);assert.equal(pages[0].pageIndex,1);
  checks.push("library-description-search-includes-all-pages-and-archives-selected-page-only");
  const batch=await cdp.evaluate("window.sanctuary.exportImages([{workId:'pixiv:456'}])");await waitFor(`(async()=>{const b=await window.sanctuary.getImageExport(${JSON.stringify(batch.id)});return b.phase==='completed'})()`);
  const multipage=await cdp.evaluate(`window.sanctuary.getImageExport(${JSON.stringify(batch.id)})`);assert.equal(multipage.items.length,2);assert.ok(multipage.items.every(i=>i.status==='copied'));
  checks.push("whole-work-export-includes-every-original-page");
  console.log("Library page search and archive passed; checking layouts and dark theme");
  await showElectronTestWindow(main);await cdp.send("Page.bringToFront");
  for(const width of [1280,900]){
    await cdp.send("Emulation.setDeviceMetricsOverride",{width,height:620,deviceScaleFactor:1,mobile:false});
    const bounds=await cdp.evaluate("(()=>{const e=document.querySelector('.image-workbench'),r=e.getBoundingClientRect();return {overflow:e.scrollWidth-e.clientWidth,right:r.right,width:innerWidth}})()");assert.ok(bounds.overflow<=2&&bounds.right<=bounds.width);await shot(`library-description-${width}`);
  }
  checks.push("1280-and-900-window-layout-without-horizontal-clipping");
  await cdp.evaluate("window.sanctuary.setActiveTheme('builtin.cyber-deck')");
  await waitFor("(async()=>{const a=await window.sanctuary.getActiveTheme();return a.themeId==='builtin.cyber-deck'&&document.querySelector('#ds-dynamic-theme')?.textContent===a.cssContent})()");
  await cdp.evaluate("document.querySelector('[aria-label=\"画面描述\"]').scrollIntoView({block:'center'})");await shot("library-description-dark-900");
  const contrast=await cdp.evaluate(`(()=>{const s=getComputedStyle(document.querySelector('[aria-label="画面描述"]'));const l=c=>c.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>{const n=v/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4}).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);const a=l(s.color),b=l(s.backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)})()`);assert.ok(contrast>=4.5,`Input contrast ${contrast}`);
  checks.push("dark-theme-query-readable-and-result-actions-reachable");
  const report={status:"passed",checks,screenshots};await writeFile(join(screenshots,"result.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){console.error(error.stack||error);if(cdp)await shot("failure").catch(()=>{});console.error(stderr.slice(-5000));process.exitCode=1;}
finally{
  if(main)await restoreClipboard().catch(()=>{});cdp?.close();main?.close();child.kill();await new Promise(done=>{if(child.exitCode!==null)done();else{child.once("exit",done);setTimeout(done,2000);}});
  const absolute=resolve(root);if(!absolute.startsWith(`${resolve(tmpdir())}${sep}sanctuary-workbench-smoke-`))throw new Error("Unexpected test directory");await rm(absolute,{recursive:true,force:true,maxRetries:8,retryDelay:150});
}
async function restoreClipboard(){return main.evaluate(`(()=>{if(!globalThis.__clipboardBefore)return false;const {clipboard}=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');clipboard.clear();for(const [format,data]of __clipboardBefore)clipboard.writeBuffer(format,Buffer.from(data,'base64'));delete globalThis.__clipboardBefore;return true;})()`);}
async function countWorks(){return cdp.evaluate("(async()=>(await window.sanctuary.queryWorks({})).total)()");}
async function assertFindActionVisible(){await cdp.evaluate("document.querySelector('main').scrollTop=0");const bottom=await cdp.evaluate("Array.from(document.querySelectorAll('.image-workbench-controls button')).find(b=>b.textContent==='按描述找图').getBoundingClientRect().bottom");assert.ok(bottom<=720,`Find action below initial viewport: ${bottom}`);}
async function finished(source,timeout=90000){await waitFor(`(async()=>{const s=await window.sanctuary.currentWorkbench('${source}');return s&&s.phase!=='analyzing'&&s.phase!=='scanning'})()`,timeout);const s=await cdp.evaluate(`window.sanctuary.currentWorkbench('${source}')`);assert.equal(s.phase,"completed",s.error);await waitFor("!Array.from(document.querySelectorAll('.image-workbench-controls button')).some(b=>b.textContent.includes('停止分析'))");}
async function waitFor(expression,timeout=20000){const start=Date.now();while(Date.now()-start<timeout){if(await cdp.evaluate(expression))return;await new Promise(done=>setTimeout(done,100));}throw new Error(`Timed out: ${expression}`);}
async function click(selector){await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);}
async function clickText(selector,text){await waitFor(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some(e=>e.textContent.includes(${JSON.stringify(text)})&&!e.disabled)`);await cdp.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.textContent.includes(${JSON.stringify(text)})).click()`);}
async function fill(selector,value){await cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),p=e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);}
async function key(key){await cdp.send("Input.dispatchKeyEvent",{type:"keyDown",key,code:key});await cdp.send("Input.dispatchKeyEvent",{type:"keyUp",key,code:key});}
async function shot(name){await cdp.evaluate("new Promise(done=>setTimeout(done,100))");const capture=await cdp.send("Page.captureScreenshot",{format:"png",fromSurface:true});await writeFile(join(screenshots,`${name}.png`),Buffer.from(capture.data,"base64"));}
async function renderer(){const start=Date.now();while(Date.now()-start<20000){try{const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json(),target=targets.find(t=>t.type==="page"&&t.url?.includes("renderer/index.html"));if(target?.webSocketDebuggerUrl)return connect(target.webSocketDebuggerUrl);}catch{}await new Promise(done=>setTimeout(done,100));}throw new Error("Renderer unavailable");}
async function availablePort(){const server=createServer();return new Promise((done,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>{const port=server.address().port;server.close(error=>error?reject(error):done(port));});});}
async function connect(url){const socket=new WebSocket(url),pending=new Map();let next=1;socket.addEventListener("message",e=>{const r=JSON.parse(e.data),p=pending.get(r.id);if(!p)return;pending.delete(r.id);r.error?p.reject(new Error(r.error.message)):p.resolve(r.result);});await new Promise((done,reject)=>{socket.addEventListener("open",done,{once:true});socket.addEventListener("error",reject,{once:true});});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=next++,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method} ${params.expression?.slice(0,160)??""}`));},20000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));});
  return{send,close:()=>socket.close(),evaluate:async expression=>{const r=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}};
}
