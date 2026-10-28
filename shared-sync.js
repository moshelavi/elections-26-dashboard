/* Shared results live in GitHub. The write credential stays in memory only. */
(() => {
  'use strict';
  const repo = 'moshelavi/elections-26-dashboard';
  const api = `https://api.github.com/repos/${repo}`;
  const raw = `https://raw.githubusercontent.com/${repo}/main/shared-results.json`;
  const status = document.getElementById('status');
  const upload = document.getElementById('file26');
  const phase = document.getElementById('doubleCountStarted');
  const uploadField = upload.closest('.field');
  const phaseField = phase.closest('.phaseField');
  let credential = '', revision = '', busy = false, syncing = false, failures = 0;
  let currentPayload = null;

  const auth = document.createElement('div');
  auth.className = 'field sharedAdmin';
  auth.innerHTML = `<b>עדכון התוצאות לכל הצופים</b><p class="small">רק בעל הרשאת כתיבה למאגר יכול לפרסם עדכון. הצופים מתעדכנים אוטומטית.</p><label for="githubWriteToken">מפתח GitHub של מנהל האתר</label><input id="githubWriteToken" type="password" autocomplete="off" spellcheck="false" placeholder="Fine-grained token — Contents: Read and write"><button type="button" class="btn" id="adminConnect">התחברות לעדכון</button><button type="button" class="btn" id="adminDisconnect" hidden>יציאה מניהול</button><p class="small">המפתח נשאר בזיכרון החלון בלבד. <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">יצירת מפתח</a>: בחרו רק במאגר elections-26-dashboard והרשאת Contents לקריאה וכתיבה.</p>`;
  uploadField.before(auth);
  const phaseSave = document.createElement('button');
  phaseSave.type = 'button'; phaseSave.className = 'btn';
  phaseSave.textContent = 'פרסום מצב הספירה לכל הצופים';
  phaseField.append(phaseSave);
  const style = document.createElement('style');
  style.textContent = '.sharedAdmin input{width:100%;max-width:none;margin:8px 0}.sharedAdmin button{margin:4px 0}.sharedAdmin [hidden]{display:none!important}.sharedAdmin label{font-size:12px}.phaseField .btn{font-size:12px;margin-top:10px}';
  document.head.append(style);
  function adminState(enabled) {
    uploadField.hidden = !enabled; phaseField.hidden = !enabled;
    upload.disabled = !enabled || busy;
    phase.disabled = !enabled || busy; phaseSave.disabled = !enabled || busy;
    document.getElementById('adminDisconnect').hidden = !enabled;
    document.getElementById('adminConnect').hidden = enabled;
    document.getElementById('githubWriteToken').hidden = enabled;
  }
  adminState(false);

  function validate(payload) {
    const d = payload?.data;
    if (payload?.version !== 1 || !d || !Array.isArray(d.cities) || !d.cities.length ||
        d.cities.length > 10000 || !Number.isFinite(Date.parse(payload.updatedAt)) ||
        typeof payload.started !== 'boolean' || typeof payload.revision !== 'string') {
      throw Error('נתוני העדכון אינם תקינים');
    }
    const codes = new Set(); let votes = 0, valid = 0;
    for (const c of d.cities) {
      if (typeof c.name !== 'string' || typeof c.code !== 'string' || codes.has(c.code) ||
          !Number.isSafeInteger(c.votes) || !Number.isSafeInteger(c.valid) ||
          c.votes < 0 || c.valid < c.votes || !Number.isSafeInteger(c.stations) || c.stations < 0) {
        throw Error('נתוני יישוב לא תקינים');
      }
      codes.add(c.code); votes += c.votes; valid += c.valid;
    }
    if (votes !== d.total?.votes || valid !== d.total?.valid ||
        !Number.isSafeInteger(d.double) || !Number.isSafeInteger(d.doubleValid) ||
        d.double < 0 || d.doubleValid < d.double) throw Error('סכומי העדכון אינם תקינים');
    return payload;
  }
  function apply(payload) {
    validate(payload);
    if (payload.revision === revision) return;
    if (currentPayload && Date.parse(payload.updatedAt) < Date.parse(currentPayload.updatedAt)) return;
    data26 = payload.data; phase.checked = payload.started;
    render(); updateBroadcastTime(new Date(payload.updatedAt));
    currentPayload = payload; revision = payload.revision;
  }
  async function sync() {
    if (busy || syncing) return;
    syncing = true;
    try {
      const response = await fetch(`${raw}?v=${Date.now()}`, {cache:'no-store', credentials:'omit'});
      if (!response.ok) throw Error('לא ניתן לקרוא את התוצאות המשותפות');
      const payload = validate(await response.json());
      apply(payload); failures = 0;
      document.querySelector('.liveBadge').innerHTML = '<i></i> שידור חי';
    } catch (error) {
      failures++;
      if (!currentPayload) status.textContent = 'טרם התקבל חיבור לתוצאות המשותפות. מוצגים נתוני ברירת המחדל.';
      if (failures >= 3) document.querySelector('.liveBadge').textContent = 'החיבור לעדכונים נותק';
    } finally { syncing = false; }
  }
  async function request(path, options = {}) {
    const response = await fetch(api + path, {
      ...options, credentials:'omit', cache:'no-store',
      headers:{Accept:'application/vnd.github+json', Authorization:`Bearer ${credential}`,
        'X-GitHub-Api-Version':'2022-11-28', ...options.headers}
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw Error('אין הרשאת כתיבה. בדקו את המפתח ואת הרשאת Contents: Read and write.');
      if (response.status === 409) throw Error('הנתונים השתנו במקביל. רעננו את העמוד לפני פרסום מחדש.');
      throw Error('GitHub לא השלים את העדכון (' + response.status + ')');
    }
    return response.json();
  }
  document.getElementById('adminConnect').onclick = async () => {
    const input = document.getElementById('githubWriteToken');
    credential = input.value.trim(); input.value = '';
    if (!credential) { status.textContent = 'יש להזין מפתח מנהל כדי לפרסם תוצאות לכולם.'; return; }
    try {
      status.textContent = 'בודק הרשאת מנהל…';
      const repository = await request('');
      if (!repository.permissions?.push) throw Error('למפתח אין הרשאת כתיבה למאגר זה.');
      adminState(true); status.textContent = 'מחובר לניהול. העלאת תוצאות תפרסם אותן לכל הצופים.';
    } catch (error) {credential = ''; adminState(false); status.textContent = error.message;}
  };
  document.getElementById('adminDisconnect').onclick = () => {
    credential = ''; adminState(false); status.textContent = 'יצאת ממצב ניהול.';
  };
  async function publish(data, started, fileName) {
    if (!credential) throw Error('יש להתחבר לניהול לפני פרסום עדכון');
    if (busy) throw Error('עדכון נוסף נמצא בתהליך');
    busy = true; adminState(true);
    try {
      status.textContent = 'מפרסם את העדכון לכל הצופים…';
      const existing = await request('/contents/shared-results.json?ref=main');
      const remote = validate(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(existing.content.replace(/\s/g,'')),c=>c.charCodeAt(0)))));
      if (currentPayload && remote.revision !== revision) {
        apply(remote); throw Error('מנהל אחר עדכן את הנתונים. העדכון החדש נטען; בדקו אותו לפני פרסום חוזר.');
      }
      const payload = validate({version:1, revision:crypto.randomUUID(), updatedAt:new Date().toISOString(), started, data});
      const bytes = new TextEncoder().encode(JSON.stringify(payload));
      let binary = ''; for (let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
      await request('/contents/shared-results.json', {method:'PUT', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({message:fileName?'Update election results':'Update envelope counting status',content:btoa(binary),sha:existing.sha,branch:'main'})});
      apply(payload);
      status.textContent = 'פורסם בהצלחה לכל הצופים. דפים פתוחים יאספו את העדכון אוטומטית.';
    } finally {busy = false; adminState(Boolean(credential));}
  }
  upload.onchange = async () => {
    const file = upload.files[0]; if (!file) return;
    try {
      const parsed = parseData(parseCSV(decodeCSV(await file.arrayBuffer())), '26');
      parsed.doubleValid ??= 0;
      await publish(parsed, phase.checked, file.name);
    } catch (error) {status.textContent = 'העדכון לא פורסם: ' + error.message;}
    finally {upload.value = '';}
  };
  // Keep edits private until the administrator explicitly publishes the new phase.
  phase.addEventListener('change', e => e.stopImmediatePropagation(), true);
  phaseSave.onclick = async () => {
    try {await publish(currentPayload?.data || data26, phase.checked);}
    catch(error) {status.textContent = 'העדכון לא פורסם: ' + error.message;}
  };
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
  setInterval(sync,30000); sync();
})();

(() => {
  if(location.hostname!=='moshelavi.github.io'||navigator.doNotTrack==='1')return;
  let id;
  try{id=sessionStorage.getItem('displaySession');if(!id){id=crypto.randomUUID();sessionStorage.setItem('displaySession',id)}}catch{return}
  const ua=navigator.userAgent;
  const device=/iPad|Tablet/i.test(ua)?'tablet':/Mobi|Android|iPhone/i.test(ua)?'mobile':'desktop';
  const pulse=()=>{if(document.hidden)return;fetch('https://elections-26-service-ml.plumcabin24.chatgpt.site/pulse',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',body:JSON.stringify({id,device}),keepalive:true}).catch(()=>{})};
  pulse();setInterval(pulse,60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)pulse()});
})();
