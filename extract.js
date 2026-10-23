/* 從上傳的決標公告／工程契約自動讀出欄位。
   文字型 PDF 直接讀文字；掃描或「列印成 PDF」的圖片檔改用文字辨識（OCR）。 */
const EX={
  PDFJS:'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  PDFJS_WORKER:'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  CMAPS:'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
  TESS:'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  _loaded:{},
  load(src){return this._loaded[src]||(this._loaded[src]=new Promise((ok,no)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>{delete this._loaded[src];no(new Error('元件載入失敗，請檢查網路後再試'))};document.head.appendChild(s)}))},
  async pdf(file){
    await this.load(this.PDFJS);
    if(!this._port){
      pdfjsLib.GlobalWorkerOptions.workerSrc=this.PDFJS_WORKER;
      try{this._port=new Worker(URL.createObjectURL(new Blob([`importScripts('${this.PDFJS_WORKER}')`],{type:'text/javascript'})));pdfjsLib.GlobalWorkerOptions.workerPort=this._port}catch(e){this._port='fake'}
    }
    return pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer()),cMapUrl:this.CMAPS,cMapPacked:true}).promise;
  }
};

const cjk='\\u3400-\\u9fff\\uf900-\\ufaff\\u3000-\\u303f\\uff00-\\uffef';
const RAD={'⺠':'民','⻑':'長','⻄':'西','⻘':'青','⻝':'食','⻩':'黃','⻤':'鬼','⺟':'母','⻆':'角','⻌':'辶','⺮':'竹','⺶':'羊','⻊':'足','⻏':'阝','⻖':'阝'};
const norm=s=>String(s||'').normalize('NFKC').replace(/[\u2e80-\u2eff]/g,c=>RAD[c]||c);
const tidy=s=>norm(s).replace(/　/g,' ').replace(new RegExp(`([${cjk}])\\s+(?=[${cjk}])`,'g'),'$1').replace(/\s+/g,' ').trim();
const rocIso=s=>{const m=String(s||'').match(/(\d{2,3})\s*[\/.\-年]\s*(\d{1,2})\s*[\/.\-月]\s*(\d{1,2})/);if(!m)return'';const y=+m[1]+1911;return `${y}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`};
const money=s=>{const m=String(s||'').replace(/\s/g,'').match(/([\d,]{3,})元/);return m?Number(m[1].replace(/,/g,'')):null};

/* 文字型 PDF → 每頁的列；同一列中距離大的文字切成不同欄 */
async function pdfRows(doc,maxPages){
  const rows=[];
  for(let p=1;p<=Math.min(doc.numPages,maxPages);p++){
    const pg=await doc.getPage(p),tc=await pg.getTextContent();
    const items=tc.items.filter(i=>i.str&&i.str.trim()).map(i=>({x:i.transform[4],y:i.transform[5],w:i.width,t:i.str}));
    items.sort((a,b)=>b.y-a.y||a.x-b.x);
    let cur=null;
    for(const it of items){
      if(!cur||Math.abs(cur.y-it.y)>3){cur={y:it.y,page:p,items:[]};rows.push(cur)}
      cur.items.push(it);
    }
  }
  return rows.map(r=>{
    r.items.sort((a,b)=>a.x-b.x);
    const cells=[];let last=null;
    for(const it of r.items){
      if(last&&it.x-(last.x+last.w)<8){last.t+=it.t;last.w=it.x+it.w-last.x}
      else{last={x:it.x,w:it.w,t:it.t};cells.push(last)}
    }
    return {page:r.page,cells:cells.map(c=>({x:c.x,t:tidy(c.t)})).filter(c=>c.t)};
  }).filter(r=>r.cells.length);
}
async function hasText(doc){const pg=await doc.getPage(1);const tc=await pg.getTextContent();return tc.items.filter(i=>i.str.trim()).length>20}

/* 圖片型 PDF → OCR，每一行當作一欄 */
async function ocrRows(doc,maxPages,onStep){
  await EX.load(EX.TESS);
  const worker=await Tesseract.createWorker('chi_tra');
  await worker.setParameters({preserve_interword_spaces:'1'});
  const rows=[];
  try{
    for(let p=1;p<=Math.min(doc.numPages,maxPages);p++){
      onStep&&onStep(`辨識文字中：第 ${p}／${Math.min(doc.numPages,maxPages)} 頁（掃描檔需要較久）`);
      const pg=await doc.getPage(p),vp=pg.getViewport({scale:2.6});
      const cv=document.createElement('canvas');cv.width=vp.width;cv.height=vp.height;
      const cx=cv.getContext('2d');
      await pg.render({canvasContext:cx,viewport:vp}).promise;
      // 去掉表格底色與色框：轉灰階後二值化，讓文字辨識更準
      const im=cx.getImageData(0,0,cv.width,cv.height),d=im.data;
      for(let k=0;k<d.length;k+=4){const l=0.299*d[k]+0.587*d[k+1]+0.114*d[k+2];const sat=Math.max(d[k],d[k+1],d[k+2])-Math.min(d[k],d[k+1],d[k+2]);const v=(l<150&&sat<90)?0:255;d[k]=d[k+1]=d[k+2]=v}
      cx.putImageData(im,0,0);
      const {data}=await worker.recognize(cv);
      for(const ln of data.lines||[]){const t=tidy(ln.text);if(t)rows.push({page:p,ocr:true,cells:[{x:ln.bbox.x0,t}]})}
    }
  }finally{await worker.terminate()}
  return rows;
}

async function readRows(file,maxPages,onStep){
  onStep&&onStep('讀取 PDF…');
  const doc=await EX.pdf(file);
  if(await hasText(doc))return {rows:await pdfRows(doc,maxPages),ocr:false,doc};
  return {rows:await ocrRows(doc,maxPages,onStep),ocr:true,doc};
}

/* 依「標籤」找值：標籤可以是獨立一欄（文字型），或在行首（OCR） */
function finder(rows){
  return function find(labels,ok=v=>!!v,{from=0}={}){
    for(let i=from;i<rows.length;i++){
      const cs=rows[i].cells;
      for(let j=0;j<cs.length;j++){
        let t=cs[j].t;
        for(const lb of labels){
          let v=null;
          if(t===lb||(t.length===lb.length+1&&t.endsWith(lb))) v=cs.slice(j+1).map(c=>c.t).join(' ');
          else if(rows[i].ocr&&(t.startsWith(lb)||t.slice(1).startsWith(lb))&&(t=t.startsWith(lb)?t:t.slice(1))&&!/^是否/.test(t.slice(lb.length).trim())) v=t.slice(lb.length).replace(/^[\s:：|]+/,'');
          if(v===null)continue;
          if(!v&&rows[i+1]&&!rows[i].ocr) v=rows[i+1].cells.filter(c=>c.x>cs[j].x+20).map(c=>c.t).join(' ');
          v=tidy(v);
          if(ok(v))return {v,i};
        }
      }
    }
    return null;
  };
}

/* ---------- 決標公告 ---------- */
async function extractAward(file,onStep){
  const {rows,ocr}=await readRows(file,10,onStep);
  const find=finder(rows), all=rows.map(r=>r.cells.map(c=>c.t).join(' ')).join('\n');
  const out={}, src={};
  const set=(k,v,label)=>{if(v!==null&&v!==undefined&&v!==''){out[k]=v;src[k]=label}};
  const g=(labels,ok)=>find(labels,ok)?.v;
  set('agency',g(['機關名稱']),'機關名稱');
  set('contact',g(['聯絡人'],v=>v.length>=2&&v.length<30&&!/電話/.test(v)),'聯絡人');
  const ph=g(['聯絡電話'],v=>/\d{3,}/.test(v)); if(ph){set('phone',ph,'聯絡電話');out.tel=ph.split('#')[0].replace(/[^\d]/g,'')}
  set('email',((g(['電子郵件信箱','電子郵件'],v=>/@/.test(v))||'').match(/[\w.+-]+@[\w.-]+/)?.[0]||'').replace(/(gov|com|edu|org|net)tw$/i,'$1.tw').replace(/\.$/,''),'電子郵件信箱');
  set('caseNo',(g(['標案案號'],v=>/\w{3,}/.test(v))||'').split(' ')[0],'標案案號');
  set('name',g(['標案名稱'],v=>v.length>=4),'標案名稱');
  const m1=g(['招標方式']),m2=g(['決標方式'],v=>/標|價/.test(v));
  if(m1||m2)set('method',[m1,m2&&m2.replace(/\s*採購評選.*$/,'')].filter(Boolean).join('／'),'招標方式、決標方式');
  set('bidOpen',rocIso(g(['開標時間'],v=>!!rocIso(v))),'開標時間');
  set('budget',money(g(['預算金額'],v=>!!money(v))),'預算金額');
  set('floor',money(g(['底價金額'],v=>!!money(v))),'底價金額');
  set('amount',money(g(['總決標金額'],v=>!!money(v))||g(['決標金額'],v=>!!money(v))),'總決標金額');
  const ta=find(['總決標金額'],v=>!!money(v));
  if(ta){const near=[ta.v,...(rows[ta.i+1]?.cells||[]).map(c=>c.t),...(rows[ta.i+2]?.cells||[]).map(c=>c.t)].join('');const cn=near.match(/[零壹貳參肆伍陸柒捌玖拾佰仟萬億]{2,}元/);if(cn&&!rows[ta.i].ocr)set('amountCN',cn[0],'總決標金額')}
  set('awardDate',rocIso(g(['決標日期'],v=>!!rocIso(v))),'決標日期');
  const an=all.match(/公告日\s*[:：]\s*(\d{2,3}\s*\/\s*\d{1,2}\s*\/\s*\d{1,2})/)||[null,g(['決標公告日期'],v=>!!rocIso(v))];
  set('announce',rocIso(an[1]),'公告日');
  const per=g(['履約起迄日期'],v=>/\d{2,3}\/\d/.test(v));
  if(per)set('estPeriod',per.replace(/\s*[－\-~～]\s*/,'～').replace(/\s*\((預估)\)/,'（$1）'),'履約起迄日期');
  const sub=find(['是否受機關補助'],v=>/^[是否]/.test(v));
  if(sub){
    if(sub.v.startsWith('否'))set('subsidy','否','是否受機關補助');
    else{
      const list=[];
      for(let i=sub.i+1;i<Math.min(rows.length,sub.i+12);i++){
        const line=rows[i].cells.map(c=>c.t).join(' ');
        const m=line.match(/([一-鿿]{3,}?(?:局|處|署|部|府|會|所|館|院))\s*([\d,]{4,})元/);
        if(m)list.push(`${m[1]} ${Number(m[2].replace(/,/g,'')).toLocaleString('zh-TW')} 元`);
        if(/履約地點/.test(line))break;
      }
      set('subsidy',list.length?'是：'+list.join('、'):'是','是否受機關補助');
    }
  }
  // 技術服務（規劃、設計、監造）廠商
  const ts=rows.findIndex(r=>r.cells.some(c=>/提供技術服務之廠商名稱/.test(c.t)));
  if(ts>=0){
    let v=rows[ts].cells.map(c=>c.t).join(' ').replace(/^.*提供技術服務之廠商名稱\s*[:：]?\s*/,'');
    if(!/(公司|事務所|社|中心)$/.test(v)&&rows[ts+1])v+=rows[ts+1].cells.map(c=>c.t).join('').replace(/\s+/g,'');
    v=(v.match(/^.*?(公司|事務所|社|中心)/)||[v])[0].replace(/\s+/g,'');
    const win3=rows.slice(Math.max(0,ts-4),ts+4).map(r=>r.cells.map(c=>c.t).join(' ')).join(' ');
    if(v.length>=4){set('supervisor',v,'技術服務廠商');out.supNote=/監造/.test(win3)?'決標公告所列技術服務（含監造）':'決標公告所列技術服務廠商，請確認是否負責監造'}
  }
  const win=g(['廠商名稱'],v=>/公司|行|社/.test(v)); if(win)out.winner=win;
  if(out.amount&&out.floor){out.ratio=(out.amount/out.floor*100).toFixed(2)+'%';src.ratio='決標金額÷底價'}
  return {fields:out,src,ocr,pages:rows.length?Math.max(...rows.map(r=>r.page)):0};
}

/* ---------- 工程契約 ---------- */
function reflow(lines){
  const out=[];const start=/^(第\s*\d+\s*條|附錄|\(\S{1,3}\)|（\S{1,3}）|\d+(\.\d+)*[\.\s、]|[a-e]\.|[■□]|[一二三四五六七八九十]+、)/;
  for(let l of lines){
    l=l.trim();if(!l)continue;
    if(/^第\s*\d+\s*頁/.test(l)||/^-\s*\d+\s*-$/.test(l)||/^\d+$/.test(l))continue;
    if(!out.length||start.test(l))out.push(l);else out[out.length-1]+=l;
  }
  return out.join('\n');
}
async function extractContractPdf(file,onStep){
  if(!/\.pdf$/i.test(file.name)){const t=await file.text();const r=parseContract(t);return {...r,text:t,ocr:false}}
  onStep&&onStep('讀取契約…');
  const doc=await EX.pdf(file);
  if(!(await hasText(doc)))return {fields:{},text:'',src:{},ocr:true,note:'這份契約是掃描檔，無法讀出文字。工期等欄位請手動填寫。'};
  const rows=await pdfRows(doc,doc.numPages);
  const lines=rows.map(r=>r.cells.map(c=>c.t).join(''));
  const text=reflow(lines);
  const {fields,src}=parseContract(text);
  return {fields,src,text,ocr:false};
}
function parseContract(text){
  const flat=String(text).replace(/\s+/g,'').replace(/\*/g,'');
  const out={},src={};
  const m=flat.match(/■應於(.{2,40}?)起(\d+)(日曆天|工作天|日)?內開工[，,]?並於開工之日起(\d+)(日曆天|工作天|日)?內竣工/);
  if(m){
    let base=m[1];const opt=base.match(/[（(]([^）)]*)[）)]/);
    if(opt){const pick=opt[1].match(/■([^□■]+)/);base=pick?pick[1]:base.replace(/[（()）□■]/g,'')}
    out.startRule=`${base}起 ${m[2]} ${m[3]==='日'||!m[3]?'日':m[3]}內開工`;src.startRule='第7條 履約期限';
    out.days=Number(m[4]);src.days='第7條 履約期限';
    if(m[5]==='日曆天')out.dayType='cal';if(m[5]==='工作天')out.dayType='work';
  }
  const dt=flat.match(/以([□■])日曆天([□■])工作天計算/);
  if(dt&&!out.dayType){out.dayType=dt[1]==='■'?'cal':dt[2]==='■'?'work':undefined}
  if(dt||out.dayType)src.dayType='第7條 日數計算';
  const ag=flat.match(/([^（）()]{4,40})[（(]以下簡稱機關[）)]/);
  if(ag){const a=ag[1].replace(/^.*?修正[）)]/,'').replace(/^招標機關/,'');if(a.length>=4){out.agency=a;src.agency='契約首段'}}
  const nm=flat.match(/工程名稱[:：](.{4,80}?)(?:合約編號|契約編號|工程採購契約|$)/);
  if(nm){out.name=nm[1];src.name='工程名稱'}
  else{const n2=flat.match(/採購契約(?:\(稿\)|（稿）)?(.{6,80}?)採購契約/);if(n2){let n=n2[1];if(out.agency&&n.startsWith(out.agency))n=n.slice(out.agency.length);out.name=n;src.name='契約標題'}}
  const cp=flat.match(/契約正本(\d+)份.{0,300}?副本(\d+)份/);
  if(cp){out.copies=`正本 ${cp[1]} 份、副本 ${cp[2]} 份`;src.copies='第1條 契約份數'}
  return {fields:out,src};
}
window.Extract={award:extractAward,contract:extractContractPdf,parseContract,rocIso};
