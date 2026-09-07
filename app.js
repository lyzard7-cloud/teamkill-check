
const $=q=>document.querySelector(q), $$=q=>[...document.querySelectorAll(q)];
const pdfjsLib=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

const STORAGE_KEY="gangil-teamkill-interestlist-v2";
let rows=[], gradeRows=[], currentView="exact", editDraft=[], currentSnapshotLabel="", previousSnapshot=null;
let gradeFilterMode="all", gradeRangeMin=null, gradeRangeMax=null, classFilterMode="all", studentSearchText="", supportTypeMode="all", universitySearchText="", riskFilterMode="all";
let changeMode="new";

function toast(msg){const e=$("#toast");e.textContent=msg;e.classList.remove("hidden");clearTimeout(window.__t);window.__t=setTimeout(()=>e.classList.add("hidden"),2400)}
function norm(v=""){return String(v||"").normalize("NFKC").replace(/\s+/g,"").replace(/[()（）·ㆍ.,\-_/:\[\]]/g,"").toLowerCase()}
function esc(v=""){return String(v??"").replace(/[&<>"']/g,s=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[s]))}
function cleanCell(v=""){return String(v||"").replace(/\s+/g,"").replace(/[\u200b\u00a0]/g,"").trim()}
function schoolNo(r){return `${r.grade||""}${String(r.classNo||"").padStart(2,"0")}${String(r.studentNo||"").padStart(2,"0")}`}
function studentKey(r){return `${r.grade}-${r.classNo}-${r.studentNo}-${norm(r.studentName)}`}

function gradeStudentKey(r){return `${r.grade}-${r.classNo}-${r.studentNo}-${norm(r.studentName)}`}
function gradeMap(){return new Map(gradeRows.map(r=>[gradeStudentKey(r),r]))}
function matchedRows(){const gm=gradeMap();return rows.map(r=>({...r,gradeInfo:gm.get(studentKey(r))||null}))}
function activeRows(){
  const filterCommon=r=>{
    if(classFilterMode!=="all" && String(r.classNo)!==String(classFilterMode)) return false;

    const q=norm(studentSearchText);
    if(q){
      const schoolNo=`${r.grade}${String(r.classNo).padStart(2,"0")}${String(r.studentNo).padStart(2,"0")}`;
      const hay=norm(`${r.studentName} ${schoolNo} ${r.classNo}반 ${r.studentNo}번`);
      if(!hay.includes(q)) return false;
    }

    if(supportTypeMode!=="all" && supportCategory(r)!==supportTypeMode) return false;
    if(!universityMatches(r)) return false;

    return true;
  };

  if(!gradeRows.length){
    return rows.filter(filterCommon);
  }

  return matchedRows().filter(r=>{
    const g=Number(r.gradeInfo?.gradeValue);
    if(!Number.isFinite(g)) return false;

    let gradeOk=true;
    if(gradeRangeMin!=null||gradeRangeMax!=null){
      if(gradeRangeMin!=null&&g<gradeRangeMin) gradeOk=false;
      if(gradeRangeMax!=null&&g>gradeRangeMax) gradeOk=false;
    }else if(gradeFilterMode==="7"){
      gradeOk=g>=7;
    }else if(gradeFilterMode!=="all"){
      const n=Number(gradeFilterMode);
      gradeOk=g>=n&&g<n+1;
    }

    return gradeOk && filterCommon(r);
  });
}
function exactKey(r){return [norm(r.university),norm(r.department),norm(r.admissionType),norm(r.admissionDetail)].join("|")}
function deptKey(r){return [norm(r.university),norm(r.department)].join("|")}

function supportCategory(r){
  const t=norm(`${r.admissionType||""} ${r.admissionDetail||""}`);
  if(t.includes("종합")) return "jonghap";
  if(t.includes("교과")) return "gyogwa";
  return "other";
}
function universityAlias(v=""){
  return norm(v)
    .replace(/대학교/g,"대")
    .replace(/여자대학교/g,"여대")
    .replace(/교육대학교/g,"교대");
}
function universityMatches(r){
  const q=universityAlias(universitySearchText);
  if(!q) return true;
  const u=universityAlias(r.university||"");
  return u.includes(q) || q.includes(u);
}

async function extractItems(file){
  const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
  const pages=[];
  for(let p=1;p<=pdf.numPages;p++){
    $("#progressText").textContent=`${p}/${pdf.numPages}쪽 읽는 중`;
    const page=await pdf.getPage(p), tc=await page.getTextContent();
    const items=tc.items.filter(x=>String(x.str||"").trim()).map(x=>({
      text:String(x.str||"").trim(),x:x.transform[4],y:x.transform[5],w:x.width||0,h:x.height||0
    }));
    pages.push(items);
  }
  return pages;
}
function textAt(items,pattern){
  return items.find(i=>pattern.test(i.text));
}
function headerColumns(items){
  const top=items.filter(i=>i.y>items.reduce((m,x)=>Math.max(m,x.y),0)-130);
  const labels={
    no:/^No$/i, grade:/^학년$/, classNo:/^반$/, studentNo:/^(번호|번\s*호)$/, studentName:/^이름$/,
    university:/^대학명$/, department:/^모집단위$/, admissionType:/^전형유형$/, admissionDetail:/^세부유형$/
  };
  const found={};
  for(const [k,re] of Object.entries(labels)){
    let hit=top.find(i=>re.test(i.text.replace(/\s/g,"")));
    if(hit) found[k]=hit.x+hit.w/2;
  }

  // 이 양식은 모든 페이지의 열 순서가 고정되어 있다.
  // 일부 헤더가 PDF 내부에서 분리된 경우, 찾은 핵심 열 사이의 상대 위치로 보정한다.
  if(found.no!=null && found.university!=null && found.department!=null){
    const step=(found.department-found.university);
    found.grade ??= found.no + step*(-7.0);
  }
  return found;
}
function makeBoundaries(columns){
  const order=[
    ["no",columns.no],["grade",columns.grade],["classNo",columns.classNo],
    ["studentNo",columns.studentNo],["studentName",columns.studentName],
    ["university",columns.university],["department",columns.department],
    ["admissionType",columns.admissionType],["admissionDetail",columns.admissionDetail]
  ].filter(x=>Number.isFinite(x[1])).sort((a,b)=>a[1]-b[1]);

  const bounds={};
  for(let i=0;i<order.length;i++){
    const [name,x]=order[i];
    const left=i===0?x-12:(order[i-1][1]+x)/2;
    const right=i===order.length-1?x+50:(x+order[i+1][1])/2;
    bounds[name]=[left,right];
  }
  return bounds;
}
function cellText(rowItems,bound){
  if(!bound)return "";
  const [l,r]=bound;
  return cleanCell(rowItems.filter(i=>{
    const cx=i.x+i.w/2; return cx>=l&&cx<r;
  }).sort((a,b)=>Math.abs(b.y-a.y)>2?b.y-a.y:a.x-b.x).map(i=>i.text).join(""));
}
function findHeaderX(items, regexes){
  const maxY=Math.max(...items.map(i=>i.y));
  const candidates=items.filter(i=>i.y>maxY-125);
  for(const re of regexes){
    const found=candidates
      .filter(i=>re.test(String(i.text||"").replace(/\s/g,"")))
      .sort((a,b)=>b.y-a.y)[0];
    if(found) return found.x+(found.w||0)/2;
  }
  return null;
}

function parsePage(items,pageNo){
  if(!items.length) return [];

  /*
    v2.2
    고정 비율을 사용하지 않고 PDF 자체의 표 헤더 위치를 매 페이지 읽는다.
    이 보고서는 모든 페이지에 표 헤더가 반복되므로 이 방식이 가장 안정적이다.
  */
  const hx={
    no:findHeaderX(items,[/^No$/i]),
    grade:findHeaderX(items,[/^학년$/]),
    classNo:findHeaderX(items,[/^반$/]),
    studentNo:findHeaderX(items,[/^번$/, /^번호$/]),
    studentName:findHeaderX(items,[/^이름$/]),
    establishment:findHeaderX(items,[/^설립$/, /^설립구분$/]),
    region:findHeaderX(items,[/^지역$/]),
    track:findHeaderX(items,[/^계열$/]),
    university:findHeaderX(items,[/^대학명$/]),
    department:findHeaderX(items,[/^모집단위$/]),
    count:findHeaderX(items,[/^모집인원$/, /^인원$/]),
    reflect:findHeaderX(items,[/^반영요소$/, /^반영$/]),
    minimum:findHeaderX(items,[/^수능최저유무$/, /^수능최저$/, /^최저유무$/]),
    admissionType:findHeaderX(items,[/^전형유형$/]),
    admissionDetail:findHeaderX(items,[/^세부유형$/]),
    selectionType:findHeaderX(items,[/^선발$/, /^선발유형$/])
  };

  const required=["no","grade","classNo","studentName","university","department"];
  if(required.some(k=>!Number.isFinite(hx[k]))) return [];

  // 번호 헤더가 '번/호'로 둘로 갈라지는 페이지는 반과 이름 사이에서 계산한다.
  if(!Number.isFinite(hx.studentNo)){
    hx.studentNo=(hx.classNo+hx.studentName)/2;
  }

  // 열 중심점을 왼쪽부터 정렬하고 인접 열의 중간점을 경계로 사용한다.
  const columns=Object.entries(hx)
    .filter(([,x])=>Number.isFinite(x))
    .sort((a,b)=>a[1]-b[1]);

  const bounds={};
  columns.forEach(([name,x],i)=>{
    const prev=columns[i-1]?.[1];
    const next=columns[i+1]?.[1];
    bounds[name]=[
      Number.isFinite(prev)?(prev+x)/2:x-12,
      Number.isFinite(next)?(x+next)/2:x+24
    ];
  });

  const noColWidth=bounds.no[1]-bounds.no[0];
  const headerY=Math.max(...items
    .filter(i=>Math.abs((i.x+(i.w||0)/2)-hx.no)<Math.max(8,noColWidth))
    .filter(i=>/^No$/i.test(String(i.text||"").trim()))
    .map(i=>i.y));

  // No 열에 위치하고 헤더 아래에 있는 1~20만 실제 데이터 행 번호로 취급한다.
  const markers=items.filter(i=>{
    const t=String(i.text||"").trim();
    const cx=i.x+(i.w||0)/2;
    return /^(?:[1-9]|1\d|20)$/.test(t)
      && cx>=bounds.no[0] && cx<bounds.no[1]
      && i.y<headerY-4;
  }).sort((a,b)=>b.y-a.y);

  if(!markers.length) return [];

  const getCell=(rowItems,name)=>{
    const b=bounds[name];
    if(!b) return "";
    return cleanCell(rowItems
      .filter(it=>{
        const cx=it.x+(it.w||0)/2;
        return cx>=b[0] && cx<b[1];
      })
      .sort((a,b)=>{
        if(Math.abs(b.y-a.y)>1.8) return b.y-a.y;
        return a.x-b.x;
      })
      .map(i=>i.text)
      .join(""));
  };

  function extractRecruitCount(rowItems){
    // 우선 모집인원 헤더의 실제 열 경계만 사용한다.
    let raw=getCell(rowItems,"count");
    let nums=(String(raw||"").match(/\d+/g)||[])
      .map(Number)
      .filter(n=>n>=1 && n<=500);

    // 하나만 읽혔다면 그대로 사용
    if(nums.length===1) return String(nums[0]);

    // 여러 숫자가 섞인 경우(예: '20 학생부 80%')에는
    // 모집단위 바로 오른쪽, 반영요소 바로 왼쪽의 가장 왼쪽 숫자를 사용한다.
    const deptX=hx.department;
    const reflectX=Number.isFinite(hx.reflect)?hx.reflect:
      (Number.isFinite(hx.minimum)?hx.minimum:
       (Number.isFinite(hx.admissionType)?hx.admissionType:null));

    if(Number.isFinite(deptX) && Number.isFinite(reflectX)){
      const candidates=rowItems
        .filter(it=>{
          const cx=it.x+(it.w||0)/2;
          return cx>deptX && cx<reflectX;
        })
        .filter(it=>/^\d{1,3}$/.test(String(it.text||"").trim()))
        .sort((a,b)=>a.x-b.x);

      if(candidates.length){
        const n=Number(candidates[0].text);
        if(n>=1 && n<=500) return String(n);
      }
    }

    // 마지막 안전장치: 여러 숫자가 있으면 가장 작은 값이 아니라
    // 실제 열 안의 첫 번째 값을 사용한다.
    return nums.length?String(nums[0]):"";
  }

  const parsed=[];
  for(let i=0;i<markers.length;i++){
    const y=markers[i].y;
    const upper=i===0 ? headerY-3 : (markers[i-1].y+y)/2;
    const lower=i===markers.length-1 ? y-20 : (y+markers[i+1].y)/2;
    const rowItems=items.filter(it=>it.y<upper && it.y>=lower);

    let grade=getCell(rowItems,"grade");
    let classNo=getCell(rowItems,"classNo");
    let studentNo=getCell(rowItems,"studentNo");
    let studentName=getCell(rowItems,"studentName");

    grade=(grade.match(/[1-3]/)||[])[0]||"";
    classNo=(classNo.match(/[1-9]/)||[])[0]||"";
    studentNo=(studentNo.match(/\d{1,2}/)||[])[0]||"";
    const nm=studentName.match(/[가-힣]{2,5}/);
    studentName=nm?nm[0]:"";

    const r={
      pageNo,
      no:Number(markers[i].text),
      grade,
      classNo,
      studentNo,
      studentName,
      university:getCell(rowItems,"university"),
      department:getCell(rowItems,"department"),
      recruitCount:extractRecruitCount(rowItems),
      admissionType:getCell(rowItems,"admissionType"),
      admissionDetail:getCell(rowItems,"admissionDetail")
    };

    const validIdentity=r.grade==="3"
      && /^[1-9]$/.test(r.classNo)
      && /^\d{1,2}$/.test(r.studentNo)
      && /^[가-힣]{2,5}$/.test(r.studentName);

    if(validIdentity && r.university.length>=2){
      parsed.push(r);
    }
  }
  return parsed;
}


function parseGradePdfPages(pages){
  const out=[];

  for(const items of pages){
    if(!items?.length) continue;

    // PDF.js가 주는 텍스트 조각을 실제 화면의 위→아래, 왼쪽→오른쪽 순서로 재정렬
    const ordered=[...items].sort((a,b)=>{
      const dy=(b.y??0)-(a.y??0);
      if(Math.abs(dy)>2.2) return dy;
      return (a.x??0)-(b.x??0);
    });

    // 가까운 y값끼리 같은 줄로 묶는다.
    const lines=[];
    for(const it of ordered){
      const txt=String(it.text||"").trim();
      if(!txt) continue;

      let line=lines.find(l=>Math.abs(l.y-(it.y??0))<=2.2);
      if(!line){
        line={y:(it.y??0),items:[]};
        lines.push(line);
      }
      line.items.push(it);
    }

    lines.sort((a,b)=>b.y-a.y);
    const texts=lines.map(l=>
      l.items
        .sort((a,b)=>(a.x??0)-(b.x??0))
        .map(i=>String(i.text||"").trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g," ")
        .trim()
    );

    // 한 학생이 여러 줄에 걸쳐 있어도 잡히도록 연속 1~6줄을 합쳐 검사
    for(let i=0;i<texts.length;i++){
      for(let span=1;span<=6 && i+span<=texts.length;span++){
        const s=texts.slice(i,i+span).join(" ").replace(/\s+/g," ").trim();

        // 예: 7차일반 3 3 12 신송화 4 2.03 1.42
        const m=s.match(/(?:7차일반\s+)?3\s+([1-9])\s+(\d{1,2})\s+([가-힣]{2,5})\s+(\d{1,3})\s+(\d{1,3}(?:\.\d+)?)\s+(\d(?:\.\d+)?)/);
        if(!m) continue;

        const row={
          grade:"3",
          classNo:m[1],
          studentNo:m[2],
          studentName:m[3],
          rank:Number(m[4]),
          percent:Number(m[5]),
          gradeValue:Number(m[6])
        };

        if(
          Number.isFinite(row.rank) &&
          Number.isFinite(row.percent) &&
          Number.isFinite(row.gradeValue) &&
          row.gradeValue>=1 && row.gradeValue<=9 &&
          row.rank>=1 && row.rank<=500 &&
          row.percent>=0 && row.percent<=100
        ){
          out.push(row);
          break;
        }
      }
    }
  }

  // 같은 학생은 한 번만 유지
  const uniq=new Map();
  for(const r of out){
    uniq.set(gradeStudentKey(r),r);
  }
  return [...uniq.values()];
}

async function handleGradeFile(file){
  if(!file||!(/\.pdf$/i.test(file.name)||file.type==="application/pdf")){
    $("#gradeUploadStatus").textContent="PDF 파일을 선택해 주세요.";
    return toast("내신등급 PDF 파일을 선택해 주세요.");
  }

  $("#gradeUploadStatus").textContent=`${file.name} 분석 중...`;
  $("#progressModal").classList.remove("hidden");
  $("#progressTitle").textContent="내신등급 PDF 분석 중...";

  try{
    const pages=await extractItems(file);
    const parsed=parseGradePdfPages(pages);

    if(!parsed.length){
      $("#gradeUploadStatus").textContent="학생 성적을 인식하지 못했습니다.";
      throw new Error("내신등급 학생 정보를 인식하지 못했습니다.");
    }

    gradeRows=parsed;
    gradeFilterMode="all";
    gradeRangeMin=null;
    gradeRangeMax=null;
    $("#gradeMin").value="";
    $("#gradeMax").value="";
    $$(".grade-chip").forEach(b=>b.classList.toggle("active",b.dataset.grade==="all"));

    $("#gradeUploadStatus").textContent=`${file.name} · ${gradeRows.length}명 인식 완료`;
    render();
    toast(`내신등급 ${gradeRows.length}명 분석 완료`);
  }catch(e){
    console.error(e);
    if(!$("#gradeUploadStatus").textContent.includes("인식하지")){
      $("#gradeUploadStatus").textContent=`오류: ${e.message||"분석 실패"}`;
    }
    toast(e.message||"내신등급 PDF 분석에 실패했습니다.");
  }finally{
    $("#progressModal").classList.add("hidden");
  }
}

function detectTimestamp(pages){
  const txt=pages.slice(0,2).flat().map(x=>x.text).join(" ");
  const m=txt.match(/(20\d{2})[-/.](\d{2})[-/.](\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  return m?`${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`:new Date().toLocaleString("ko-KR");
}
function dedupeRows(list){
  const seen=new Set();
  return list.filter(r=>{
    const k=[studentKey(r),exactKey(r)].join("::");
    if(seen.has(k))return false;seen.add(k);return true;
  });
}

function groupRisk(g){
  const gm=gradeMap();
  const unique=[...new Map(g.map(r=>[studentKey(r),r])).values()];
  const cats=[...new Set(g.map(supportCategory))];
  const grades=unique.map(r=>{
    const gi=r.gradeInfo || gm.get(studentKey(r));
    const v=Number(gi?.gradeValue);
    return Number.isFinite(v)?v:null;
  });

  const usable=grades.every(v=>v!=null) && grades.length>=2;
  const gap=usable ? +(Math.max(...grades)-Math.min(...grades)).toFixed(2) : null;

  // 학종은 내신만으로 합격 가능성을 판정하지 않는다.
  if(cats.length===1 && cats[0]==="jonghap"){
    return {level:"review",label:"학종 참고",gap,note:"내신만으로 위험도 판정하지 않음"};
  }

  // 교과는 내신 차이를 상담용 점검 기준으로 사용한다.
  if(cats.length===1 && cats[0]==="gyogwa"){
    if(!usable) return {level:"unknown",label:"판단 보류",gap:null,note:"내신 미연결"};
    if(gap<=0.50) return {level:"high",label:"교과 높음",gap};
    if(gap<=1.00) return {level:"medium",label:"교과 보통",gap};
    return {level:"low",label:"교과 낮음",gap};
  }

  return {level:"unknown",label:"판단 보류",gap,note:"전형 구분 혼합 또는 미분류"};
}
function riskRank(level){
  return ({high:0,review:1,medium:2,low:3,unknown:4})[level] ?? 9;
}
function applyRiskFilter(groups){
  const filtered=riskFilterMode==="all"
    ? groups
    : groups.filter(([,g])=>groupRisk(g).level===riskFilterMode);

  return [...filtered].sort((a,b)=>{
    const ra=groupRisk(a[1]), rb=groupRisk(b[1]);
    const d=riskRank(ra.level)-riskRank(rb.level);
    if(d!==0)return d;
    const ga=ra.gap==null?99:ra.gap, gb=rb.gap==null?99:rb.gap;
    if(ga!==gb)return ga-gb;
    return b[1].length-a[1].length;
  });
}
function groupBy(keyFn,list=activeRows()){
  const m=new Map();
  for(const r of list){
    const k=keyFn(r); if(!k||k.replace(/\|/g,"")==="")continue;
    if(!m.has(k))m.set(k,[]);m.get(k).push(r);
  }
  return [...m.entries()].filter(([,g])=>new Set(g.map(studentKey)).size>1).sort((a,b)=>b[1].length-a[1].length);
}
function exactGroups(list=activeRows()){return groupBy(exactKey,list)}
function deptGroups(list=activeRows()){
  return groupBy(deptKey,list).filter(([k,g])=>new Set(g.map(exactKey)).size>1);
}
function duplicateKeyFromGroup(g){
  return g?.length ? exactKey(g[0]) : "";
}
function studentSet(g){
  return new Set((g||[]).map(studentKey));
}
function sameSet(a,b){
  if(a.size!==b.size)return false;
  for(const x of a)if(!b.has(x))return false;
  return true;
}
function computeChanges(){
  if(!previousSnapshot)return {new:[],changed:[],stable:[],solved:[]};

  // 비교는 지원 조합 자체(대학+학과+전형)를 기준으로 한다.
  // 학생 구성만 달라진 경우에는 신규+해소가 아니라 '인원 변동'으로 분류한다.
  const now=exactGroups(rows);
  const prev=exactGroups(previousSnapshot.rows||[]);

  const nowMap=new Map(now.map(([,g])=>[duplicateKeyFromGroup(g),g]));
  const prevMap=new Map(prev.map(([,g])=>[duplicateKeyFromGroup(g),g]));

  const result={new:[],changed:[],stable:[],solved:[]};

  for(const [key,g] of nowMap){
    if(!prevMap.has(key)){
      result.new.push(g);
      continue;
    }
    const pg=prevMap.get(key);
    const ns=studentSet(g), ps=studentSet(pg);

    if(sameSet(ns,ps)){
      result.stable.push(g);
    }else{
      const added=g.filter(r=>!ps.has(studentKey(r)));
      const removed=pg.filter(r=>!ns.has(studentKey(r)));
      result.changed.push({group:g,previousGroup:pg,added,removed});
    }
  }

  for(const [key,g] of prevMap){
    if(!nowMap.has(key))result.solved.push(g);
  }
  return result;
}
function labelGroup(g){
  const r=g[0];
  const countText=r.recruitCount?` (모집 ${r.recruitCount}명)`:"";
  return `${r.university}${r.department?` · ${r.department}${countText}`:""}${r.admissionDetail?` · ${r.admissionDetail}`:""}`;
}
function saveCurrentAsPrevious(){
  localStorage.setItem(STORAGE_KEY,JSON.stringify({label:currentSnapshotLabel,rows}));
}
function loadPrevious(){
  try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||"null")}catch{return null}
}

async function handleFile(file){
  if(!file||!(/\.pdf$/i.test(file.name)||file.type==="application/pdf"))return toast("PDF 파일을 선택해 주세요.");
  $("#progressModal").classList.remove("hidden");
  try{
    const pages=await extractItems(file);
    const parsed=dedupeRows(pages.flatMap((items,i)=>parsePage(items,i+1)));
    if(!parsed.length)throw new Error("PDF 텍스트는 읽었지만 표 행 좌표를 찾지 못했습니다. v2.2 파일로 교체되었는지 확인해 주세요.");
    if(parsed.length<10)throw new Error(`학생 지원정보가 ${parsed.length}건만 인식되었습니다. 화면을 캡처해 보내주세요.`);

    previousSnapshot=loadPrevious();
    rows=parsed;
    currentSnapshotLabel=`${file.name} · ${detectTimestamp(pages)}`;
    render();

    // 이번 분석본을 다음 업로드의 비교기준으로 저장
    saveCurrentAsPrevious();
    toast(`${new Set(rows.map(studentKey)).size}명 · ${rows.length}건 분석 완료`);
  }catch(e){
    console.error(e);toast(e.message||"PDF 분석에 실패했습니다.");
  }finally{$("#progressModal").classList.add("hidden")}
}

function studentDisplay(r){
  const gi=r.gradeInfo || gradeMap().get(studentKey(r));
  const g=Number(gi?.gradeValue);
  const gtxt=Number.isFinite(g)?` · 내신 ${g.toFixed(2)}`:"";
  return `${esc(r.classNo)}반 ${esc(r.studentNo)}번 ${esc(r.studentName)}${gtxt}`;
}
function render(){
  const has=rows.length>0;
  $("#summarySection").classList.toggle("hidden",!has);$("#emptyState").classList.toggle("hidden",has);
  if(!has)return;

  const visibleRows=activeRows();
  const students=new Set(rows.map(studentKey)), exact=exactGroups(), dept=deptGroups(), changes=computeChanges();
  $("#snapshotLabel").textContent=currentSnapshotLabel;
  $("#previousInfo").textContent=previousSnapshot?`이전 분석본: ${previousSnapshot.label||"저장본"}`:"이전 비교자료 없음";
  $("#studentCount").textContent=students.size;$("#rowCount").textContent=rows.length;$("#exactCount").textContent=exact.length;$("#deptCount").textContent=dept.length;
  $("#newCount").textContent=changes.new.length+changes.changed.length;

  const priorityExact=exactGroups();
  const priorityGyogwa=priorityExact.filter(([,g])=>groupRisk(g).level==="high");
  const priorityJonghap=priorityExact.filter(([,g])=>groupRisk(g).level==="review");
  if($("#priorityGyogwaCount")) $("#priorityGyogwaCount").textContent=priorityGyogwa.length;
  if($("#priorityJonghapCount")) $("#priorityJonghapCount").textContent=priorityJonghap.length;

  $("#gradeFilterPanel").classList.toggle("hidden",gradeRows.length===0);
  if(gradeRows.length){
    const gm=gradeMap();
    const matchedStudentKeys=new Set(rows.filter(r=>gm.has(studentKey(r))).map(studentKey));
    $("#gradeMatchInfo").textContent=`내신 ${gradeRows.length}명 중 관심대학 자료와 ${matchedStudentKeys.size}명 연결됨`;
    $("#filteredStudentCount").textContent=new Set(visibleRows.map(studentKey)).size;
    $("#filteredRowCount").textContent=visibleRows.length;
    $("#filteredExactCount").textContent=exact.length;
    $("#filteredDeptCount").textContent=dept.length;
    const supportLabel=supportTypeMode==="jonghap"?"학종":supportTypeMode==="gyogwa"?"교과":"전체 전형";
    const universityLabel=universitySearchText.trim()?`대학: ${universitySearchText.trim()}`:"전체 대학";
    $("#filterStatusLine").textContent=`${supportLabel} · ${universityLabel}`;
    const sm=new Map();for(const r of visibleRows)if(!sm.has(studentKey(r)))sm.set(studentKey(r),r);
    $("#filteredStudentList").innerHTML=[...sm.values()].sort((a,b)=>Number(a.gradeInfo?.gradeValue||99)-Number(b.gradeInfo?.gradeValue||99))
      .map(r=>`<span class="filtered-student-chip"><strong>${esc(r.studentName)}</strong> · ${esc(`${r.classNo}반 ${r.studentNo}번`)} · ${Number(r.gradeInfo?.gradeValue).toFixed(2)}</span>`).join("")
      || '<span class="filtered-student-chip">현재 조건에 해당하는 학생이 없습니다.</span>';
  }

  $("#changeSection").classList.toggle("hidden",!previousSnapshot);
  if($("#changeNewCount")) $("#changeNewCount").textContent=changes.new.length;
  if($("#changeChangedCount")) $("#changeChangedCount").textContent=changes.changed.length;
  if($("#changeStableCount")) $("#changeStableCount").textContent=changes.stable.length;
  if($("#changeSolvedCount")) $("#changeSolvedCount").textContent=changes.solved.length;

  $$(".tab").forEach(b=>b.classList.toggle("active",b.dataset.view===currentView));
  $("#duplicateSection").classList.toggle("hidden",currentView==="all");$("#allRowsSection").classList.toggle("hidden",currentView!=="all");
  if(currentView==="all")renderAll();else renderDuplicates();
  if(previousSnapshot)renderChanges();
}
function renderPeople(g){
  const unique=[...new Map(g.map(r=>[studentKey(r),r])).values()];
  const gm=gradeMap();

  return unique.map(r=>{
    const gi=r.gradeInfo || gm.get(studentKey(r));
    const gradeValue=Number(gi?.gradeValue);
    const gradeBadge=Number.isFinite(gradeValue)
      ? `<span class="grade-badge">내신 ${gradeValue.toFixed(2)}</span>`
      : `<span class="grade-badge grade-missing">내신 미연결</span>`;

    return `<div class="person">
      <div class="person-main">
        <strong>${esc(`${r.grade}${String(r.classNo).padStart(2,"0")}${String(r.studentNo).padStart(2,"0")} · ${r.studentName}`)}</strong>
        ${gradeBadge}
      </div>
      <span>${esc(r.university)} / ${esc(r.department)} / ${esc(r.admissionType)} / ${esc(r.admissionDetail)}</span>
    </div>`;
  }).join("");
}
function renderDuplicates(){
  let groups=currentView==="exact"?exactGroups():deptGroups();
  groups=applyRiskFilter(groups);
  const host=$("#duplicateList");

  if(!groups.length){
    host.innerHTML='<div class="empty-state">현재 조건에 해당하는 중복지원 가능성이 없습니다.</div>';
    return;
  }

  host.innerHTML=groups.map(([,g])=>{
    const risk=groupRisk(g);
    const gapText=risk.gap==null?"내신 비교 불가":`내신 차이 ${risk.gap.toFixed(2)}`;
    const badgePrefix=risk.level==="review"?"":"위험도 ";
    const noteHtml=risk.note?`<div class="risk-note ${risk.level}">${esc(risk.note)}</div>`:"";
    return `<article class="duplicate-group risk-${risk.level}">
      <div class="dup-head">
        <div>
          <h3>${esc(labelGroup(g))}</h3>
          <div class="dup-meta">${currentView==="exact"?"대학·모집단위·전형이 모두 일치":"같은 대학·모집단위, 전형은 다름"}</div>
        </div>
        <div class="dup-head-right">
          <span class="risk-badge ${risk.level}">${badgePrefix}${risk.label}</span>
          <span class="grade-gap">${gapText}</span>
          <span class="count">${new Set(g.map(studentKey)).size}명 중복</span>
        </div>
      </div>
      ${noteHtml}
      <div class="people">${renderPeople(g)}</div>
    </article>`;
  }).join("");
}
function renderChanges(){
  const ch=computeChanges(), raw=ch[changeMode]||[], host=$("#changeList");
  if(!raw.length){
    host.innerHTML='<div class="empty-state">해당 변화가 없습니다.</div>';
    return;
  }

  const textMap={new:"새로 발생",changed:"인원 변동",stable:"계속 중복",solved:"해소됨"};
  const text=textMap[changeMode]||"변화";

  host.innerHTML=raw.map(item=>{
    const g=changeMode==="changed"?item.group:item;
    let diffHtml="";

    if(changeMode==="changed"){
      const gm=gradeMap();
      const added=[...new Map(item.added.map(r=>[studentKey(r),r])).values()];
      const removed=[...new Map(item.removed.map(r=>[studentKey(r),r])).values()];

      const chip=(r,kind)=>{
        const gi=r.gradeInfo||gm.get(studentKey(r));
        const gv=Number(gi?.gradeValue);
        const gradeText=Number.isFinite(gv)?` · 내신 ${gv.toFixed(2)}`:"";
        return `<span class="change-person-chip ${kind}">${kind==="added"?"+":"−"} ${esc(`${r.classNo}반 ${r.studentNo}번 ${r.studentName}${gradeText}`)}</span>`;
      };

      diffHtml=`<div class="member-change-summary">
        ${added.length?`<div><span class="change-label add">추가</span>${added.map(r=>chip(r,"added")).join("")}</div>`:""}
        ${removed.length?`<div><span class="change-label remove">제외</span>${removed.map(r=>chip(r,"removed")).join("")}</div>`:""}
      </div>`;
    }

    return `<article class="duplicate-group change-row ${changeMode}">
      <div class="dup-head">
        <h3>${esc(labelGroup(g))}</h3>
        <span class="status-chip ${changeMode}">${text}</span>
      </div>
      ${diffHtml}
      <div class="people">${renderPeople(g)}</div>
    </article>`;
  }).join("");
}
function renderAll(){
  $("#rowsBody").innerHTML=activeRows().map(r=>`<tr><td>${esc(`${r.grade}${String(r.classNo).padStart(2,"0")}${String(r.studentNo).padStart(2,"0")}`)}</td><td>${esc(r.studentName)}</td><td>${esc(r.university)}</td><td>${esc(r.department)}</td><td>${esc(r.recruitCount||"")}</td><td>${esc(r.admissionType)}</td><td>${esc(r.admissionDetail)}</td></tr>`).join("");
}
function openEdit(){
  editDraft=rows.map(r=>({...r}));
  $("#editRows").innerHTML=editDraft.map((r,i)=>`<div class="edit-row" data-index="${i}"><label>학번<input data-field="studentNoDisplay" value="${esc(`${r.grade}-${r.classNo}-${r.studentNo}`)}" disabled></label><label>이름<input data-field="studentName" value="${esc(r.studentName)}"></label><label>대학<input data-field="university" value="${esc(r.university)}"></label><label>모집단위<input data-field="department" value="${esc(r.department)}"></label><label>모집인원<input data-field="recruitCount" value="${esc(r.recruitCount||"")}"></label><label>전형유형<input data-field="admissionType" value="${esc(r.admissionType)}"></label><label>세부유형<input data-field="admissionDetail" value="${esc(r.admissionDetail)}"></label><button class="delete-row" data-index="${i}">×</button></div>`).join("");
  $("#editModal").classList.remove("hidden");
  $$(".delete-row").forEach(b=>b.onclick=()=>{editDraft[+b.dataset.index].__delete=true;b.closest(".edit-row").remove()});
}
function closeEdit(){$("#editModal").classList.add("hidden")}
function saveEdit(){
  $$("#editRows .edit-row").forEach(el=>{const i=+el.dataset.index;el.querySelectorAll("input:not(:disabled)").forEach(inp=>editDraft[i][inp.dataset.field]=inp.value.trim())});
  rows=editDraft.filter(r=>!r.__delete);closeEdit();render();toast("수정내용을 반영했습니다.");
}
function exportCsv(){
  const q=v=>`"${String(v??"").replaceAll('"','""')}"`, head=["학년","반","번호","이름","대학","모집단위","모집인원","전형유형","세부유형"];
  const csv="\ufeff"+[head.map(q).join(","),...rows.map(r=>[r.grade,r.classNo,r.studentNo,r.studentName,r.university,r.department,r.recruitCount||"",r.admissionType,r.admissionDetail].map(q).join(","))].join("\n");
  const u=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})),a=document.createElement("a");a.href=u;a.download="관심대학_팀킬분석.csv";a.click();URL.revokeObjectURL(u);
}






$("#priorityGyogwaBtn").onclick=()=>{
  riskFilterMode="high";
  $$(".risk-chip").forEach(b=>b.classList.toggle("active",b.dataset.risk==="high"));
  currentView="exact";
  render();
  $("#duplicateSection")?.scrollIntoView({behavior:"smooth",block:"start"});
};
$("#priorityJonghapBtn").onclick=()=>{
  riskFilterMode="review";
  $$(".risk-chip").forEach(b=>b.classList.toggle("active",b.dataset.risk==="review"));
  currentView="exact";
  render();
  $("#duplicateSection")?.scrollIntoView({behavior:"smooth",block:"start"});
};

$$(".risk-chip").forEach(btn=>btn.onclick=()=>{
  riskFilterMode=btn.dataset.risk;
  $$(".risk-chip").forEach(b=>b.classList.toggle("active",b===btn));
  render();
});

$$(".support-chip").forEach(btn=>btn.onclick=()=>{
  supportTypeMode=btn.dataset.support;
  $$(".support-chip").forEach(b=>b.classList.toggle("active",b===btn));
  render();
});

$("#universitySearch").oninput=e=>{
  universitySearchText=e.target.value;
  render();
};

$("#clearUniversitySearchBtn").onclick=()=>{
  universitySearchText="";
  $("#universitySearch").value="";
  render();
};

$("#classFilter").onchange=e=>{classFilterMode=e.target.value;render();};
$("#studentSearch").oninput=e=>{studentSearchText=e.target.value;render();};
$("#resetSubFilterBtn").onclick=()=>{
  classFilterMode="all";studentSearchText="";
  $("#classFilter").value="all";$("#studentSearch").value="";
  render();
};

$$(".grade-chip").forEach(btn=>btn.onclick=()=>{
  gradeFilterMode=btn.dataset.grade;gradeRangeMin=null;gradeRangeMax=null;
  $("#gradeMin").value="";$("#gradeMax").value="";
  $$(".grade-chip").forEach(b=>b.classList.toggle("active",b===btn));render();
});
$("#applyGradeRangeBtn").onclick=()=>{
  const a=$("#gradeMin").value.trim(),b=$("#gradeMax").value.trim();
  gradeRangeMin=a===""?null:Number(a);gradeRangeMax=b===""?null:Number(b);
  if(gradeRangeMin!=null&&gradeRangeMax!=null&&gradeRangeMin>gradeRangeMax)[gradeRangeMin,gradeRangeMax]=[gradeRangeMax,gradeRangeMin];
  $$(".grade-chip").forEach(b=>b.classList.remove("active"));render();
};
$("#clearGradeRangeBtn").onclick=()=>{
  gradeFilterMode="all";gradeRangeMin=null;gradeRangeMax=null;$("#gradeMin").value="";$("#gradeMax").value="";
  $$(".grade-chip").forEach(b=>b.classList.toggle("active",b.dataset.grade==="all"));render();
};
$("#gradeChooseBtn").onclick=()=>$("#gradeFileInput").click();
$("#gradeFileInput").onchange=e=>handleGradeFile(e.target.files[0]);
const gdz=$("#gradeDropZone");
["dragenter","dragover"].forEach(ev=>gdz.addEventListener(ev,e=>{e.preventDefault();gdz.classList.add("dragover")}));
["dragleave","drop"].forEach(ev=>gdz.addEventListener(ev,e=>{e.preventDefault();gdz.classList.remove("dragover")}));
gdz.addEventListener("drop",e=>handleGradeFile(e.dataTransfer.files[0]));

$("#chooseBtn").onclick=()=>$("#fileInput").click();
$("#fileInput").onchange=e=>handleFile(e.target.files[0]);
const dz=$("#dropZone");["dragenter","dragover"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add("dragover")}));["dragleave","drop"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove("dragover")}));dz.addEventListener("drop",e=>handleFile(e.dataTransfer.files[0]));
$$(".tab").forEach(b=>b.onclick=()=>{currentView=b.dataset.view;render()});
$$(".change-card").forEach(b=>b.onclick=()=>{changeMode=b.dataset.change;renderChanges()});
$("#newCard").onclick=()=>{if(previousSnapshot){changeMode="new";$("#changeSection").scrollIntoView({behavior:"smooth"})}else toast("이전 분석본이 있어야 새 중복을 비교할 수 있습니다.")};
$("#exactCard").onclick=()=>{currentView="exact";render()};$("#deptCard").onclick=()=>{currentView="department";render()};
$("#editModeBtn").onclick=openEdit;$("#editCloseBtn").onclick=closeEdit;$("#editCancelBtn").onclick=closeEdit;$("#editSaveBtn").onclick=saveEdit;$("#exportBtn").onclick=exportCsv;
$("#resetBtn").onclick=()=>{if(confirm("이 브라우저에 저장된 이전 비교자료를 초기화할까요?")){localStorage.removeItem(STORAGE_KEY);previousSnapshot=null;render();toast("비교자료를 초기화했습니다.")}};
$("#editModal").onclick=e=>{if(e.target===$("#editModal"))closeEdit()};
