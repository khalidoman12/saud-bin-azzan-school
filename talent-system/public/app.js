"use strict";
const $ = id => document.getElementById(id);
const htmlEscape = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const state = {sections:[], scope:null, section:null, criteria:null, records:[]};
const ratingLabels = {yes:"تنطبق بوضوح",partial:"تنطبق جزئيًا",no:"لا تنطبق",unknown:"لم تتوفر فرصة للملاحظة"};
const reviewStatuses = ["لم تتم المراجعة بعد","بحاجة إلى ملاحظات إضافية","يوصى بإتاحة نشاط إثرائي","يوصى بإجراء تقييم تخصصي إضافي","تمت مراجعة الحالة"];
let desiredScope = "";

async function api(url,opts={}) {
  const response=await fetch(url,{credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},...opts});
  let data;
  try {data=await response.json();} catch {data={detail:"تعذر الاتصال بالخادم أو قراءة استجابته."};}
  if (!response.ok) {let msg=typeof data.detail==="string"?data.detail:"تعذر إتمام العملية."; throw new Error(msg);}
  return data;
}
function alertMsg(msg){$("alert").textContent=msg;setTimeout(()=>{if($("alert").textContent===msg)$("alert").textContent="";},5000);}
function setScreen(inWorkspace){
  $("hero").hidden=inWorkspace;$("landing").hidden=inWorkspace;$("workspace").hidden=!inWorkspace;
  $("sessionActions").hidden=!inWorkspace;
}
function renderCards(){
  const sections=state.sections;
  $("sectionCards").innerHTML=sections.map(s=>'<button type="button" class="cardButton" data-scope="'+htmlEscape(s.id)+'"><span class="cardIcon">'+htmlEscape(s.emoji)+'</span><span><span class="cardTitle">'+htmlEscape(s.title)+'</span><br><span class="cardHelp">فتح القسم برمز خاص · 4 أرقام</span></span></button>').join("");
  $("sectionCards").querySelectorAll("button[data-scope]").forEach(b=>b.addEventListener("click",()=>askPin(b.dataset.scope)));
}
function askPin(scope){
  desiredScope=scope;
  $("pinError").textContent="";
  $("pinInput").value="";
  const sec=state.sections.find(s=>s.id===scope);
  $("pinSectionTitle").textContent=sec?.title||"";
  $("pinDialog").showModal();
  $("pinInput").focus();
}
async function login(e){
  e.preventDefault();
  const btn=$("pinForm").querySelector('button[type="submit"]');
  btn.disabled=true;$("pinError").textContent="";
  try {
    const result=await api("/api/login",{method:"POST",body:JSON.stringify({scope:desiredScope,pin:$("pinInput").value})});
    state.scope=result.scope;$("pinDialog").close();$("pinInput").value="";
    await showCurrent();
  } catch(err){$("pinError").textContent=err.message;} finally {btn.disabled=false;}
}
async function logout(){
  try {await api("/api/logout",{method:"POST"});} catch {}
  state.scope=null;state.criteria=null;state.records=[];
  setScreen(false);$("workContent").replaceChildren();alertMsg("تم إغلاق القسم.");
}
async function showCurrent(){
  if(!state.scope){setScreen(false);return;}
  state.section=state.sections.find(s=>s.id===state.scope);
  $("currentScope").textContent=state.section?.title||"";
  $("workTitle").textContent=state.section?.title||"";
  $("workKind").textContent=state.scope==="registry"?"السجل الإداري المحمي":"استمارة تقييم الطلبة الموهوبين";
  setScreen(true);
  if(state.scope==="registry"||state.scope==="counseling"){
    if(state.scope==="counseling"){
      await renderNominationForm();
      const link=document.createElement("button");link.type="button";link.className="btn outline";link.textContent="عرض سجل المرشحين ومراجعات اللجنة";
      link.addEventListener("click",()=>renderRegistry(true));
      $("workContent").prepend(link);
    } else await renderRegistry(false);
  } else await renderNominationForm();
}
function typeOptions(types) {return ['<option value="">اختر نوع الموهبة</option>',...types.map(t=>'<option value="'+htmlEscape(t)+'">'+htmlEscape(t)+'</option>')].join("");}
async function renderNominationForm(){
  state.criteria=await api("/api/criteria");
  const info=state.criteria;
  const questions=info.criteria.map((q,i)=>'<div class="question"><div class="qTitle">'+(i+1)+'. '+htmlEscape(q)+'</div><div class="choices">'+Object.entries(ratingLabels).map(([value,label])=>'<label class="choice"><input required type="radio" name="q'+i+'" value="'+value+'"> '+htmlEscape(label)+'</label>').join("")+'</div></div>').join("");
  const out='<form id="nominationForm">'+
  '<div class="panel"><h3>أولًا: بيانات الطالب والمعلم</h3><div class="gridForm">'+
  field("اسم الطالب كاملًا","student_name","text",true)+
  '<div class="field"><label for="grade">الصف الدراسي <b class="required">*</b></label><select required name="grade" id="grade"><option value="">اختر الصف</option><option value="5">الخامس</option><option value="6">السادس</option><option value="7">السابع</option><option value="8">الثامن</option></select></div>'+
  field("الشعبة","classroom","text",true)+field("اسم المعلم / مكتشف الموهبة","teacher_name","text",true)+
  '<div class="field"><label for="talent_type">الموهبة المكتشفة <b class="required">*</b></label><select required name="talent_type" id="talent_type">'+typeOptions(info.types)+'</select></div>'+
  '<div class="field hide" id="otherTypeBox"><label for="otherType">تحديد الموهبة الأخرى</label><input id="otherType" name="otherType" maxlength="200"></div>'+
  '<div class="field wide"><label for="talent_details">وصف مختصر للموهبة (اختياري)</label><textarea id="talent_details" name="talent_details" maxlength="1500"></textarea></div>'+
  '</div></div><div class="panel"><h3>ثانيًا: مؤشرات الكشف عن الموهبة – '+htmlEscape(info.title)+'</h3><p class="criteriaIntro">حدد مدى انطباق كل عبارة بناءً على ملاحظاتك. إذا لم تتح فرصة كافية للملاحظة فاختر الخيار المخصص، ولا تعتبر ذلك مؤشرًا سلبيًا.</p>'+questions+'</div>'+
  '<div class="panel"><h3>ثالثًا: الملاحظات والأدلة</h3><div class="gridForm">'+
  area("ملاحظات المعلم (اختياري)","comments",2000)+area("وصف الأدلة أو الأعمال الداعمة (اختياري)","evidence_note",1000)+
  '</div></div><div class="panel"><h3>رابعًا: رأي لجنة الموهوبين</h3><p class="notice">هذا الحقل اختياري تمامًا ولا يُطلب من المعلم تعبئته. تسجل اللجنة رأيها لاحقًا من بوابة الأخصائيين.</p><div class="field"><label>رأي اللجنة (غير إلزامي)</label><textarea disabled placeholder="يُترك فارغًا حتى مراجعة اللجنة"></textarea></div></div>'+
  '<div class="actions"><button id="saveNomination" class="btn primary" type="submit">حفظ استمارة الترشيح</button><button id="resetNomination" type="reset" class="btn outline">تفريغ الحقول</button></div><p class="notice">التقييم للترشيح الأولي، وليس تقريرًا تشخيصيًا نهائيًا.</p></form>';
  $("workContent").innerHTML=out;
  $("nominationForm").addEventListener("submit",submitNomination);
  $("talent_type").addEventListener("change",()=>{
    const other=$("talent_type").value==="موهبة أخرى";$("otherTypeBox").classList.toggle("hide",!other);$("otherType").required=other;
  });
}
function field(label,name,type,required){
  return '<div class="field"><label for="'+name+'">'+htmlEscape(label)+(required?' <b class="required">*</b>':'')+'</label><input id="'+name+'" name="'+name+'" type="'+type+'" maxlength="180" '+(required?'required':'')+'></div>';
}
function area(label,name,max){
  return '<div class="field wide"><label for="'+name+'">'+htmlEscape(label)+'</label><textarea name="'+name+'" id="'+name+'" maxlength="'+max+'"></textarea></div>';
}
async function submitNomination(e){
  e.preventDefault();
  const f=e.currentTarget, form=new FormData(f);
  const answers={};
  for(let i=0;i<state.criteria.criteria.length;i++){
    const a=form.get("q"+i);
    if(!a){alertMsg("يرجى الإجابة عن جميع المؤشرات.");return;}
    answers[String(i)]=a;
  }
  let talent=form.get("talent_type");
  if(talent==="موهبة أخرى")talent=String(form.get("otherType")||"").trim();
  const body={student_name:String(form.get("student_name")||"").trim(),grade:Number(form.get("grade")),classroom:String(form.get("classroom")||"").trim(),teacher_name:String(form.get("teacher_name")||"").trim(),talent_type:talent,talent_details:String(form.get("talent_details")||""),comments:String(form.get("comments")||""),evidence_note:String(form.get("evidence_note")||""),answers};
  const btn=$("saveNomination");btn.disabled=true;btn.textContent="جارٍ الحفظ...";
  try {const res=await api("/api/nominations",{method:"POST",body:JSON.stringify(body)});
    const note=document.createElement("div");note.className="message success";note.textContent=res.message+" | الرقم المرجعي: "+res.id;
    f.prepend(note);f.reset();$("otherTypeBox").classList.add("hide");window.scrollTo({top:0,behavior:"smooth"});alertMsg(res.message);
  } catch(err){alertMsg(err.message);} finally {btn.disabled=false;btn.textContent="حفظ استمارة الترشيح";}
}
async function renderRegistry(canReview){
  $("workTitle").textContent=canReview?"سجل الترشيحات ومراجعة لجنة الموهوبين":"سجل تقييم الطلبة الموهوبين";
  $("workContent").innerHTML='<div class="panel"><h3>المؤشرات الإجمالية</h3><div id="stats" class="statGrid"></div><p class="notice">الأسماء تُعرض للمخولين فقط، ويجب استخدام معرّف طالب رسمي مستقبلًا لمنع التكرار في إحصاءات الطلبة.</p></div>'+
  '<div class="panel"><div class="sectionHeading"><h3>جميع استمارات الترشيح</h3><a class="btn outline" href="/api/export.csv" download>تصدير Excel / CSV</a></div>'+
  '<div class="filters"><input id="searchRecords" placeholder="بحث باسم الطالب أو المعلم" aria-label="البحث"><select id="filterScope"><option value="">جميع المواد والأقسام</option>'+state.sections.filter(s=>s.id!=="registry").map(s=>'<option value="'+htmlEscape(s.id)+'">'+htmlEscape(s.title)+'</option>').join("")+'</select><select id="filterGrade"><option value="">جميع الصفوف</option>'+[5,6,7,8].map(n=>'<option value="'+n+'">الصف '+n+'</option>').join("")+'</select><button id="searchButton" class="btn primary">بحث</button></div>'+
  '<div class="tableWrap"><table><thead><tr><th>الرقم</th><th>اسم الطالب</th><th>الصف</th><th>المادة / القسم</th><th>الموهبة</th><th>المعلم / المكتشف</th><th>حالة المراجعة</th><th>عرض</th></tr></thead><tbody id="recordsBody"><tr><td colspan="8">جارٍ التحميل...</td></tr></tbody></table></div></div>';
  $("searchButton").addEventListener("click",loadRecords);
  $("searchRecords").addEventListener("keydown",e=>{if(e.key==="Enter")loadRecords();});
  try{
    const stats=await api("/api/stats");
    $("stats").innerHTML=[
      [stats.nominations,"إجمالي الاستمارات"],
      [stats.unique_students_estimate,"طلبة فريدون (تقديري)"],
      [stats.pending,"بانتظار مراجعة اللجنة"]
    ].map(x=>'<div class="stat"><strong>'+x[0]+'</strong><span>'+x[1]+'</span></div>').join("");
    await loadRecords();
  }catch(err){alertMsg(err.message);}
}
async function loadRecords(){
  const params=new URLSearchParams();
  if($("searchRecords").value.trim())params.set("search",$("searchRecords").value.trim());
  if($("filterScope").value)params.set("scope",$("filterScope").value);
  if($("filterGrade").value)params.set("grade",$("filterGrade").value);
  try{
    const res=await api("/api/records?"+params.toString());
    state.records=res.records;
    $("recordsBody").innerHTML=res.records.length?res.records.map(r=>'<tr><td>'+r.id+'</td><td>'+htmlEscape(r.student_name)+'</td><td>'+r.grade+'/'+htmlEscape(r.classroom)+'</td><td>'+htmlEscape(r.section_title)+'</td><td>'+htmlEscape(r.talent_type)+'</td><td>'+htmlEscape(r.teacher_name)+'</td><td>'+htmlEscape(r.review_status)+'</td><td><button class="btn outline viewRecord" data-id="'+r.id+'">عرض</button></td></tr>').join(""):'<tr><td colspan="8">لا توجد سجلات مطابقة.</td></tr>';
    document.querySelectorAll(".viewRecord").forEach(b=>b.addEventListener("click",()=>openRecord(Number(b.dataset.id))));
  }catch(err){alertMsg(err.message);}
}
async function openRecord(id){
  try {
    const {record:r,criteria}=await api("/api/records/"+id);
    const fields=[
      ["اسم الطالب",r.student_name],["الصف والشعبة",r.grade+" / "+r.classroom],
      ["المادة / القسم",r.section_title],["اسم مكتشف الموهبة",r.teacher_name],
      ["الموهبة المكتشفة",r.talent_type],["وصف الموهبة",r.talent_details],
      ["ملاحظات المعلم",r.comments],["الأدلة الداعمة",r.evidence_note],
      ["تاريخ التسجيل",r.created_at]
    ];
    let content='<div class="printTitle"><h2>مدرسة سعود بن عزان البوسعيدي</h2><h3>استمارة تقييم الطلبة الموهوبين</h3></div>';
    content+='<div class="panel">'+fields.map(([name,val])=>'<div class="detailRow"><span class="detailLabel">'+htmlEscape(name)+': </span>'+htmlEscape(val||"—")+'</div>').join("")+'</div>';
    content+='<div class="panel"><h3>نتائج المؤشرات</h3><ol class="detailCriteria">'+criteria.map((q,i)=>'<li><span>'+htmlEscape(q)+'</span> <strong class="tag">'+htmlEscape(ratingLabels[r.answers[String(i)]]||"—")+'</strong></li>').join("")+'</ol></div>';
    content+='<div class="panel"><h3>رأي لجنة الموهوبين</h3><p>'+htmlEscape(r.review_note||"لم تكتب اللجنة رأيًا بعد.")+'</p><p class="notice">'+htmlEscape(r.review_status)+'</p>';
    if(state.scope==="counseling"){
      content+='<form id="reviewForm" class="noPrint"><div class="field"><label for="reviewNote">رأي اللجنة (اختياري)</label><textarea id="reviewNote" maxlength="3000">'+htmlEscape(r.review_note)+'</textarea></div><div class="field"><label for="reviewStatus">حالة المراجعة</label><select id="reviewStatus">'+reviewStatuses.map(s=>'<option '+(s===r.review_status?'selected':'')+' value="'+htmlEscape(s)+'">'+htmlEscape(s)+'</option>').join("")+'</select></div><div class="actions"><button class="btn primary" type="submit">حفظ رأي اللجنة</button></div></form>';
    }
    content+='</div><p class="notice">إعداد الأخصائيين النفسيين والاجتماعيين: أ. خالد المشايخي، أ. حمد الشماخي، أ. شهاب الهاشمي، أ. خميس الساعدي.</p>'+
    '<div class="actions noPrint"><button type="button" class="btn outline" id="printRecord">طباعة الاستمارة</button></div>';
    $("detailBody").innerHTML=content;$("detailDialog").showModal();
    $("printRecord").addEventListener("click",()=>window.print());
    if(state.scope==="counseling") $("reviewForm").addEventListener("submit",async e=>{
      e.preventDefault();
      try {await api("/api/records/"+id+"/review",{method:"POST",body:JSON.stringify({review_note:$("reviewNote").value,review_status:$("reviewStatus").value})});
        alertMsg("تم حفظ رأي اللجنة.");$("detailDialog").close();await loadRecords();
      }catch(err){alertMsg(err.message);}
    });
  }catch(err){alertMsg(err.message);}
}
async function init(){
  $("pinForm").addEventListener("submit",login);
  $("cancelPin").addEventListener("click",()=>$("pinDialog").close());
  $("closeSection").addEventListener("click",logout);
  $("backHome").addEventListener("click",logout);
  $("closeDetail").addEventListener("click",()=>$("detailDialog").close());
  try{
    const data=await api("/api/sections");
    state.sections=data.sections;renderCards();
    try{const s=await api("/api/session");state.scope=s.scope;await showCurrent();}catch{setScreen(false);}
  }catch(err){$("sectionCards").textContent="تعذر تحميل المواد: "+err.message;}
}
document.addEventListener("DOMContentLoaded",init);
