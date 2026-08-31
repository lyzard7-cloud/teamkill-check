
const $=q=>document.querySelector(q), $$=q=>[...document.querySelectorAll(q)];
const pdfjsLib=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

const STORAGE_KEY="gangil-teamkill-interestlist-v2";
let rows=[], currentView="exact", editDraft=[], currentSnapshotLabel="", previousSnapshot=null;
let changeMode="new";

function toast(msg){const e=$("#toast");e.textContent=msg;e.classList.remove("hidden");clearTimeout(window.__t);window.__t=setTimeout(()=>e.classList.add("hidden"),2400)}
function norm(v=""){return String(v||"").normalize("NFKC").replace(/\s+/g,"").replace(/[()（）·ㆍ.,\-_/:\[\]]/g,"").toLowerCase()}
function esc(v=""){return String(v??"").replace(/[&<>"']/g,s=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[s]))}
function cleanCell(v=""){return String(v||"").replace(/\s+/g,"").replace(/[\u200b\u00a0]/g,"").trim()}
function schoolNo(r){return `${r.grade||""}${String(r.classNo||"").padStart(2,"0")}${String(r.studentNo||"").padStart(2,"0")}`}
function studentKey(r){return `${r.grade}-${r.classNo}-${r.studentNo}-${norm(r.studentName)}`}
function exactKey(r){return [norm(r.university),norm(r.department),norm(r.admissionType),norm(r.admissionDetail)].join("|")}
function deptKey(r){return [norm(r.university),norm(r.department)].join("|")}

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
function parsePage(items,pageNo){
  const cols=headerColumns(items);
  if(!Number.isFinite(cols.no)||!Number.isFinite(cols.university)||!Number.isFinite(cols.department)){
    return [];
  }

  // Missing narrow left-side headers are recovered from the visual order of this fixed report.
  const ux=cols.university, dx=cols.department;
  const unit=dx-ux;
  cols.studentName ??= ux-unit*4.02;
  cols.studentNo ??= ux-unit*4.72;
  cols.classNo ??= ux-unit*5.22;
  cols.grade ??= ux-unit*5.72;
  cols.admissionType ??= dx+unit*5.55;
  cols.admissionDetail ??= dx+unit*6.72;

  const bounds=makeBoundaries(cols);
  const noX=cols.no;
  const markers=items.filter(i=>{
    const cx=i.x+i.w/2;
    return Math.abs(cx-noX)<12 && /^(?:[1-9]|1\d|20)$/.test(i.text);
  }).sort((a,b)=>b.y-a.y);

  if(!markers.length)return [];
  const parsed=[];
  for(let i=0;i<markers.length;i++){
    const y=markers[i].y;
    const upper=i===0?y+18:(markers[i-1].y+y)/2;
    const lower=i===markers.length-1?y-18:(y+markers[i+1].y)/2;
    const rowItems=items.filter(it=>it.y<upper&&it.y>=lower);

    const r={
      pageNo,
      no:Number(markers[i].text),
      grade:cellText(rowItems,bounds.grade),
      classNo:cellText(rowItems,bounds.classNo),
      studentNo:cellText(rowItems,bounds.studentNo),
      studentName:cellText(rowItems,bounds.studentName),
      university:cellText(rowItems,bounds.university),
      department:cellText(rowItems,bounds.department),
      admissionType:cellText(rowItems,bounds.admissionType),
      admissionDetail:cellText(rowItems,bounds.admissionDetail)
    };

    // 학생 정보는 학년 3 / 반 1~9 / 번호 1~40 / 한글 이름 형태로 검증
    const validIdentity=/^3$/.test(r.grade)&&/^[1-9]$/.test(r.classNo)&&/^\d{1,2}$/.test(r.studentNo)&&/^[가-힣]{2,5}$/.test(r.studentName);
    const validUniversity=r.university.length>=2;
    if(validIdentity&&validUniversity) parsed.push(r);
  }
  return parsed;
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
function groupBy(keyFn,list=rows){
  const m=new Map();
  for(const r of list){
    const k=keyFn(r); if(!k||k.replace(/\|/g,"")==="")continue;
    if(!m.has(k))m.set(k,[]);m.get(k).push(r);
  }
  return [...m.entries()].filter(([,g])=>new Set(g.map(studentKey)).size>1).sort((a,b)=>b[1].length-a[1].length);
}
function exactGroups(list=rows){return groupBy(exactKey,list)}
function deptGroups(list=rows){
  return groupBy(deptKey,list).filter(([k,g])=>new Set(g.map(exactKey)).size>1);
}
function groupSignature(g){
  const keys=[...new Set(g.map(studentKey))].sort();
  return `${exactKey(g[0])}::${keys.join(",")}`;
}
function computeChanges(){
  if(!previousSnapshot)return {new:[],stable:[],solved:[]};
  const now=exactGroups(rows), prev=exactGroups(previousSnapshot.rows||[]);
  const nowMap=new Map(now.map(([,g])=>[groupSignature(g),g]));
  const prevMap=new Map(prev.map(([,g])=>[groupSignature(g),g]));
  const n=[],s=[],d=[];
  for(const [k,g] of nowMap)(prevMap.has(k)?s:n).push(g);
  for(const [k,g] of prevMap)if(!nowMap.has(k))d.push(g);
  return {new:n,stable:s,solved:d};
}
function labelGroup(g){
  const r=g[0];
  return `${r.university}${r.department?` · ${r.department}`:""}${r.admissionDetail?` · ${r.admissionDetail}`:""}`;
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
    if(!parsed.length)throw new Error("표의 학생 지원정보를 인식하지 못했습니다.");

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
function render(){
  const has=rows.length>0;
  $("#summarySection").classList.toggle("hidden",!has);$("#emptyState").classList.toggle("hidden",has);
  if(!has)return;

  const students=new Set(rows.map(studentKey)), exact=exactGroups(), dept=deptGroups(), changes=computeChanges();
  $("#snapshotLabel").textContent=currentSnapshotLabel;
  $("#previousInfo").textContent=previousSnapshot?`이전 분석본: ${previousSnapshot.label||"저장본"}`:"이전 비교자료 없음";
  $("#studentCount").textContent=students.size;$("#rowCount").textContent=rows.length;$("#exactCount").textContent=exact.length;$("#deptCount").textContent=dept.length;
  $("#newCount").textContent=changes.new.length;
  $("#changeSection").classList.toggle("hidden",!previousSnapshot);
  $("#changeNewCount").textContent=changes.new.length;$("#changeStableCount").textContent=changes.stable.length;$("#changeSolvedCount").textContent=changes.solved.length;

  $$(".tab").forEach(b=>b.classList.toggle("active",b.dataset.view===currentView));
  $("#duplicateSection").classList.toggle("hidden",currentView==="all");$("#allRowsSection").classList.toggle("hidden",currentView!=="all");
  if(currentView==="all")renderAll();else renderDuplicates();
  if(previousSnapshot)renderChanges();
}
function renderPeople(g){
  const unique=[...new Map(g.map(r=>[studentKey(r),r])).values()];
  return unique.map(r=>`<div class="person"><strong>${esc(`${r.grade}${String(r.classNo).padStart(2,"0")}${String(r.studentNo).padStart(2,"0")} · ${r.studentName}`)}</strong><span>${esc(r.university)} / ${esc(r.department)} / ${esc(r.admissionType)} / ${esc(r.admissionDetail)}</span></div>`).join("");
}
function renderDuplicates(){
  const groups=currentView==="exact"?exactGroups():deptGroups(), host=$("#duplicateList");
  if(!groups.length){host.innerHTML='<div class="empty-state">현재 중복지원 가능성이 없습니다.</div>';return}
  host.innerHTML=groups.map(([,g])=>`<article class="duplicate-group"><div class="dup-head"><div><h3>${esc(labelGroup(g))}</h3><div class="dup-meta">${currentView==="exact"?"대학·모집단위·전형이 모두 일치":"같은 대학·모집단위, 전형은 다름"}</div></div><span class="count">${new Set(g.map(studentKey)).size}명 중복</span></div><div class="people">${renderPeople(g)}</div></article>`).join("");
}
function renderChanges(){
  const ch=computeChanges(), groups=ch[changeMode]||[], host=$("#changeList");
  if(!groups.length){host.innerHTML='<div class="empty-state">해당 변화가 없습니다.</div>';return}
  const text=changeMode==="new"?"새로 발생":changeMode==="solved"?"해소됨":"계속 중복";
  host.innerHTML=groups.map(g=>`<article class="duplicate-group change-row ${changeMode}"><div class="dup-head"><h3>${esc(labelGroup(g))}</h3><span class="status-chip ${changeMode}">${text}</span></div><div class="people">${renderPeople(g)}</div></article>`).join("");
}
function renderAll(){
  $("#rowsBody").innerHTML=rows.map(r=>`<tr><td>${esc(`${r.grade}${String(r.classNo).padStart(2,"0")}${String(r.studentNo).padStart(2,"0")}`)}</td><td>${esc(r.studentName)}</td><td>${esc(r.university)}</td><td>${esc(r.department)}</td><td>${esc(r.admissionType)}</td><td>${esc(r.admissionDetail)}</td></tr>`).join("");
}
function openEdit(){
  editDraft=rows.map(r=>({...r}));
  $("#editRows").innerHTML=editDraft.map((r,i)=>`<div class="edit-row" data-index="${i}"><label>학번<input data-field="studentNoDisplay" value="${esc(`${r.grade}-${r.classNo}-${r.studentNo}`)}" disabled></label><label>이름<input data-field="studentName" value="${esc(r.studentName)}"></label><label>대학<input data-field="university" value="${esc(r.university)}"></label><label>모집단위<input data-field="department" value="${esc(r.department)}"></label><label>전형유형<input data-field="admissionType" value="${esc(r.admissionType)}"></label><label>세부유형<input data-field="admissionDetail" value="${esc(r.admissionDetail)}"></label><button class="delete-row" data-index="${i}">×</button></div>`).join("");
  $("#editModal").classList.remove("hidden");
  $$(".delete-row").forEach(b=>b.onclick=()=>{editDraft[+b.dataset.index].__delete=true;b.closest(".edit-row").remove()});
}
function closeEdit(){$("#editModal").classList.add("hidden")}
function saveEdit(){
  $$("#editRows .edit-row").forEach(el=>{const i=+el.dataset.index;el.querySelectorAll("input:not(:disabled)").forEach(inp=>editDraft[i][inp.dataset.field]=inp.value.trim())});
  rows=editDraft.filter(r=>!r.__delete);closeEdit();render();toast("수정내용을 반영했습니다.");
}
function exportCsv(){
  const q=v=>`"${String(v??"").replaceAll('"','""')}"`, head=["학년","반","번호","이름","대학","모집단위","전형유형","세부유형"];
  const csv="\ufeff"+[head.map(q).join(","),...rows.map(r=>[r.grade,r.classNo,r.studentNo,r.studentName,r.university,r.department,r.admissionType,r.admissionDetail].map(q).join(","))].join("\n");
  const u=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})),a=document.createElement("a");a.href=u;a.download="관심대학_팀킬분석.csv";a.click();URL.revokeObjectURL(u);
}

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
