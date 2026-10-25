/**
 * رصد الموهبة | مدرسة سعود بن عزان البوسعيدي للتعليم الأساسي (5–8)
 * Create 11 Google Forms from the 110 criteria in the active spreadsheet.
 * IMPORTANT: Before real student data, apply Google Workspace's responder access controls.
 *
 * Setup: open the master Google Sheet > Extensions > Apps Script > paste this entire
 * file > save > run setupTalentForms() as the owner, approve Google prompts.
 *
 * Data stays in the owner's Sheet and connected Forms. Never share the master Sheet with all teachers.
 */

const TALENT = Object.freeze({
  MASTER_ID: '1i0nIND0cairzBxfLm-wz6fnD782uiGxms6YTOjXUaAw',
  SCHOOL: 'مدرسة سعود بن عزان البوسعيدي للتعليم الأساسي (5–8)',
  YEAR: '2026/2027',
  ASSESSORS: 'إعداد الأخصائيين النفسيين والاجتماعيين: أ. خالد المشايخي، أ. حمد الشماخي، أ. شهاب الهاشمي، أ. خميس الساعدي',
  LINKS: 'روابط النماذج',
  CRITERIA: 'المعايير',
  REGISTER: 'سجل الترشيحات',
  RATING: ['تنطبق بوضوح','تنطبق جزئيًا','لا تنطبق','لم تتوفر فرصة للملاحظة'],
  PENDING: 'لم تتم المراجعة بعد'
});

function master_() {
  return SpreadsheetApp.openById(TALENT.MASTER_ID);
}
function criteriaBySubject_() {
  const sheet=master_().getSheetByName(TALENT.CRITERIA);
  const rows=sheet.getDataRange().getValues();
  const map={};
  rows.slice(1).forEach(row=>{
    const [id,title,talents,number,criterion]=row;
    if (!id || !criterion) return;
    if (!map[id]) map[id]={id,title,types:talents.split('، ').filter(Boolean),criteria:[]};
    map[id].criteria.push({number:Number(number),question:String(criterion)});
  });
  Object.values(map).forEach(info=>info.criteria.sort((a,b)=>a.number-b.number));
  return map;
}
function oneLine_(t){return String(t||'').replace(/\s+/g,' ').trim();}
function configureForm_(form,info) {
  form.setTitle('استمارة تقييم الطلبة الموهوبين – '+info.title);
  form.setDescription([
    TALENT.SCHOOL,'العام الدراسي: '+TALENT.YEAR,
    'استمارة كشف وترشيح أولي؛ ليست أداة سيكومترية مقننة.',
    'عزيزي المعلم، قيّم الطالب استنادًا إلى أدائه الفعلي وفرص التعلم المتاحة له.',
    'رأي لجنة الموهوبين اختياري ويُسجل لاحقًا في السجل المركزي الخاص بالمخولين.',
    TALENT.ASSESSORS
  ].join('\n'));
  form.setConfirmationMessage('تم تسجيل ترشيح الطالب بنجاح. نشكرك على ملاحظتك المهنية.');
  form.setShowLinkToRespondAgain(true);
  // Google automatically gathers identity only if domain policy allows it.
  form.setCollectEmail(true);
  form.addSectionHeaderItem().setTitle('أولًا: بيانات الطالب والمعلم');
  form.addTextItem().setTitle('اسم الطالب كاملًا').setRequired(true);
  form.addListItem().setTitle('الصف الدراسي').setChoiceValues(['الخامس','السادس','السابع','الثامن']).setRequired(true);
  form.addTextItem().setTitle('الشعبة').setRequired(true);
  form.addTextItem().setTitle('اسم المعلم مكتشف الموهبة').setRequired(true);
  form.addListItem().setTitle('نوع الموهبة المكتشفة').setChoiceValues([...new Set(info.types)]).setRequired(true);
  form.addParagraphTextItem().setTitle('وصف مختصر للموهبة المكتشفة').setRequired(false);
  form.addSectionHeaderItem().setTitle('ثانيًا: مؤشرات الكشف عن الموهبة')
      .setHelpText('لكل عبارة اختر إجابة واحدة. «لم تتوفر فرصة للملاحظة» ليست إجابة سلبية.');
  info.criteria.forEach(x=>{
    form.addMultipleChoiceItem()
      .setTitle('المعيار '+x.number+' – '+x.question)
      .setChoiceValues(TALENT.RATING)
      .setRequired(true);
  });
  form.addSectionHeaderItem().setTitle('ثالثًا: ملاحظات المعلم والأدلة');
  form.addParagraphTextItem().setTitle('ملاحظات المعلم (اختياري)').setRequired(false);
  form.addParagraphTextItem().setTitle('وصف الأدلة أو الأعمال الداعمة (اختياري)').setRequired(false);
  form.addSectionHeaderItem().setTitle('رابعًا: رأي لجنة الموهوبين')
      .setHelpText('يضاف رأي اللجنة بعد الترشيح داخل السجل المركزي. ليس مطلوبًا من المعلم تعبئته.');
}

function setupTalentForms() {
  const ss=master_();
  const links=ss.getSheetByName(TALENT.LINKS);
  const subjects=criteriaBySubject_();
  const values=links.getDataRange().getValues();
  const existingTriggers=ScriptApp.getProjectTriggers();
  const triggerIds=new Set(existingTriggers.filter(t=>t.getHandlerFunction()==='onTalentFormSubmit').map(t=>t.getTriggerSourceId()));
  const results=[];
  for (let i=1;i<values.length;i++) {
    const row=i+1, id=oneLine_(values[i][0]), info=subjects[id];
    if (!info) throw Error('المعايير غير متاحة للقسم: '+id);
    if (info.criteria.length!==10) throw Error('يجب وجود عشرة معايير للقسم: '+id);
    let editUrl=oneLine_(values[i][3]);
    let form;
    if (editUrl) {
      try {form=FormApp.openByUrl(editUrl);} catch(e){
        throw Error('رابط نموذج موجود ولكنه غير قابل للفتح: '+info.title+'؛ يجب إصلاح الرابط بدل إنشاء نسخة مكررة.');
      }
    } else {
      form=FormApp.create('رصد الموهبة – '+info.title+' – '+TALENT.YEAR);
      configureForm_(form,info);
      // Store first; resuming after interrupted setup will NOT recreate forms.
      links.getRange(row,3,1,3).setValues([[form.getPublishedUrl(),form.getEditUrl(),'تم إنشاء النموذج – يحتاج مراجعة تقييد المستجيبين']]);
      SpreadsheetApp.flush();
    }
    // Link native per-form response tabs to the same private master workbook.
    // Google creates one response tab for each form.
    let destinationId='';
    try {destinationId=form.getDestinationId()||'';} catch(err) {destinationId='';}
    if (destinationId!==ss.getId()) form.setDestination(FormApp.DestinationType.SPREADSHEET,ss.getId());
    if (!triggerIds.has(form.getId())){
      ScriptApp.newTrigger('onTalentFormSubmit').forForm(form).onFormSubmit().create();
      triggerIds.add(form.getId());
    }
    results.push(info.title);
  }
  SpreadsheetApp.getUi().alert('تم إنشاء/التحقق من '+results.length+' نموذجًا وربطها بالسجل. راجع صلاحيات المستجيبين في كل نموذج قبل مشاركة الروابط.');
}

function onTalentFormSubmit(e) {
  if (!e || !e.response || !e.source) throw Error('لا تشغّل هذه الدالة يدويًا. تعمل عند إرسال النموذج.');
  const lock=LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const ss=master_();
    const links=ss.getSheetByName(TALENT.LINKS).getDataRange().getValues();
    const formId=e.source.getId();
    const subjectRow=links.slice(1).find(r=>{
      try{return r[3] && FormApp.openByUrl(r[3]).getId()===formId;}catch(err){return false;}
    });
    if (!subjectRow) throw Error('النموذج المرسل غير مسجل في قائمة روابط النماذج');
    const [scope,title]=subjectRow;
    const response=e.response;
    const responseId=response.getId();
    const sheet=ss.getSheetByName(TALENT.REGISTER);
    const existing=sheet.getLastRow()>1?sheet.getRange(2,32,sheet.getLastRow()-1,1).getValues().flat():[];
    if (existing.includes(responseId)) return; // prevent duplicate event delivery
    const answers={};
    response.getItemResponses().forEach(ir=>answers[ir.getItem().getTitle()]=ir.getResponse());
    const get=(name)=>String(answers[name]||'').trim();
    const criterionAnswers=Array.from({length:10},(_,index)=>{
      const prefix='المعيار '+(index+1)+' – ';
      const key=Object.keys(answers).find(x=>x.startsWith(prefix));
      return key?String(answers[key]||''):'';
    });
    const counts=TALENT.RATING.map(r=>criterionAnswers.filter(answer=>answer===r).length);
    const gradeName=get('الصف الدراسي');
    const grade={'الخامس':5,'السادس':6,'السابع':7,'الثامن':8}[gradeName]||'';
    // Note: a typed teacher name is not verified by Google. Respondent email must be
    // domain-authenticated and responder restrictions configured by school staff.
    const row=[
      Utilities.getUuid(),new Date(),scope,title,get('اسم الطالب كاملًا'),grade,get('الشعبة'),
      get('اسم المعلم مكتشف الموهبة'),response.getRespondentEmail()||'',
      get('نوع الموهبة المكتشفة'),get('وصف مختصر للموهبة المكتشفة'),
      get('ملاحظات المعلم (اختياري)'),get('وصف الأدلة أو الأعمال الداعمة (اختياري)'),
      ...criterionAnswers,...counts,TALENT.PENDING,'','','',responseId,formId
    ];
    if (row.length!==33) throw Error('خطأ في عدد أعمدة السجل: '+row.length);
    // Avoid formula injection in any free-text cell written by respondents.
    const safe=row.map(value=>typeof value==='string' && /^[=+\-@]/.test(value.trim())?"'"+value:value);
    sheet.appendRow(safe);
  } finally {
    lock.releaseLock();
  }
}

function inspectTalentSetup(){
  const ss=master_();
  const links=ss.getSheetByName(TALENT.LINKS).getDataRange().getValues();
  const created=links.slice(1).filter(r=>r[3]).length;
  SpreadsheetApp.getUi().alert('النماذج التي أنشئت: '+created+' / 11\nعدد سجلات الترشيح: '+(ss.getSheetByName(TALENT.REGISTER).getLastRow()-1));
}
