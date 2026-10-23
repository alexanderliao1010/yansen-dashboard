/* 硯森營造｜工程儀表板（GitHub Pages 版）
   資料：data/projects.json、data/holidays.json、data/<id>/...
   新增／編輯／刪除透過 GitHub API 寫回儲存庫（需在「GitHub 連線」輸入存取金鑰）。 */
let PROJECTS=[], HOLIDAYS=new Set(), READY=false;
const TXT={}, BUD={};

const $=s=>document.querySelector(s);
const $$=s=>document.querySelectorAll(s);
const fmt=n=>Number(n||0).toLocaleString('zh-TW');
const pd=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)};
const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const roc=s=>{if(!s)return'';const d=typeof s==='string'?pd(s):s;return (d.getFullYear()-1911)+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0')};
const wk=d=>'日一二三四五六'[d.getDay()];
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const today=()=>{const t=new Date();return new Date(t.getFullYear(),t.getMonth(),t.getDate())};
const ND='<span class="pending">待補</span>';
const base=p=>p.awardDate||p.start||iso(today());
const daysBetween=(a,b)=>Math.round((b-a)/86400000);
const nocache=u=>u.startsWith('blob:')?u:u+(u.includes('?')?'&':'?')+'v='+Date.now();
function store(k,v){try{if(v===undefined)return localStorage.getItem(k);if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v)}catch(e){return null}}

function isWork(d){const w=d.getDay();return w!==0&&w!==6&&!HOLIDAYS.has(iso(d))}
function finish(p){
  if(!p.start||!p.days)return null;
  let d=pd(p.start);
  if(p.dayType==='cal'){d.setDate(d.getDate()+Number(p.days)-1);return d}
  let n=0,g=0;while(g++<3000){if(isWork(d)){n++;if(n===Number(p.days))return d}d.setDate(d.getDate()+1)}return null;
}

/* ---------------- GitHub ---------------- */
const GH={
  cfg(){
    let c={};try{c=JSON.parse(store('ys-gh')||'{}')}catch(e){}
    const m=location.hostname.match(/^([\w-]+)\.github\.io$/i);
    if(m&&!c.owner)c.owner=m[1];
    if(m&&!c.repo)c.repo=location.pathname.split('/').filter(Boolean)[0]||'';
    c.branch=c.branch||'main';
    return c;
  },
  ready(){const c=this.cfg();return !!(c.owner&&c.repo&&c.token)},
  async api(path,opt={}){
    const c=this.cfg();
    let r;
    try{r=await fetch(`https://api.github.com/repos/${c.owner}/${c.repo}${path}`,{...opt,headers:{Authorization:'Bearer '+c.token,Accept:'application/vnd.github+json',...(opt.body?{'Content-Type':'application/json'}:{}),...(opt.headers||{})}})}
    catch(e){throw new Error(ON_PAGES?'連不到 GitHub。請確認網路正常，並關掉會封鎖 api.github.com 的廣告阻擋外掛後再試':'這是預覽頁，不能連線 GitHub，請到 GitHub 網站版操作')}
    if(!r.ok){let m='';try{m=(await r.json()).message}catch(e){}
      const why={401:'金鑰無效或已過期，請重新產生一組',403:'金鑰權限不足，Contents 要設為 Read and write',404:'找不到儲存庫：請確認帳號、儲存庫名稱，以及金鑰有勾選這個儲存庫',409:'儲存庫是空的或正在更新，請稍後再試',422:'GitHub 拒絕了這次寫入，請重新整理頁面後再試'}[r.status];
      throw new Error(why?`${why}（GitHub ${r.status}）`:`GitHub ${r.status}${m?'：'+m:''}`)}
    return r.status===204?null:r.json();
  },
  async raw(path){
    const c=this.cfg();
    const r=await fetch(`https://api.github.com/repos/${c.owner}/${c.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${c.branch}`,{headers:{Authorization:'Bearer '+c.token,Accept:'application/vnd.github.raw'}});
    if(!r.ok)throw new Error('GitHub '+r.status);
    return r.blob();
  },
  async latestProjects(){
    const c=this.cfg();
    const j=await this.api(`/contents/data/projects.json?ref=${c.branch}`);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(j.content.replace(/\n/g,'')),ch=>ch.charCodeAt(0))));
  },
  async listUnder(prefix){
    const c=this.cfg();
    const ref=await this.api(`/git/ref/heads/${c.branch}`);
    const cm=await this.api(`/git/commits/${ref.object.sha}`);
    const t=await this.api(`/git/trees/${cm.tree.sha}?recursive=1`);
    return t.tree.filter(x=>x.type==='blob'&&x.path.startsWith(prefix)).map(x=>x.path);
  },
  /* changes: [{path, b64}] 寫入，[{path, b64:null}] 刪除；一次 commit */
  async commit(changes,message,onStep){
    const c=this.cfg();
    const ref=await this.api(`/git/ref/heads/${c.branch}`);
    const cm=await this.api(`/git/commits/${ref.object.sha}`);
    const tree=[];let i=0;
    for(const ch of changes){
      i++;
      if(ch.b64===null){tree.push({path:ch.path,mode:'100644',type:'blob',sha:null});continue}
      onStep&&onStep(`上傳檔案 ${i}／${changes.length}…`);
      const b=await this.api('/git/blobs',{method:'POST',body:JSON.stringify({content:ch.b64,encoding:'base64'})});
      tree.push({path:ch.path,mode:'100644',type:'blob',sha:b.sha});
    }
    onStep&&onStep('寫入儲存庫…');
    const t=await this.api('/git/trees',{method:'POST',body:JSON.stringify({base_tree:cm.tree.sha,tree})});
    const n=await this.api('/git/commits',{method:'POST',body:JSON.stringify({message,tree:t.sha,parents:[ref.object.sha]})});
    await this.api(`/git/refs/heads/${c.branch}`,{method:'PATCH',body:JSON.stringify({sha:n.sha})});
  }
};
const b64text=s=>{const u=new TextEncoder().encode(s);let b='';for(let i=0;i<u.length;i+=0x8000)b+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(b)};
const b64file=f=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]);r.onerror=rej;r.readAsDataURL(f)});
const jsonOut=a=>JSON.stringify(a,null,1)+'\n';

/* 寫回：有連線就 commit，否則只改本頁（預覽） */
async function persist(mutate,files,message,onStep){
  if(GH.ready()){
    const latest=await GH.latestProjects();
    const next=mutate(latest);
    const delPaths=(files||[]).filter(f=>f.del).flatMap(f=>f.del);
    const changes=[...(files||[]).filter(f=>f.path),...delPaths.map(p=>({path:p,b64:null})),{path:'data/projects.json',b64:b64text(jsonOut(next))}];
    await GH.commit(changes,message,onStep);
    PROJECTS=next;SAVED_AT=Date.now();
  }else{
    PROJECTS=mutate(PROJECTS.slice());
    (files||[]).forEach(f=>{if(f.blobUrl)LOCALFILES[f.path]=f.blobUrl});
  }
}
const LOCALFILES={};let SAVED_AT=0;
const ON_PAGES=/\.github\.io$/i.test(location.hostname);
/* 在 GitHub 網站上，沒連線就不讓改，避免改了卻沒存到 */
function needConn(next){
  if(GH.ready()||!ON_PAGES)return next();
  settingsModal(next,'還沒連線 GitHub，新增、修改或刪除的內容不會存檔。請先貼上存取金鑰。');
}
const fileUrl=p=>LOCALFILES[p]||p;

/* ---------------- home ---------------- */
function banner(){
  if(GH.ready()) return SAVED_AT&&Date.now()-SAVED_AT<180000?`<div class="banner ok"><span>已存到 GitHub。這台裝置馬上看得到；其他裝置約 1～2 分鐘後重新整理就會更新。</span></div>`:'';
  if(ON_PAGES)return `<div class="banner"><span>這台裝置還沒連線 GitHub：可以瀏覽，但要新增、修改或刪除工程，請先連線。</span><button data-act="settings">連線 GitHub</button></div>`;
  return `<div class="banner"><span>預覽模式：新增、編輯、刪除只會改這個頁面，重新整理後就會還原。放上 GitHub 並連線後才會真正存檔。</span><button data-act="settings">設定 GitHub 連線</button></div>`;
}
function renderHome(){
  const t=today();
  const total=PROJECTS.reduce((s,p)=>s+(Number(p.amount)||0),0), miss=PROJECTS.filter(p=>!p.amount).length;
  let rows='', axis='';
  if(PROJECTS.length){
    let min=Math.min(...PROJECTS.map(p=>+pd(base(p))));
    const maxs=PROJECTS.map(p=>{const f=finish(p);if(f)return +f;const g=pd(base(p));g.setDate(g.getDate()+Math.round((p.days||60)*(p.dayType==='work'?1.45:1))+20);return +g});
    let max=Math.max(...maxs,+t+30*86400000);
    const mn=new Date(min);mn.setDate(1);min=+mn;const mx=new Date(max);mx.setMonth(mx.getMonth()+1,1);max=+mx;
    const pos=d=>((+d-min)/(max-min)*100).toFixed(2)+'%';
    {let m=new Date(min);while(+m<=max){axis+=`<span style="left:${pos(m)}">${m.getFullYear()-1911}/${m.getMonth()+1}</span>`;m.setMonth(m.getMonth()+1)}}
    rows=PROJECTS.map(p=>{
      const f=finish(p), st=p.start, unit=p.dayType==='work'?'工作天':'日曆天';
      const a=p.awardDate?pd(p.awardDate):null;
      let strip=`<div class="rail"></div>`;
      if(a)strip+=`<div class="tick" style="left:${pos(a)}">決標</div>`;
      if(st&&f){
        const s=pd(st);
        if(a)strip+=`<div class="seg wait" style="left:${pos(a)};width:calc(${pos(s)} - ${pos(a)})"></div>`;
        if(+t>+s)strip+=`<div class="seg build" style="left:${pos(s)};width:calc(${pos(Math.min(+t,+f))} - ${pos(s)})"></div>`;
        if(+t<+f)strip+=`<div class="seg done" style="left:${pos(Math.max(+s,+t))};width:calc(${pos(f)} - ${pos(Math.max(+s,+t))})"></div>`;
        strip+=`<div class="tick" style="left:${pos(s)}">開工</div><div class="tick" style="left:${pos(f)}">完工</div>`;
      }else if(a)strip+=`<div class="seg wait" style="left:${pos(a)};width:calc(${pos(t)} - ${pos(a)})"></div>`;
      strip+=`<div class="today" style="left:${pos(t)}"><span>今日</span></div>`;
      let status;
      if(!st)status=`<span class="pending">等待開工通知</span>${p.startRule?'，'+esc(p.startRule):''}${a?`；決標至今 ${daysBetween(a,t)} 天`:''}`;
      else if(+t<+pd(st))status=`距開工 ${daysBetween(t,pd(st))} 天`;
      else if(f&&+t<=+f)status=`施工中，距預期完工 ${daysBetween(t,f)} 日曆天`;
      else if(f)status=`已超過預期完工日 ${daysBetween(f,t)} 天，請確認驗收或展延`;
      else status='';
      return `<section class="proj" aria-label="${esc(p.short||p.name)}">
      <div class="lrow">
        <div class="first"><h2 class="pname"><a href="#/${p.id}/contract">${esc(p.name)}</a></h2><div class="agency">${esc(p.agency)}${p.caseNo?`｜${esc(p.caseLabel||'案號')} ${esc(p.caseNo)}`:''}</div></div>
        <div class="cell"><span class="k">決標日</span>${a?roc(p.awardDate):ND}<small>${p.announce?'公告 '+roc(p.announce):''}</small></div>
        <div class="cell startbox"><span class="k">開工日</span>${st?`${roc(st)}（${wk(pd(st))}）<br><button data-sedit="${p.id}">修改</button><input type="date" hidden data-start="${p.id}" value="${st}">`:`<input type="date" aria-label="開工日" data-start="${p.id}" min="${p.awardDate||''}"><small>收到通知後填入</small>`}</div>
        <div class="cell"><span class="k">施工天數</span>${p.days||'—'}<span class="daytag ${p.dayType}">${unit}</span><small>${esc(p.startRule||'')}</small></div>
        <div class="cell"><span class="k">預期完工日</span>${f?`<b>${roc(f)}</b>（${wk(f)}）`:'<span style="color:var(--ink-3)">開工後計算</span>'}<small>${f?(p.dayType==='work'?'已扣週末及國定假日':'開工日算第 1 天'):''}</small></div>
        <div class="cell"><span class="k">決標金額</span>${p.amount?`<span class="money">${fmt(p.amount)}</span> 元<small>${p.ratio?'標比 '+esc(p.ratio):''}</small>`:ND}</div>
        <div class="cell"><span class="k">監造單位</span>${!p.supervisor||p.supervisor==='待確認'?'<span class="pending">待確認</span>':esc(p.supervisor)}<small>${esc(p.supNote||'')}</small></div>
        <div class="cell contact"><span class="k">業主窗口</span>${!p.contact||p.contact==='待補'?ND:esc(p.contact)}<small>${p.phone?`<a href="tel:${esc(p.tel||p.phone.replace(/[^\d]/g,''))}">${esc(p.phone)}</a>`:''}${p.email?`<br><a href="mailto:${esc(p.email)}">${esc(p.email)}</a>`:''}</small></div>
      </div>
      <div class="strip"><div class="track">${strip}</div>
        <div class="stripfoot"><span>${status}</span><span class="go"><a href="#/${p.id}/contract">工程契約</a><a href="#/${p.id}/drawings">圖說</a><a href="#/${p.id}/budget">預算</a>${progBtn(p)}</span></div></div>
    </section>`}).join('');
  }
  $('#app').innerHTML=`
  <header class="mast">
    <div class="brand"><div class="seal" aria-hidden="true">硯森<br>營造</div><div><h1>工程儀表板</h1><p>硯森營造有限公司｜今日 ${roc(t)}</p></div></div>
    <div class="mastr"><div class="totals"><div><b>${PROJECTS.length}</b><span>執行中工程</span></div><div><b>${fmt(total)}</b><span>決標金額合計（元）${miss?`，${miss} 件待補`:''}</span></div></div>
      <div class="actions"><button class="btn primary" data-act="add">＋ 新增工程</button><button class="btn" data-act="settings">GitHub 連線</button></div></div>
  </header>
  ${banner()}
  <div class="ledger">
    ${PROJECTS.length?`<div class="lhead"><div>工程名稱</div><div>決標日</div><div>開工日</div><div>施工天數</div><div>預期完工日</div><div>決標金額（元）</div><div>監造單位</div><div>業主窗口</div></div>${rows}<div class="axis">${axis}</div>`:'<p class="empty">目前沒有工程。按「新增工程」開始。</p>'}
  </div>
  <p class="note">點工程名稱進入工程契約、圖說與預算。工作天計算已扣除週六、週日與國定假日；116 年假日為依放假規則推估，機關書面同意於假日施工或展延工期時，請以監造核定為準。</p>`;
  $$('input[data-start]').forEach(inp=>inp.addEventListener('change',async e=>{
    const id=e.target.dataset.start,v=e.target.value;if(!v)return;
    if(ON_PAGES&&!GH.ready()){e.target.value=PROJECTS.find(p=>p.id===id)?.start||'';needConn(()=>route());return}
    try{await persist(arr=>arr.map(p=>p.id===id?{...p,start:v}:p),[],`更新開工日：${PROJECTS.find(p=>p.id===id)?.short||id} ${v}`)}catch(err){alert('開工日沒有存成功：'+err.message)}
    route();
  }));
  $$('[data-sedit]').forEach(b=>b.onclick=()=>{const inp=document.querySelector(`input[data-start="${b.dataset.sedit}"]`);inp.hidden=false;inp.focus();try{inp.showPicker()}catch(e){}});
}

/* ---------------- detail ---------------- */
/* 先讀網站上的檔案；剛上傳、網站還沒更新時，改從 GitHub 直接讀 */
async function getFile(src){
  try{const r=await fetch(nocache(fileUrl(src)));if(r.ok)return r.blob()}catch(e){}
  if(GH.ready())return GH.raw(src);
  throw new Error('找不到檔案');
}
async function fixPdfFrames(){
  for(const el of $$('[data-pdf]')){
    const src=el.dataset.pdf;if(src.startsWith('blob:'))continue;
    let ok=false;try{ok=(await fetch(nocache(src),{method:'HEAD'})).ok}catch(e){}
    if(ok||!GH.ready())continue;
    try{const b=await GH.raw(src);const u=URL.createObjectURL(new Blob([b],{type:'application/pdf'}));LOCALFILES[src]=u;
      el.querySelector('iframe').src=u;el.querySelector('a').href=u}catch(e){}
  }
}
async function loadText(p){
  const src=p.docs?.contract?.text; if(!src){TXT[p.id]='';return}
  TXT[p.id]=await getFile(src).then(b=>b.text()).catch(()=>'');
  route();
}
async function loadBudget(p){
  const src=p.docs?.budget?.json; if(!src){BUD[p.id]=null;return}
  BUD[p.id]=await getFile(src).then(b=>b.text()).then(JSON.parse).catch(()=>null);
  route();
}
function contractHTML(pid){
  const lines=(TXT[pid]||'').split(/\n+/).map(s=>s.trim()).filter(Boolean);
  const toc=[];let html='';
  lines.forEach(ln=>{
    let t=esc(ln).replace(/\\([_*])/g,'$1').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\*\*/g,'');
    const on=/[■▓]/.test(t);
    t=t.replace(/[■▓]([^□■▓，。；：、（）()\s]{0,24})/g,'<span class="on">■$1</span>');
    const m=ln.match(/^第\s*(\d+)\s*條(之\d+)?\s*(.*)$/);
    if(m&&ln.length<40){const id=`c${pid}-${m[1]}${m[2]||''}`;toc.push([id,`第${m[1]}條${m[2]||''} ${m[3].replace(/\*/g,'')}`]);html+=`<h4 id="${id}">${t}</h4>`}
    else html+=`<p${on?' class="hasOn"':''}>${t}</p>`;
  });
  return {html,toc};
}
const pagesHTML=(list,label,group)=>list.map((pg,i)=>`<img loading="lazy" src="${esc(fileUrl(pg.src))}" alt="${label} 第 ${i+1} 頁" data-g="${group}" data-i="${i}">`).join('');
const pdfHTML=(src,label)=>`<div class="pdfbox" data-pdf="${esc(fileUrl(src))}"><p class="hint">${label}（PDF）。手機若只顯示第一頁，請點「開新視窗」。 <a href="${esc(fileUrl(src))}" target="_blank" rel="noopener">開新視窗</a></p><iframe src="${esc(fileUrl(src))}" title="${label}"></iframe></div>`;

function budgetHTML(p){
  const B=BUD[p.id], src=p.docs?.budget;
  if(!src)return `<p class="empty">尚未上傳標單。到「編輯」上傳標單 Excel（.xlsx）後，這裡會列出每個工項的數量、單價和複價。</p>`;
  if(B===undefined){loadBudget(p);return '<p class="empty">載入標單中…</p>'}
  if(!B||!B.items?.length)return `<p class="empty">標單無法讀取。${src.file?`<a href="${esc(fileUrl(src.file))}">下載原檔</a>`:''}</p>`;
  const it=B.items, secs=it.filter(x=>x.lvl===1&&x.amt);
  const total=B.total||it.filter(x=>x.lvl===1).reduce((s,x)=>s+(x.amt||0),0);
  const maxS=Math.max(...secs.map(s=>s.amt),1);
  let sec=-1,html='';
  it.forEach((x,i)=>{
    if(x.lvl===1)sec=i;
    const cls=x.lvl===-1?'sub':'l'+x.lvl;
    html+=`<tr class="${cls}" data-sec="${x.lvl===2?sec:''}" ${x.lvl===1?`data-hd="${i}"`:''}><td>${esc(x.no)}</td><td>${esc(x.name)}</td><td class="hide-s">${esc(x.unit||'')}</td><td class="n hide-s">${x.qty!=null&&x.lvl===2?fmt(x.qty):''}</td><td class="n hide-s">${x.price!=null&&x.lvl===2?fmt(x.price):''}</td><td class="n">${x.amt?fmt(x.amt):''}</td><td class="code hide-s">${esc(x.note||'')}</td></tr>`;
  });
  const diff=p.amount&&total?Number(p.amount)-total:null;
  return `<div class="bhead"><div><small>標單合計</small><span class="big">${fmt(total)}</span> 元</div>
    <div style="text-align:right"><small>決標金額 ${p.amount?fmt(p.amount)+' 元':'待補'}${diff!=null?(Math.abs(diff)<=1?'，與標單合計相同':`，差額 ${fmt(diff)} 元`):''}</small>
    <small>資料來源：${esc(B.source||'標單')}${src.file?` ・ <a href="${esc(fileUrl(src.file))}">下載 Excel</a>`:''}</small></div></div>
    ${secs.length?`<div class="shares" aria-label="各分項金額">${secs.map(s=>`<span>${esc(s.no)}、${esc(s.name.replace(/\(.*$/,''))}</span><span class="bar"><i style="width:${(s.amt/maxS*100).toFixed(1)}%"></i></span><span class="v">${fmt(s.amt)}（${(s.amt/total*100).toFixed(1)}%）</span>`).join('')}</div>`:''}
    <div class="btools"><input id="bq" type="search" placeholder="搜尋工項，例如：植栽、鋼板、照明" aria-label="搜尋工項"><button class="btn" id="bcol">全部收合</button><button class="btn" id="bexp">全部展開</button></div>
    <div class="bwrap"><table class="btable"><thead><tr><th>項次</th><th>項目及說明</th><th class="hide-s">單位</th><th class="n hide-s">數量</th><th class="n hide-s">單價</th><th class="n">複價</th><th class="hide-s">編碼</th></tr></thead><tbody>${html}</tbody></table></div>`;
}
function wireBudget(){
  const rows=[...$$('.btable tbody tr')];
  const setSec=(i,open)=>{const hd=document.querySelector(`tr[data-hd="${i}"]`);hd&&hd.classList.toggle('closed',!open);rows.filter(r=>r.dataset.sec==String(i)).forEach(r=>r.hidden=!open)};
  $$('tr[data-hd]').forEach(h=>h.onclick=()=>setSec(h.dataset.hd,h.classList.contains('closed')));
  $('#bcol')&&($('#bcol').onclick=()=>$$('tr[data-hd]').forEach(h=>setSec(h.dataset.hd,false)));
  $('#bexp')&&($('#bexp').onclick=()=>$$('tr[data-hd]').forEach(h=>setSec(h.dataset.hd,true)));
  $('#bq')&&$('#bq').addEventListener('input',e=>{
    const q=e.target.value.trim();
    rows.forEach(r=>{ if(!q){r.hidden=false;r.classList.remove('closed');return}
      if(r.dataset.sec){r.hidden=!r.textContent.includes(q)}else if(r.dataset.hd){r.classList.remove('closed');r.hidden=!rows.some(x=>x.dataset.sec===r.dataset.hd&&x.textContent.includes(q))&&!r.textContent.includes(q)}else r.hidden=true;});
  });
}

function renderDetail(pid,tab,sub){
  const p=PROJECTS.find(x=>x.id===pid); if(!p){location.hash='';return}
  const D=p.docs||{}, st=p.start, f=finish(p), unit=p.dayType==='work'?'工作天':'日曆天';
  let body='';
  if(tab==='contract'){
    sub=sub||'summary';
    const subs=[['summary','重點摘要'],['text','契約全文'],['award','決標公告']];
    if(D.summary)subs.push(['orig','摘要原檔']);
    body+=`<div class="subnav" role="group" aria-label="契約文件">${subs.map(([k,v])=>`<button aria-pressed="${k===sub}" data-sub="${k}">${v}</button>`).join('')}</div>`;
    if(sub==='summary'){
      const row=(a,b)=>`<tr><th>${a}</th><td>${b}</td></tr>`, pairs=l=>(l||[]).map(x=>row(esc(x.k),esc(x.v))).join('');
      body+=`<div class="sumgrid">
        <div class="box"><h3>標案基本資料</h3><table>
          ${row('機關',esc(p.agency))}${row(esc(p.caseLabel||'標案案號'),p.caseNo?esc(p.caseNo):ND)}${p.method?row('招標／決標方式',esc(p.method)):''}
          ${row('決標日／公告日',p.awardDate?roc(p.awardDate)+'／'+(p.announce?roc(p.announce):ND):ND)}
          ${row('預算金額',p.budget?fmt(p.budget)+' 元':ND)}${row('底價',p.floor?fmt(p.floor)+' 元':ND)}
          ${row('決標金額',p.amount?`<b>${fmt(p.amount)} 元</b>${p.amountCN?'<br>'+esc(p.amountCN):''}${p.ratio?'，標比 '+esc(p.ratio):''}`:ND)}${row('是否受補助',p.subsidy&&p.subsidy!=='待補'?esc(p.subsidy):ND)}
        </table></div>
        <div class="box"><h3>工期與契約份數</h3><table>
          ${row('工期',`${p.days||'—'} ${unit}`)}${row('開工',esc(p.startRule||'')||ND)}
          ${row('實際開工日',st?roc(st):'<span class="pending">待通知</span>')}${row('預期完工日',f?`<b>${roc(f)}</b>（${wk(f)}）`:'開工後計算')}
          ${p.copies?row('契約書',esc(p.copies)):''}${p.priceAdj?row('物價調整',esc(p.priceAdj)):''}
        </table></div>
        ${p.docs3?.length?`<div class="box"><h3>三書及送審期限</h3><table>${pairs(p.docs3)}</table></div>`:''}
        ${p.payment?.length?`<div class="box"><h3>估驗與付款</h3><table>${pairs(p.payment)}</table></div>`:''}
        ${p.risks?.length?`<div class="box warn full"><h3>注意事項</h3><ol>${p.risks.map(x=>`<li><b>${esc(x.k)}</b>${esc(x.v)}</li>`).join('')}</ol></div>`:''}
        ${!p.docs3?.length&&!p.payment?.length?`<div class="box full"><h3>契約重點</h3><p style="margin:0;color:var(--ink-2)">三書期限、估驗付款和注意事項還沒整理。可以把契約交給 Claude 整理後補進來。</p></div>`:''}
      </div>`;
    }else if(sub==='text'){
      if(D.contract?.pdf&&!D.contract?.text) body+=pdfHTML(D.contract.pdf,'工程契約');
      else if(!D.contract?.text) body+='<p class="empty">尚未上傳契約。</p>';
      else if(TXT[pid]===undefined){body+='<p class="empty">載入契約全文中…</p>';loadText(p)}
      else{const c=contractHTML(pid);
        body+=`<div class="ctwrap"><nav class="toc" aria-label="條文目錄">${c.toc.map(([id,t])=>`<a href="#" data-jump="${id}">${esc(t)}</a>`).join('')}</nav>
          <div><div class="searchbar"><input id="q" type="search" placeholder="搜尋條文，例如：估驗、開工、保固" aria-label="搜尋契約全文"><button id="qprev" aria-label="上一個">↑</button><button id="qnext" aria-label="下一個">↓</button><span class="cnt" id="qcnt"></span><label><input type="checkbox" id="onlyOn">只看勾選項目（■）</label></div>
          <article class="ctext" id="ctext">${c.html}</article>${D.contract.pdf?`<p class="hint"><a href="${esc(fileUrl(D.contract.pdf))}" target="_blank" rel="noopener">開啟契約 PDF 原檔</a></p>`:''}</div></div>`;}
    }else if(sub==='award'){
      body+=D.award?.pages?`<p class="hint">點頁面可放大檢視。</p><div class="pages">${pagesHTML(D.award.pages,'決標公告','award')}</div>`:D.award?.pdf?pdfHTML(D.award.pdf,'決標公告'):'<p class="empty">尚未上傳決標公告。</p>';
    }else{
      body+=D.summary?.pages?`<div class="pages">${pagesHTML(D.summary.pages,'重點摘要','summary')}</div>`:D.summary?.pdf?pdfHTML(D.summary.pdf,'重點摘要'):'<p class="empty">沒有摘要原檔。</p>';
    }
  }else if(tab==='drawings'){
    const dr=D.draw;
    body+=dr?.pages?`<p class="hint">共 ${dr.pages.length} 張${p.drawOrg?'，出圖單位：'+esc(p.drawOrg):''}。點圖放大，可用左右鍵翻頁。</p>
      <div class="grid">${dr.pages.map((pg,i)=>`<button class="thumb" data-g="draw" data-i="${i}" aria-label="開啟第 ${i+1} 張"><img loading="lazy" src="${esc(fileUrl(pg.src))}" alt=""><span>第 ${String(i+1).padStart(2,'0')} 張</span></button>`).join('')}</div>`
      :dr?.pdf?pdfHTML(dr.pdf,'圖說'):'<p class="empty">尚未上傳圖說。</p>';
  }else body+=budgetHTML(p);

  $('#app').innerHTML=`
    <div class="dtop"><button class="back" id="back">‹ 回工程總覽</button><div class="actions">${progBtn(p,'btn')}<button class="btn" data-act="edit" data-id="${p.id}">編輯</button><button class="btn danger" data-act="del" data-id="${p.id}">刪除工程</button></div></div>
    ${banner()}
    <header class="dhead"><h2>${esc(p.name)}</h2><div class="sub">${esc(p.agency)}${p.caseNo?`｜${esc(p.caseLabel||'案號')} ${esc(p.caseNo)}`:''}</div>
      <dl class="facts">
        <div><dt>決標日</dt><dd>${p.awardDate?roc(p.awardDate):ND}</dd></div>
        <div><dt>開工日</dt><dd>${st?roc(st):'<span class="pending">待通知</span>'}</dd></div>
        <div><dt>施工天數</dt><dd>${p.days||'—'} ${unit}</dd></div>
        <div><dt>預期完工日</dt><dd>${f?roc(f):'開工後計算'}</dd></div>
        <div><dt>決標金額</dt><dd>${p.amount?fmt(p.amount)+' 元':ND}</dd></div>
        <div><dt>監造單位</dt><dd>${p.supervisor&&p.supervisor!=='待確認'?esc(p.supervisor):'<span class="pending">待確認</span>'}</dd></div>
        <div><dt>業主窗口</dt><dd>${p.contact&&p.contact!=='待補'?esc(p.contact):ND}${p.phone?`<br><span style="font-weight:400;font-size:13px">${esc(p.phone)}</span>`:''}</dd></div>
      </dl></header>
    <div class="tabs" role="tablist">${[['contract','工程契約'],['drawings','圖說'],['budget','預算']].map(([k,v])=>`<button role="tab" aria-selected="${tab===k}" data-tab="${k}">${v}</button>`).join('')}</div>
    <div class="pane">${body}</div>`;
  $('#back').onclick=()=>{location.hash=''};
  $$('[data-tab]').forEach(b=>b.onclick=()=>{location.hash=`#/${pid}/${b.dataset.tab}`});
  $$('[data-sub]').forEach(b=>b.onclick=()=>{location.hash=`#/${pid}/contract/${b.dataset.sub}`});
  const cap={draw:'圖說',award:'決標公告',summary:'重點摘要'};
  $$('[data-g]').forEach(el=>el.addEventListener('click',()=>openLB(D[el.dataset.g].pages.map(x=>({...x,src:fileUrl(x.src)})),+el.dataset.i,cap[el.dataset.g])));
  if(tab==='contract'&&sub==='text'&&$('#ctext'))wireSearch();
  if(tab==='budget')wireBudget();
  fixPdfFrames();
}

function wireSearch(){
  const box=$('#ctext');let hits=[],cur=-1;
  $$('[data-jump]').forEach(a=>a.onclick=e=>{e.preventDefault();document.getElementById(a.dataset.jump)?.scrollIntoView({block:'start'})});
  function clear(){box.querySelectorAll('mark').forEach(m=>m.replaceWith(document.createTextNode(m.textContent)));box.normalize()}
  function run(){
    clear();hits=[];cur=-1;const q=$('#q').value.trim();
    if(!q){$('#qcnt').textContent='';return}
    const w=document.createTreeWalker(box,NodeFilter.SHOW_TEXT);const nodes=[];while(w.nextNode())nodes.push(w.currentNode);
    nodes.forEach(n=>{
      const par=n.parentElement.closest('p');if(par&&getComputedStyle(par).display==='none')return;
      const txt=n.nodeValue;let idx=txt.indexOf(q);if(idx<0)return;
      const frag=document.createDocumentFragment();let last=0;
      while(idx>=0){frag.append(txt.slice(last,idx));const m=document.createElement('mark');m.textContent=q;frag.append(m);hits.push(m);last=idx+q.length;idx=txt.indexOf(q,last)}
      frag.append(txt.slice(last));n.replaceWith(frag);
    });
    $('#qcnt').textContent=hits.length?`${hits.length} 筆`:'查無結果';if(hits.length)go(0);
  }
  function go(i){if(!hits.length)return;hits[cur]?.classList.remove('cur');cur=(i+hits.length)%hits.length;hits[cur].classList.add('cur');hits[cur].scrollIntoView({block:'center'});$('#qcnt').textContent=`${cur+1}／${hits.length} 筆`}
  let tm;$('#q').addEventListener('input',()=>{clearTimeout(tm);tm=setTimeout(run,250)});
  $('#q').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();go(e.shiftKey?cur-1:cur+1)}});
  $('#qnext').onclick=()=>go(cur+1);$('#qprev').onclick=()=>go(cur-1);
  $('#onlyOn').onchange=e=>{box.classList.toggle('checkedonly',e.target.checked);run()};
}

/* ---------------- lightbox ---------------- */
let LB={list:[],i:0,cap:''};
function openLB(list,i,cap){LB={list,i,cap};$('#lb').classList.add('open');showLB();$('#lbclose').focus();document.body.style.overflow='hidden'}
function showLB(){const pg=LB.list[LB.i];$('#lbimg').src=pg.src;$('#lbimg').alt=`${LB.cap} 第 ${LB.i+1} 頁`;$('#lbcap').textContent=`${LB.cap}｜第 ${LB.i+1}／${LB.list.length} 張`;$('#lbstage').classList.remove('zoom');$('#lbzoom').textContent='原尺寸'}
function closeLB(){$('#lb').classList.remove('open');document.body.style.overflow=''}
function stepLB(d){LB.i=(LB.i+d+LB.list.length)%LB.list.length;showLB()}
function zoomLB(){const z=$('#lbstage').classList.toggle('zoom');$('#lbzoom').textContent=z?'符合畫面':'原尺寸'}
$('#lbclose').onclick=closeLB;$('#lbprev').onclick=()=>stepLB(-1);$('#lbnext').onclick=()=>stepLB(1);$('#lbzoom').onclick=zoomLB;$('#lbimg').onclick=zoomLB;
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&$('.modal.open')){closeModal();return}
  if(!$('#lb').classList.contains('open'))return;if(e.key==='Escape')closeLB();if(e.key==='ArrowLeft')stepLB(-1);if(e.key==='ArrowRight')stepLB(1)});

/* ---------------- modals ---------------- */
function openModal(html,cls=''){$('#modal').innerHTML=`<div class="mbox ${cls}" role="document">${html}</div>`;$('#modal').classList.add('open');document.body.style.overflow='hidden';setTimeout(()=>$('#modal input,#modal button.primary,#modal button.danger')?.focus(),30)}
function closeModal(){$('#modal').classList.remove('open');$('#modal').innerHTML='';document.body.style.overflow=''}
$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal()});

function settingsModal(next,why){
  const c=GH.cfg();
  const pagesUrl=`https://${c.owner||'alexanderliao1010'}.github.io/${c.repo||'yansen-dashboard'}/`;
  openModal(`<h3>GitHub 連線</h3>${!ON_PAGES?`<p class="lead" style="color:var(--red);font-weight:500">這是預覽頁，不能連線 GitHub。請到網站版操作：<a href="${pagesUrl}" target="_blank" rel="noopener">${pagesUrl}</a></p>`:''}${why?`<p class="lead" style="color:var(--amber);font-weight:500">${esc(why)}</p>`:''}<p class="lead">新增、編輯、刪除會直接寫回 GitHub 儲存庫。金鑰只存在這台裝置的瀏覽器裡，換裝置或換瀏覽器要重新輸入一次。</p>
  <form id="ghf"><div class="fgrid">
    <label>帳號<input name="owner" value="${esc(c.owner||'')}" required autocomplete="off"></label>
    <label>儲存庫<input name="repo" value="${esc(c.repo||'yansen-dashboard')}" required autocomplete="off"></label>
    <label class="full">存取金鑰（Fine-grained token）<input name="token" type="password" value="${esc(c.token||'')}" placeholder="github_pat_…" autocomplete="off">
      <small>到 GitHub → Settings → Developer settings → Fine-grained tokens 建立，只勾選這個儲存庫，權限 Contents 設為 Read and write。</small></label>
  </div><div class="mfoot"><span class="msg" id="ghmsg"></span>${c.token?'<button type="button" class="btn danger" id="ghclear">移除金鑰</button>':''}<button type="button" class="btn" data-close>取消</button><button class="btn primary">測試並儲存</button></div></form>`,'sm');
  $('[data-close]').onclick=closeModal;
  $('#ghclear')&&($('#ghclear').onclick=()=>{const n=GH.cfg();delete n.token;store('ys-gh',JSON.stringify(n));closeModal();route()});
  $('#ghf').onsubmit=async e=>{
    e.preventDefault();const fd=new FormData(e.target);
    const n={owner:fd.get('owner').trim(),repo:fd.get('repo').trim(),token:fd.get('token').trim(),branch:'main'};
    const old=store('ys-gh');store('ys-gh',JSON.stringify(n));
    $('#ghmsg').className='msg';$('#ghmsg').textContent='測試中…';
    try{const r=await GH.api('');if(!r.permissions?.push)throw new Error('這組金鑰沒有寫入權限');n.branch=r.default_branch||'main';store('ys-gh',JSON.stringify(n));closeModal();
      try{PROJECTS=await GH.latestProjects()}catch(e){}
      route();if(typeof next==='function')next()}
    catch(err){old===null?store('ys-gh',null):store('ys-gh',old);$('#ghmsg').className='msg err';$('#ghmsg').textContent='連線失敗：'+err.message}
  };
}

function formModal(p){
  const isNew=!p; p=p||{dayType:'cal'};
  const v=k=>esc(p[k]??'');
  const blank=k=>(p[k]==='待確認'||p[k]==='待補')?'':v(k);
  openModal(`<h3>${isNew?'新增工程':'編輯工程'}</h3><p class="lead">${isNew?'先選決標公告和工程契約，系統會自動讀出欄位；讀不到的再手動補。':'選新的文件會自動比對欄位；檔案欄位留空就保留原本的檔案。'}</p>
  <form id="pf"><div class="fgrid">
    <div class="fsec" style="margin-top:0;padding-top:0;border-top:none">文件${isNew?'':'（留空保留原檔）'}</div>
    <label>決標公告<input name="f_award" type="file" accept=".pdf"><small>自動帶入：機關、案號、金額、決標日、窗口、技術服務廠商</small></label>
    <label>工程契約<input name="f_contract" type="file" accept=".pdf,.txt,.md"><small>自動帶入：工期、天數計算、開工規定、契約份數</small></label>
    <label>圖說<input name="f_draw" type="file" accept=".pdf"></label>
    <label>標單（預算）<input name="f_budget" type="file" accept=".xlsx,.xls"><small>自動產生預算明細</small></label>
    <div class="full autobox" id="autobox" hidden></div>
    <div class="fsec">基本資料</div>
    <label class="full"><span>工程名稱 <b>*</b></span><input name="name" value="${v('name')}" required></label>
    <label>簡稱<input name="short" value="${v('short')}" placeholder="例如：大溪桌球場"></label>
    <label><span>機關 <b>*</b></span><input name="agency" value="${v('agency')}" required></label>
    <label>案號<input name="caseNo" value="${v('caseNo')}"></label>
    <label>決標日<input name="awardDate" type="date" value="${v('awardDate')}"></label>
    <label>開工日<input name="start" type="date" value="${v('start')}"><small>依機關開工通知填寫</small></label>
    <label><span>施工天數 <b>*</b></span><input name="days" type="number" min="1" value="${v('days')}" required></label>
    <label>天數計算<select name="dayType"><option value="cal" ${p.dayType!=='work'?'selected':''}>日曆天</option><option value="work" ${p.dayType==='work'?'selected':''}>工作天</option></select></label>
    <label class="full">開工規定<input name="startRule" value="${v('startRule')}" placeholder="例如：機關通知日起 10 日內開工"></label>
    <div class="fsec">金額</div>
    <label>決標金額（元）<input name="amount" type="number" min="0" value="${v('amount')}"></label>
    <label>預算金額（元）<input name="budget" type="number" min="0" value="${v('budget')}"></label>
    <label>底價（元）<input name="floor" type="number" min="0" value="${v('floor')}"><small>有決標金額和底價會自動算標比</small></label>
    <label>是否受補助<input name="subsidy" value="${blank('subsidy')}"></label>
    <div class="fsec">聯絡</div>
    <label>監造單位<input name="supervisor" value="${blank('supervisor')}"></label>
    <label>業主窗口<input name="contact" value="${blank('contact')}"></label>
    <label>窗口電話<input name="phone" value="${v('phone')}"></label>
    <label>窗口 Email<input name="email" type="email" value="${v('email')}"></label>
    <label class="full">施工進度網址<input name="progressUrl" type="url" value="${v('progressUrl')}" placeholder="https://…"><small>總覽的「施工進度」按鈕會開這個網址</small></label>
    <div class="fsec">標案資料</div>
    <label>決標公告日<input name="announce" type="date" value="${v('announce')}"></label>
    <label>開標日<input name="bidOpen" type="date" value="${v('bidOpen')}"></label>
    <label>招標／決標方式<input name="method" value="${blank('method')}"></label>
    <label>預估履約期間<input name="estPeriod" value="${blank('estPeriod')}"></label>
    <label>契約份數<input name="copies" value="${v('copies')}"></label>
  </div><div class="mfoot"><span class="msg" id="pmsg"></span><button type="button" class="btn" data-close>取消</button><button class="btn primary" id="psave">${isNew?'新增':'儲存'}</button></div></form>`);
  $('[data-close]').onclick=closeModal;
  const form=$('#pf'), box=$('#autobox');
  const extra={}; let contractText=null, budgetItems=null;
  const report={};   // 來源 → {n, ocr, conflicts:[], note}
  const same=(a,b)=>String(a??'').replace(/[\s,，]/g,'')===String(b??'').replace(/[\s,，]/g,'');
  const LABEL={name:'工程名稱',agency:'機關',caseNo:'案號',awardDate:'決標日',days:'施工天數',dayType:'天數計算',startRule:'開工規定',amount:'決標金額',budget:'預算金額',floor:'底價',subsidy:'是否受補助',supervisor:'監造單位',contact:'業主窗口',phone:'窗口電話',email:'窗口 Email',announce:'決標公告日',bidOpen:'開標日',method:'招標／決標方式',estPeriod:'預估履約期間',copies:'契約份數'};
  function apply(fields,srcName,rank){
    const r=report[srcName]={...(report[srcName]||{}),filled:[],conflicts:[]};
    for(const [k,val] of Object.entries(fields)){
      if(val===undefined||val===null||val==='')continue;
      const el=form.elements[k];
      if(!el){extra[k]=val;continue}
      const cur=el.value, autoRank=+(el.dataset.rank||0);
      if(!cur||(el.classList.contains('auto')&&autoRank<rank)){
        el.value=val;el.classList.add('auto');el.dataset.rank=rank;el.dataset.src=srcName;r.filled.push(k);
      }else if(!same(cur,val)&&!(el.classList.contains('auto')&&el.dataset.src===srcName)){
        r.conflicts.push({k,val});
      }
    }
    if(fields.supNote)extra.supNote=fields.supNote;
    if(fields.amount)extra._amt=fields.amount;
    renderBox();
  }
  function renderBox(){
    const parts=Object.entries(report).map(([name,r])=>{
      if(r.busy)return `<div class="ab-row"><b>${esc(name)}</b>：${esc(r.busy)}</div>`;
      if(r.error)return `<div class="ab-row err"><b>${esc(name)}</b>：${esc(r.error)}</div>`;
      const conf=(r.conflicts||[]).map(c=>`<li>${LABEL[c.k]||c.k}：表單是「${esc(form.elements[c.k].value)}」，文件是「${esc(c.k==='dayType'?(c.val==='work'?'工作天':'日曆天'):c.val)}」 <button type="button" class="linkbtn" data-use="${c.k}" data-val="${esc(c.val)}">改用文件的值</button></li>`).join('');
      if(r.info)return `<div class="ab-row"><b>${esc(name)}</b>：${esc(r.note||'')}</div>`;
      return `<div class="ab-row"><b>${esc(name)}</b>：${r.filled?.length?`帶入 ${r.filled.length} 個欄位（${r.filled.map(k=>LABEL[k]||k).join('、')}）`:'沒有新的欄位可帶入'}${r.ocr?'。這是掃描檔，用文字辨識讀出，<b>請逐一核對黃色欄位</b>':'，請核對黃色欄位'}${r.note?'。'+esc(r.note):''}${conf?`<ul>${conf}</ul>`:''}</div>`;
    });
    box.hidden=!parts.length;box.innerHTML=parts.join('');
    box.querySelectorAll('[data-use]').forEach(b=>b.onclick=()=>{const el=form.elements[b.dataset.use];el.value=b.dataset.val;el.classList.add('auto');
      Object.values(report).forEach(r=>r.conflicts=(r.conflicts||[]).filter(c=>c.k!==b.dataset.use));renderBox()});
  }
  form.addEventListener('input',e=>{if(e.target.classList.contains('auto')&&e.isTrusted){e.target.classList.remove('auto');e.target.dataset.rank=9}});
  const busy=(name,t)=>{report[name]={...(report[name]||{}),busy:t,error:null};renderBox()};
  form.elements.f_award.addEventListener('change',async e=>{
    const f=e.target.files[0];if(!f)return;const N='決標公告';
    try{busy(N,'讀取中…');const r=await Extract.award(f,t=>busy(N,t));report[N]={ocr:r.ocr};
      if(r.fields.winner&&!/硯森/.test(r.fields.winner))report[N].note=`得標廠商是「${r.fields.winner}」，請確認檔案是否正確`;
      if(!Object.keys(r.fields).length)report[N].note='沒有讀到決標公告的欄位，請確認是政府電子採購網的決標公告';
      apply(r.fields,N,2);
    }catch(err){report[N]={error:'讀取失敗：'+err.message};renderBox()}
  });
  form.elements.f_contract.addEventListener('change',async e=>{
    const f=e.target.files[0];if(!f)return;const N='工程契約';
    try{busy(N,'讀取中…');const r=await Extract.contract(f,t=>busy(N,t));report[N]={ocr:false,note:r.note};contractText=r.text||null;
      if(contractText)report[N].note=(report[N].note?report[N].note+'。':'')+'契約全文會一併存成可搜尋的文字';
      apply(r.fields,N,1);
    }catch(err){report[N]={error:'讀取失敗：'+err.message};renderBox()}
  });
  form.elements.f_budget.addEventListener('change',async e=>{
    const f=e.target.files[0];if(!f)return;const N='標單';
    try{busy(N,'讀取中…');budgetItems=await parseXlsx(f);
      const tot=budgetItems.filter(x=>x.lvl===-1&&/總價|合計/.test(x.name)).map(x=>x.amt).pop();
      report[N]={info:true,note:`讀到 ${budgetItems.filter(x=>x.lvl===2).length} 個工項${tot?`，合計 ${fmt(tot)} 元`:''}`};renderBox();
    }catch(err){budgetItems=null;report[N]={error:'讀取失敗：'+err.message};renderBox()}
  });

  form.onsubmit=async e=>{
    e.preventDefault();const fd=new FormData(form);const msg=$('#pmsg');
    if(Object.values(report).some(r=>r.busy)){msg.className='msg err';msg.textContent='文件還在讀取中，請稍候';return}
    const id=p.id||('p'+Date.now().toString(36));
    const num=k=>{const x=String(fd.get(k)||'').trim();return x?Number(x):null};
    const str=k=>String(fd.get(k)||'').trim();
    const upd={name:str('name'),short:str('short'),agency:str('agency'),caseNo:str('caseNo'),
      awardDate:str('awardDate'),start:str('start'),days:num('days'),dayType:str('dayType'),startRule:str('startRule'),
      amount:num('amount'),budget:num('budget'),floor:num('floor'),subsidy:str('subsidy'),supervisor:str('supervisor'),contact:str('contact'),
      phone:str('phone'),email:str('email'),announce:str('announce'),bidOpen:str('bidOpen'),method:str('method'),estPeriod:str('estPeriod'),copies:str('copies'),progressUrl:str('progressUrl')};
    upd.ratio=upd.amount&&upd.floor?(upd.amount/upd.floor*100).toFixed(2)+'%':'';
    upd.tel=upd.phone?upd.phone.split('#')[0].replace(/[^\d]/g,''):'';
    if(extra.amountCN&&upd.amount===extra._amt)upd.amountCN=extra.amountCN;else if(upd.amount!==p.amount)upd.amountCN='';
    if(extra.supNote&&form.elements.supervisor.classList.contains('auto'))upd.supNote=extra.supNote;
    $('#psave').disabled=true;msg.className='msg';msg.textContent='處理中…';
    try{
      const files=[], docs={...(p.docs||{})};
      const put=async(file,path)=>{files.push({path,b64:await b64file(file),blobUrl:URL.createObjectURL(file)});return path};
      const putText=(t,path,type='text/plain')=>{files.push({path,b64:b64text(t),blobUrl:URL.createObjectURL(new Blob([t],{type}))});return path};
      const fc=fd.get('f_contract'),fdr=fd.get('f_draw'),fa=fd.get('f_award'),fb=fd.get('f_budget');
      const ext=f=>(f.name.split('.').pop()||'').toLowerCase();
      if(fc&&fc.size){
        if(ext(fc)==='pdf'){docs.contract={pdf:await put(fc,`data/${id}/contract.pdf`)};if(contractText)docs.contract.text=putText(contractText,`data/${id}/contract.txt`)}
        else docs.contract={text:putText(await fc.text(),`data/${id}/contract.txt`)};
        delete TXT[id];
      }
      if(fdr&&fdr.size)docs.draw={pdf:await put(fdr,`data/${id}/drawings.pdf`)};
      if(fa&&fa.size)docs.award={pdf:await put(fa,`data/${id}/award.pdf`)};
      if(fb&&fb.size){
        const items=budgetItems||await parseXlsx(fb);
        const bj={title:'標單詳細表',source:fb.name,total:items.filter(x=>x.lvl===-1&&/總價|合計/.test(x.name)).map(x=>x.amt).pop()||null,items};
        docs.budget={json:putText(JSON.stringify(bj),`data/${id}/budget.json`,'application/json'),file:await put(fb,`data/${id}/budget.${ext(fb)}`)};delete BUD[id];
      }
      upd.docs=docs;
      await persist(arr=>isNew?[...arr,{id,...upd}]:arr.map(x=>x.id===id?{...x,...upd}:x),files,`${isNew?'新增':'更新'}工程：${upd.short||upd.name}`,s=>msg.textContent=s);
      closeModal();location.hash=isNew?`#/${id}/contract`:location.hash;route();
    }catch(err){msg.className='msg err';msg.textContent='沒有存成功：'+err.message;$('#psave').disabled=false}
  };
}

/* 施工進度：有網址就是連結；還沒有就先請執行者輸入，存檔後固定 */
const isUrl=u=>/^https?:\/\/\S+\.\S+/i.test(String(u||'').trim());
function progBtn(p,cls=''){
  return isUrl(p.progressUrl)
    ?`<a class="${cls} prog" href="${esc(p.progressUrl)}" target="_blank" rel="noopener" title="開啟施工進度網頁">施工進度 ↗</a>`
    :`<button type="button" class="${cls} prog unset" data-act="prog" data-id="${p.id}" title="還沒設定施工進度網頁">＋ 施工進度</button>`;
}
function progModal(p){
  openModal(`<h3>設定施工進度網頁</h3><p class="lead">${esc(p.short||p.name)} 還沒有施工進度網頁。貼上網址後會存起來，之後按「施工進度」就會直接打開這個網頁。</p>
  <form id="prf"><div class="fgrid"><label class="full">施工進度網址<input name="url" id="prurl" type="url" required placeholder="https://…" autocomplete="off"><small>例如進度表的 Google 試算表連結，或施工日誌網頁。之後要改，請到這件工程的「編輯」。</small></label></div>
  <div class="mfoot"><span class="msg" id="prmsg"></span><button type="button" class="btn" data-close>取消</button><button class="btn primary" id="prok">儲存並開啟</button></div></form>`,'sm');
  $('[data-close]').onclick=closeModal;
  $('#prf').onsubmit=async e=>{
    e.preventDefault();const u=$('#prurl').value.trim(),msg=$('#prmsg');
    if(!isUrl(u)){msg.className='msg err';msg.textContent='網址要以 http:// 或 https:// 開頭';return}
    const w=window.open('about:blank','_blank');
    $('#prok').disabled=true;msg.className='msg';msg.textContent='儲存中…';
    try{
      await persist(arr=>arr.map(x=>x.id===p.id?{...x,progressUrl:u}:x),[],`設定施工進度網址：${p.short||p.name}`,t=>msg.textContent=t);
      if(w)w.location.href=u;closeModal();route();
    }catch(err){if(w)w.close();msg.className='msg err';msg.textContent='沒有存成功：'+err.message;$('#prok').disabled=false}
  };
}

function deleteModal(p){
  openModal(`<h3>確定刪除這件工程？</h3><p class="lead">刪除後總覽頁不會再顯示，這件工程的契約、圖說、標單等檔案也會一起從儲存庫刪除。</p>
  <div class="dellist"><b>${esc(p.name)}</b><br>${esc(p.agency)}${p.amount?`｜決標金額 ${fmt(p.amount)} 元`:''}</div>
  <p class="lead" style="margin-bottom:0">${GH.ready()?'GitHub 上的提交紀錄還保留舊版本，真的需要時可以從紀錄復原。':'目前是預覽模式，重新整理後會還原。'}</p>
  <div class="mfoot"><span class="msg" id="dmsg"></span><button class="btn" data-close>取消</button><button class="btn danger solid" id="dok">確定刪除</button></div>`,'sm');
  $('[data-close]').onclick=closeModal;
  $('#dok').onclick=async()=>{
    $('#dok').disabled=true;const msg=$('#dmsg');msg.className='msg';msg.textContent='刪除中…';
    try{
      const del=GH.ready()?await GH.listUnder(`data/${p.id}/`):[];
      await persist(arr=>arr.filter(x=>x.id!==p.id),[{del}],`刪除工程：${p.short||p.name}`,s=>msg.textContent=s);
      closeModal();location.hash='';route();
    }catch(err){msg.className='msg err';msg.textContent='沒有刪除成功：'+err.message;$('#dok').disabled=false}
  };
}

/* 標單 Excel → 預算明細（找「詳細」工作表，欄位：項次、項目及說明、單位、數量、單價、複價、編碼） */
async function parseXlsx(file){
  if(!window.XLSX)throw new Error('Excel 讀取元件尚未載入，請稍後再試');
  const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});
  const name=wb.SheetNames.find(n=>n.includes('詳細'))||wb.SheetNames[0];
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:true,defval:null});
  let h=rows.findIndex(r=>r&&r.some(c=>String(c||'').replace(/\s/g,'').includes('複價')));
  if(h<0)throw new Error('標單裡找不到「複價」欄');
  const hd=rows[h].map(c=>String(c||'').replace(/\s/g,''));
  const col=k=>hd.findIndex(c=>c.includes(k));
  const C={no:Math.max(0,col('項次')),name:col('項目')>=0?col('項目'):1,unit:col('單位'),qty:col('數量'),price:col('單價'),amt:col('複價'),note:col('編碼')};
  const items=[];const num=x=>typeof x==='number'?x:(x&&!isNaN(+String(x).replace(/,/g,''))?+String(x).replace(/,/g,''):null);
  for(const r of rows.slice(h+1)){
    if(!r)continue;
    const no=String(r[C.no]??'').trim(), desc=String(r[C.name]??'').trim();
    if(!no&&!desc)continue;
    if(!no&&/^(小計|合計|總價)/.test(desc)){items.push({no:'',name:desc,lvl:-1,amt:Math.round(num(r[C.amt])||0)});continue}
    if(!no){const l=items[items.length-1];if(l&&l.lvl>=0){l.name+=desc;if(C.note>=0&&r[C.note])l.note=(l.note||'')+r[C.note]}continue}
    const lvl=/^[壹貳參肆伍陸柒捌玖拾]+$/.test(no)?0:/^[一二三四五六七八九十]+$/.test(no)?1:2;
    const it={no,name:desc,lvl};
    if(C.unit>=0&&r[C.unit])it.unit=String(r[C.unit]);
    const q=num(r[C.qty]),pr=num(r[C.price]),a=num(r[C.amt]);
    if(q!=null)it.qty=q;if(pr!=null)it.price=Math.round(pr*100)/100;if(a)it.amt=Math.round(a);
    if(C.note>=0&&r[C.note])it.note=String(r[C.note]).replace(/[#*]/g,'');
    items.push(it);
  }
  if(!items.length)throw new Error('標單沒有讀到任何工項');
  return items;
}

document.addEventListener('click',e=>{
  const b=e.target.closest('[data-act]');if(!b)return;
  const a=b.dataset.act,p=PROJECTS.find(x=>x.id===b.dataset.id);
  if(a==='add')needConn(()=>formModal());else if(a==='edit'&&p)needConn(()=>formModal(p));else if(a==='del'&&p)needConn(()=>deleteModal(p));else if(a==='settings')settingsModal();else if(a==='prog'&&p)needConn(()=>progModal(p));
});

function route(){
  if(!READY)return;
  const h=location.hash.replace(/^#\/?/,'').split('/').filter(Boolean);
  if(!h.length)renderHome();else renderDetail(h[0],['drawings','budget'].includes(h[1])?h[1]:'contract',h[2]);
}
window.addEventListener('hashchange',()=>{closeLB();route();window.scrollTo(0,0)});

(async function init(){
  try{
    const [pj,hj]=await Promise.all([fetch(nocache('data/projects.json'),{cache:'no-store'}).then(r=>r.json()),fetch(nocache('data/holidays.json')).then(r=>r.json()).catch(()=>({dates:[]}))]);
    PROJECTS=pj;HOLIDAYS=new Set(hj.dates||[]);
    if(GH.ready()){try{PROJECTS=await GH.latestProjects()}catch(e){console.warn('GitHub 讀取失敗，改用網站上的資料',e)}}
    READY=true;route();
  }catch(e){$('#app').innerHTML='<p class="empty">工程資料讀取失敗，請重新整理頁面。</p>'}
})();
