/* ===== Helpers ===== */
const $ = s => document.querySelector(s);
const fmt = s => { s=Math.max(0,Math.floor(s)); const m=String(Math.floor(s/60)).padStart(2,'0'); const ss=String(s%60).padStart(2,'0'); return m+':'+ss; };
function toast(msg){const t=$('#toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1300);}
function fileNameFrom(url){ try{const u=new URL(url); return u.pathname.split('/').pop();}catch{return url.split('/').pop();}}
function ytId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.slice(1); // short link like youtu.be/abcd1234
    }
    return u.searchParams.get('v'); // normal YouTube link
  } catch {
    return null;
  }
}


/* ===== State ===== */
const SEEK_STEP=30, MIC_THRESHOLD=0.025, QUIET_DELAY=1000, DUCK_TICK=60, VIZ_BARS=72;
let state={
  playlist:[], index:0, isPlaying:false,
  mode:'yt', // 'yt' | 'video' | 'audio'
  repeat:false, shuffle:true, duration:0,
  lastSpeech:0, duckAmt:.35, vol:.9,
  speechOn:false, micOn:false, rate:1.0,
  A:null, B:null, loopAB:false, sleepId:null,
  queue:[], firstAutoplayDone:false
};

/* ===== DOM ===== */
const els={
  // stages
  ytStage:$('#ytStage'), videoStage:$('#videoStage'), audioStage:$('#audioStage'),
  ytMount:$('#ytMount'), localVideo:$('#localVideo'), audioCover:$('#audioCover'),
  unmuteYT:$('#unmuteYT'), unmuteVID:$('#unmuteVID'), unmuteAUD:$('#unmuteAUD'),
  // meta
  trackTitle:$('#trackTitle'), trackSub:$('#trackSub'), miniTitle:$('#miniTitle'), miniSub:$('#miniSub'),
  viz:$('#viz'),
  // transport
  prev:$('#prev'), rew:$('#rew'), play:$('#play'), fwd:$('#fwd'), next:$('#next'),
  bigPrev:$('#bigPrev'), bigPlay:$('#bigPlay'), bigNext:$('#bigNext'),
  miniPrev:$('#miniPrev'), miniPlay:$('#miniPlay'), miniNext:$('#miniNext'),
  seek:$('#seek'), tCur:$('#tCur'), tDur:$('#tDur'),
  vol:$('#vol'), duck:$('#duck'),
  repeat:$('#repeat'), shuffle:$('#shuffle'),
  rate:$('#rate'), sleep:$('#sleep'), theater:$('#theater'), share:$('#share'),
  status:$('#status'), micPill:$('#micPill'),
  // right
  list:$('#list'), addYT:$('#addYT'), addLocal:$('#addLocal'),
  saveList:$('#saveList'), clearList:$('#clearList'),
  marks:$('#marks'), marksList:$('#marksList'),
};

/* ===== Setters ===== */
function setStatus(msg,kind='info'){els.status.textContent=msg; els.status.style.color=(kind==='error')?'var(--danger)':'var(--muted)'}
function updatePlayBtns(){ const t=state.isPlaying?'Pause':'Play'; els.play.textContent=t; els.miniPlay.textContent=t; els.bigPlay.textContent=t; }
function setMeta({title,sub,cover}){
  els.trackTitle.textContent = title || '—';
  els.trackSub.textContent   = sub   || '—';
  els.miniTitle.textContent  = title || '—';
  els.miniSub.textContent    = sub   || '—';
  if(cover) els.audioCover.src = cover;
}

/* ===== Local media graph (WebAudio) ===== */
const audioEl=new Audio(); audioEl.crossOrigin='anonymous'; audioEl.playsInline=true; audioEl.preload='auto';
const actx=new (window.AudioContext||window.webkitAudioContext)();
let currentSrc=null;
const gain=actx.createGain(); gain.gain.value=state.vol;
const analyser=actx.createAnalyser(); analyser.fftSize=2048; analyser.smoothingTimeConstant=.85;
const bass=actx.createBiquadFilter(); bass.type="lowshelf"; bass.frequency.value=180;
const mid=actx.createBiquadFilter();  mid.type="peaking";  mid.frequency.value=1000; mid.Q.value=1.0;
const tre=actx.createBiquadFilter();  tre.type="highshelf"; tre.frequency.value=4200;
function attachMedia(el){
  if(currentSrc){ try{ currentSrc.disconnect(); }catch{} currentSrc=null; }
  try{
    currentSrc = actx.createMediaElementSource(el);
    currentSrc.connect(bass).connect(mid).connect(tre).connect(gain).connect(analyser).connect(actx.destination);
  }catch(e){ /* already attached once; leave graph as-is */ }
}
function setEQ(mode){
  if(mode==='flat'){ bass.gain.value=0; mid.gain.value=0; tre.gain.value=0; }
  if(mode==='bass'){ bass.gain.value=8; mid.gain.value=-1; tre.gain.value=1; }
  if(mode==='vocal'){ bass.gain.value=-1; mid.gain.value=4; tre.gain.value=2; }
  toast('EQ: '+mode);
}
document.querySelectorAll('[data-eq]').forEach(b=>b.addEventListener('click',()=>setEQ(b.dataset.eq)));

/* viz (hidden for YouTube) */
(function(){
  const g = els.viz.getContext('2d');
  const resize=()=>{ const r=els.viz.getBoundingClientRect(); els.viz.width=r.width|0; els.viz.height=96; };
  resize(); addEventListener('resize',resize);
  (function loop(){
    if(state.mode==='yt'){ els.viz.classList.add('hidden'); }
    else { els.viz.classList.remove('hidden');
      const buf=new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(buf);
      g.clearRect(0,0,els.viz.width,els.viz.height);
      const step=Math.floor(buf.length/VIZ_BARS), w=(els.viz.width/VIZ_BARS)-2;
      for(let i=0;i<VIZ_BARS;i++){const v=buf[i*step]/255, h=v*els.viz.height, x=i*(w+2), y=els.viz.height-h;
        g.fillStyle = i%2 ? '#60a5fa' : '#22d3ee'; g.fillRect(x,y,w,h);}
    }
    requestAnimationFrame(loop);
  })();
})();

// ===== YouTube Embed Fix =====
let ytPlayer = null, ytApiP = null, ytReadyP = null;

function loadYTAPI(){
  if(window.YT && window.YT.Player) return Promise.resolve();
  if(ytApiP) return ytApiP;
  ytApiP = new Promise((resolve,reject)=>{
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = ()=>reject(new Error('YT API failed'));
    window.onYouTubeIframeAPIReady = ()=>resolve();
    document.head.appendChild(s);
  });
  return ytApiP;
}

function createYT(){
  if(ytPlayer) return ytReadyP;
  ytReadyP = new Promise((resolve)=>{
    ytPlayer = new YT.Player('ytMount',{
      width: '100%',
      height: '100%',
      videoId: '',
      // Use regular youtube.com host to reduce CORS noise
      playerVars: {
        autoplay: 0,
        controls: 0,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        origin: window.location.protocol + '//' + window.location.host
      },
      events:{
        onReady: ()=>resolve(),
        onStateChange: (e)=>{
          if(e.data === YT.PlayerState.ENDED) next(true);
          if(e.data === YT.PlayerState.PLAYING){
            state.isPlaying = true;
            updatePlayBtns();
            document.getElementById('unmuteYT')
              .classList.toggle('hidden', !ytPlayer.isMuted());
          }
          if(e.data === YT.PlayerState.PAUSED){
            state.isPlaying = false;
            updatePlayBtns();
          }
        }
      }
    });
  });
  return ytReadyP;
}

async function ensureYT(){
  await loadYTAPI();
  await createYT();
}


/* ===== Playlist / Storage ===== */
const DEFAULT=[
  {type:'yt', url:'https://www.youtube.com/watch?v=AJtDXIazrMo', title:'APT. — ROSÉ & Bruno Mars'},
  {type:'yt', url:'https://www.youtube.com/watch?v=BSJa1UytM8w', title:'Saiyaara — Faheem Abdullah'},
  {type:'yt', url:'https://www.youtube.com/watch?v=m4iPSPoe1Y8', title:'Naina — Arijit Singh'}
];
function loadStore(){ try{ const raw=localStorage.getItem('auroraPlaylist'); state.playlist=raw?JSON.parse(raw):DEFAULT.slice(); }catch{ state.playlist=DEFAULT.slice(); } }
function saveStore(){ localStorage.setItem('auroraPlaylist', JSON.stringify(state.playlist)); }

function renderList(){
  els.list.innerHTML='';
  state.playlist.forEach((it,i)=>{
    const li=document.createElement('li'); li.draggable=true; li.dataset.i=i;
    let thumb='https://dummyimage.com/112x84/ede9fe/3730a3&text=Media';
    if(it.type==='yt'){ const id=ytId(it.url); if(id) thumb=`https://i.ytimg.com/vi/${id}/mqdefault.jpg`; }
    const img=document.createElement('img'); img.className='thumb'; img.src=thumb;

    const main=document.createElement('div');
    const t=document.createElement('div'); t.className='row-title truncate';
    t.textContent=it.title || (it.type.startsWith('local') ? fileNameFrom(it.url) : it.url);
    t.title = t.textContent;

    const sub=document.createElement('div'); sub.className='row-sub truncate';
    sub.textContent = it.type==='yt' ? it.url : 'Local file';
    sub.title = sub.textContent;
    main.appendChild(t); main.appendChild(sub);

    const act=document.createElement('div'); act.className='row-actions';
    const bPlay=document.createElement('button'); bPlay.className='btn ghost'; bPlay.textContent='Play';
    bPlay.onclick=()=>{state.index=i; loadCurrent(true)};
    const bQ=document.createElement('button'); bQ.className='btn ghost'; bQ.textContent='Queue next';
    bQ.onclick=()=>{ state.queue.push(i); toast('Queued'); };
    const bRem=document.createElement('button'); bRem.className='btn ghost'; bRem.textContent='Remove';
    bRem.onclick=()=>{ state.playlist.splice(i,1); saveStore(); renderList(); };
    act.appendChild(bPlay); act.appendChild(bQ); act.appendChild(bRem);

    li.appendChild(img); li.appendChild(main); li.appendChild(act); els.list.appendChild(li);
  });

  // drag reorder
  let dragEl=null;
  els.list.querySelectorAll('li').forEach(li=>{
    li.addEventListener('dragstart',e=>{dragEl=li; e.dataTransfer.effectAllowed='move'});
    li.addEventListener('dragover',e=>e.preventDefault());
    li.addEventListener('drop',e=>{
      e.preventDefault(); if(!dragEl||dragEl===li) return;
      const from=+dragEl.dataset.i, to=+li.dataset.i;
      const it=state.playlist.splice(from,1)[0]; state.playlist.splice(to,0,it); saveStore(); renderList();
    });
  });
}

/* ===== Marks ===== */
function keyMarks(it){ return 'marks:'+(it.type==='yt'? ytId(it.url): it.url); }
function getMarks(it){ try{ return JSON.parse(localStorage.getItem(keyMarks(it)))||[] }catch{return []} }
function saveMarks(it,arr){ localStorage.setItem(keyMarks(it), JSON.stringify(arr)); }
function renderMarksUI(){
  const it=state.playlist[state.index]; if(!it) return;
  const marks=getMarks(it);
  if(els.marks) els.marks.innerHTML='';
  if(els.marksList) els.marksList.innerHTML='';
  marks.forEach(m=>{
    const btn=document.createElement('button'); btn.className='mark'; btn.textContent=(m.label||'◆')+' '+fmt(m.t); btn.onclick=()=>seekTo(m.t,true);
    if(els.marks) els.marks.appendChild(btn);
    if(els.marksList) els.marksList.appendChild(btn.cloneNode(true));
  });
}

/* ===== Title Helpers ===== */
async function resolveTitle(url){
  try{
    const resp = await fetch('https://noembed.com/embed?url='+encodeURIComponent(url));
    if(!resp.ok) throw 0; const data = await resp.json(); return data.title || null;
  }catch{
    try{
      const r = await fetch('https://www.youtube.com/oembed?format=json&url='+encodeURIComponent(url));
      if(!r.ok) throw 0; const d=await r.json(); return d.title||null;
    }catch{ return null; }
  }
}

/* ===== Stage switcher ===== */
function showStage(mode){
  state.mode = mode; // 'yt' | 'video' | 'audio'
  els.ytStage.classList.toggle('hidden', mode!=='yt');
  els.videoStage.classList.toggle('hidden', mode!=='video');
  els.audioStage.classList.toggle('hidden', mode!=='audio');
}

/* Stop everything to avoid overlap */
function stopAllMedia(){
  try{ audioEl.pause(); }catch{}
  try{ els.localVideo.pause(); }catch{}
  try{ if(ytPlayer){ ytPlayer.stopVideo(); } }catch{}
  state.isPlaying=false; updatePlayBtns();
}

/* ===== Load current item ===== */
async function loadCurrent(autoplay=false){
  stopAllMedia();
  const it=state.playlist[state.index]; if(!it){ setStatus('Empty playlist'); return; }
  // Reset A–B
  state.A=state.B=null; state.loopAB=false; $('#toggleAB').textContent='A–B: OFF';

  if(it.type==='yt'){
    await loadYTAPI(); await ensureYT();
    const id=ytId(it.url); if(!id){ setStatus('Invalid YouTube URL','error'); return; }
    showStage('yt');
    ytPlayer.cueVideoById(id);
    ytPlayer.setVolume(Math.round(state.vol*100));
    $('#unmuteYT').classList.remove('hidden');
    setMeta({title:it.title || 'YouTube', sub:'YouTube', cover:`https://i.ytimg.com/vi/${id}/hqdefault.jpg`});
    state.duration=0; els.tDur.textContent='—:—';
    applyRate();
    if(autoplay || !state.firstAutoplayDone){ try{ ytPlayer.mute(); ytPlayer.playVideo(); state.firstAutoplayDone=true; }catch{} }
  }
  else if(it.type==='local-video'){
    showStage('video');
    els.localVideo.src = it.url;
    els.localVideo.muted = true;
    attachMedia(els.localVideo);
    try{ await els.localVideo.play(); }catch{} els.localVideo.pause();
    $('#unmuteVID').classList.remove('hidden');
    setMeta({title:it.title || fileNameFrom(it.url), sub:'Local Video', cover:null});
    state.duration=isFinite(els.localVideo.duration)?els.localVideo.duration:0;
    els.tDur.textContent=fmt(state.duration||0);
    els.localVideo.playbackRate = state.rate;
    if(autoplay){ play(); }
  }
  else { // local audio
    showStage('audio');
    audioEl.src = it.url;
    audioEl.muted = true;
    attachMedia(audioEl);
    try{ await audioEl.play(); }catch{} audioEl.pause();
    audioEl.muted=false;
    $('#unmuteAUD').classList.add('hidden'); // audio can be unmuted
    const cover = 'https://dummyimage.com/1280x720/0b1020/ffffff&text=Audio';
    setMeta({title:it.title || fileNameFrom(it.url), sub:'Local Audio', cover});
    state.duration=isFinite(audioEl.duration)?audioEl.duration:0;
    els.tDur.textContent=fmt(state.duration||0);
    audioEl.playbackRate = state.rate;
    if(autoplay){ play(); }
  }

  renderMarksUI(); updatePlayBtns(); updateProgress(); saveStore(); setStatus('Ready.');
}

/* ===== Transport / Progress ===== */
let fading=false;
function crossfade(nextFn){
  if(fading) return nextFn();
  fading=true;
  const start=performance.now(), D=350, startVol=state.vol;
  function step(t){
    const k=Math.min(1,(t-start)/D); const v=(1-k);
    if(state.mode==='yt' && ytPlayer) ytPlayer.setVolume(Math.round(startVol*100*v));
    if(state.mode!=='yt'){ gain.gain.value=startVol*v; }
    if(k<1) requestAnimationFrame(step); else { nextFn(); fading=false; }
  }
  requestAnimationFrame(step);
}
function play(){
  if(state.mode==='yt' && ytPlayer){ ytPlayer.playVideo(); }
  else if(state.mode==='video'){ els.localVideo.play(); }
  else { audioEl.play(); }
  state.isPlaying=true; updatePlayBtns(); setStatus('Playing'); if(actx.state==='suspended') actx.resume();
}
function pause(){
  if(state.mode==='yt' && ytPlayer){ ytPlayer.pauseVideo(); }
  else if(state.mode==='video'){ els.localVideo.pause(); }
  else { audioEl.pause(); }
  state.isPlaying=false; updatePlayBtns(); setStatus('Paused');
}
function next(auto=false){
  crossfade(()=>{
    if(state.queue.length){ state.index=state.queue.shift(); return loadCurrent(true); }
    if(state.shuffle && !auto){ state.index=Math.floor(Math.random()*state.playlist.length); }
    else if(state.repeat && auto){ /* repeat */ }
    else { state.index=(state.index+1)%state.playlist.length; }
    loadCurrent(true);
  });
}
function prev(){ crossfade(()=>{ state.index=(state.index-1+state.playlist.length)%state.playlist.length; loadCurrent(true); }); }
function getTime(){
  if(state.mode==='yt' && ytPlayer) return ytPlayer.getCurrentTime?.()||0;
  if(state.mode==='video') return els.localVideo.currentTime||0;
  return audioEl.currentTime||0;
}
function getDur(){
  if(state.mode==='yt' && ytPlayer) return ytPlayer.getDuration?.()||state.duration||0;
  if(state.mode==='video') return isFinite(els.localVideo.duration)?els.localVideo.duration:(state.duration||0);
  return isFinite(audioEl.duration)?audioEl.duration:(state.duration||0);
}
function seekTo(s, user){
  if(state.mode==='yt' && ytPlayer) ytPlayer.seekTo(s,true);
  else if(state.mode==='video') els.localVideo.currentTime=s;
  else audioEl.currentTime=s;
  if(user && state.isPlaying) play();
}
function seekBy(d){ const cur=getTime(); seekTo(Math.max(0,Math.min(getDur()||0,cur+d)), true); }
function restart(){ seekTo(0,true); }

function updateProgress(){
  const pos=getTime(), dur=getDur();
  els.tCur.textContent=fmt(pos); els.tDur.textContent=dur?fmt(dur):'—:—';
  els.seek.max=Math.round((dur||1)*1000); els.seek.value=Math.round(pos*1000); state.duration=dur;
  if(state.loopAB && state.A!=null && state.B!=null && pos>=state.B) seekTo(state.A,false);
  requestAnimationFrame(updateProgress);
}
els.seek.addEventListener('input',()=>seekTo(+els.seek.value/1000,true));

/* ===== Rate / Sleep / Theater ===== */
function applyRate(){
  if(state.mode==='yt' && ytPlayer?.setPlaybackRate) ytPlayer.setPlaybackRate(state.rate);
  else if(state.mode==='video') els.localVideo.playbackRate = state.rate;
  else audioEl.playbackRate = state.rate;
}
els.rate.addEventListener('change',e=>{ state.rate=+e.target.value; applyRate(); toast('Speed '+state.rate+'x'); });
els.sleep.addEventListener('change',e=>{
  if(state.sleepId){ clearTimeout(state.sleepId); state.sleepId=null; }
  const m=+e.target.value; if(!m){ toast('Sleep off'); return; }
  state.sleepId=setTimeout(()=>{ pause(); toast('Sleep: paused'); }, m*60*1000);
  toast('Sleep in '+m+' min');
});
els.theater.addEventListener('click',()=>{ const on=!document.body.classList.contains('theater'); document.body.classList.toggle('theater', on); toast(on?'Theater ON':'Theater OFF'); });

/* ===== Ducking ===== */
let duckFactor=1;
function applyDuck(f){ duckFactor=f; if(state.mode==='yt' && ytPlayer) ytPlayer.setVolume(Math.round(state.vol*100*f)); gain.gain.value=state.vol*f; }
els.vol.addEventListener('input',()=>{ state.vol=+els.vol.value/100; if(state.mode==='yt' && ytPlayer) ytPlayer.setVolume(Math.round(state.vol*100)); gain.gain.value=state.vol*duckFactor; });
els.duck.addEventListener('input',()=>{ state.duckAmt=+els.duck.value/100; });

/* ===== Mic (toggle) ===== */
let micCtx=null, micAnalyser=null, micLoop=null;
async function startMic(){
  try{
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    micCtx = new (window.AudioContext||window.webkitAudioContext)();
    const s = micCtx.createMediaStreamSource(stream);
    micAnalyser = micCtx.createAnalyser(); micAnalyser.fftSize=1024; s.connect(micAnalyser);
    els.micPill.textContent='mic: on'; els.micPill.classList.add('on'); state.micOn=true;

    micLoop=setInterval(()=>{
      const buf=new Uint8Array(micAnalyser.fftSize);
      micAnalyser.getByteTimeDomainData(buf);
      let sum=0;
      for(let i=0;i<buf.length;i++){
        const v=(buf[i]-128)/128;
        sum+=v*v;
      }
      const rms=Math.sqrt(sum/buf.length);
      if(rms>MIC_THRESHOLD) state.lastSpeech=performance.now();

      const since = performance.now() - state.lastSpeech;
      const target = since < QUIET_DELAY ? (1 - state.duckAmt) : 1;
      applyDuck(duckFactor + (target - duckFactor) * 0.08);
    }, DUCK_TICK);

    toast('Mic enabled');
  }catch(e){
    els.micPill.textContent='mic: off'; els.micPill.classList.remove('on'); state.micOn=false;
    $('#micToggle').checked=false; setStatus('Mic blocked','error');
  }
}
function stopMic(){
  try{ if(micLoop) clearInterval(micLoop); if(micCtx) micCtx.close(); }catch{}
  els.micPill.textContent='mic: off'; els.micPill.classList.remove('on'); state.micOn=false; toast('Mic disabled');
}
$('#micToggle').addEventListener('change',e=>{ e.target.checked? startMic() : stopMic(); });

/* ===== Speech (toggle) ===== */
let rec=null; const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
function startSpeech(){
  if(!SR){ setStatus('SpeechRecognition unsupported','error'); $('#speechToggle').checked=false; return; }
  if(rec){ try{rec.stop()}catch{} }
  rec=new SR(); rec.lang='en-GB'; rec.continuous=true; rec.interimResults=false;
  rec.onresult=(e)=>{ for(let i=e.resultIndex;i<e.results.length;i++){ if(e.results[i].isFinal) handleCmd(e.results[i][0].transcript.toLowerCase()) } };
  rec.onerror=()=>{ if(state.speechOn) setTimeout(()=>{ try{rec.start()}catch{} },700) };
  rec.onend = ()=>{ if(state.speechOn) setTimeout(()=>{ try{rec.start()}catch{} },500) };
  try{ rec.start(); toast('Speech ON'); setStatus('Speech input ON'); }catch{ setStatus('Could not start speech','error'); }
}
function stopSpeech(){ if(rec){ try{rec.onend=null;rec.onerror=null;rec.stop();}catch{} } toast('Speech OFF'); setStatus('Speech input OFF'); }
$('#speechToggle').addEventListener('change',e=>{ state.speechOn=e.target.checked; state.speechOn? startSpeech(): stopSpeech(); });

function handleCmd(t){
  if(/next/.test(t)) return next();
  if(/prev|previous|back/.test(t)) return prev();
  if(/forward/.test(t)) return seekBy(+SEEK_STEP);
  if(/rewind|reverse/.test(t)) return seekBy(-SEEK_STEP);
  if(/restart|again/.test(t)) return restart();
  if(/pause|stop|wait/.test(t)) return pause();
  if(/play|resume|continue/.test(t)) return play();
}

/* ===== UI bindings ===== */
els.play.addEventListener('click',()=>state.isPlaying?pause():play());
els.miniPlay.addEventListener('click',()=>state.isPlaying?pause():play());
els.bigPlay.addEventListener('click',()=>state.isPlaying?pause():play());

els.prev.addEventListener('click',prev); els.miniPrev.addEventListener('click',prev); els.bigPrev.addEventListener('click',prev);
els.next.addEventListener('click',()=>next(true)); els.miniNext.addEventListener('click',()=>next(true)); els.bigNext.addEventListener('click',()=>next(true));
els.fwd.addEventListener('click',()=>seekBy(+SEEK_STEP)); els.rew.addEventListener('click',()=>seekBy(-SEEK_STEP));

els.repeat.addEventListener('change',()=>state.repeat=els.repeat.checked);
els.shuffle.addEventListener('change',()=>state.shuffle=els.shuffle.checked);

window.addEventListener('keydown',(e)=>{
  if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
  if(e.code==='Space'){ e.preventDefault(); state.isPlaying?pause():play(); }
  if(e.code==='ArrowRight'){ seekBy(e.shiftKey? +SEEK_STEP : +5); }
  if(e.code==='ArrowLeft'){ seekBy(e.shiftKey? -SEEK_STEP : -5); }
  if(e.key==='s'||e.key==='S') $('#setA')?.click();
  if(e.key==='d'||e.key==='D') $('#setB')?.click();
  if(e.key==='f'||e.key==='F') $('#toggleAB')?.click();
});

els.unmuteYT?.addEventListener('click',()=>{ try{ ytPlayer.unMute(); ytPlayer.setVolume(Math.round(state.vol*100)); els.unmuteYT.classList.add('hidden'); }catch{} });
els.unmuteVID?.addEventListener('click',()=>{ els.localVideo.muted=false; els.unmuteVID.classList.add('hidden'); });
els.unmuteAUD?.addEventListener('click',()=>{ audioEl.muted=false; els.unmuteAUD.classList.add('hidden'); });

/* Add / Save / Clear */
els.addYT.addEventListener('click',async ()=>{
  const url=prompt('Paste YouTube URL:'); if(!url) return;
  let title = await resolveTitle(url); if(!title){ const id=ytId(url)||''; title = 'YouTube • '+id.slice(0,8); }
  state.playlist.push({type:'yt', url, title});
  saveStore(); renderList();
  if(state.playlist.length===1){ state.index=0; loadCurrent(true); }
});
els.addLocal.addEventListener('change',e=>{
  const files=[...e.target.files];
  for(const f of files){
    const url=URL.createObjectURL(f);
    const isVideo = (f.type||'').startsWith('video');
    state.playlist.push({type:isVideo?'local-video':'local', url, title:f.name});
  }
  saveStore(); renderList();
  if(state.playlist.length===files.length){ state.index=0; loadCurrent(true); }
});
els.saveList.addEventListener('click',()=>{ saveStore(); toast('Playlist saved'); });
els.clearList.addEventListener('click',()=>{ if(!confirm('Clear playlist?')) return; state.playlist.length=0; saveStore(); renderList(); toast('Cleared'); });

/* Share */
els.share.addEventListener('click',()=>{
  const it=state.playlist[state.index]; if(!it) return;
  let url=it.url;
  if(it.type==='yt'){ const id=ytId(it.url); const s=Math.floor(getTime()); url=`https://www.youtube.com/watch?v=${id}&t=${s}s`; }
  (navigator.clipboard?.writeText(url)||Promise.reject()).then(()=>toast('Copied'),()=>toast('Copy failed'));
});



/* Media Session */
if('mediaSession' in navigator){
  navigator.mediaSession.setActionHandler('play', play);
  navigator.mediaSession.setActionHandler('pause', pause);
  navigator.mediaSession.setActionHandler('previoustrack', prev);
  navigator.mediaSession.setActionHandler('nexttrack', ()=>next(true));
  navigator.mediaSession.setActionHandler('seekforward', ()=>seekBy(+SEEK_STEP));
  navigator.mediaSession.setActionHandler('seekbackward', ()=>seekBy(-SEEK_STEP));
}

/* Boot */
function boot(){ loadStore(); renderList(); loadCurrent(true);
  els.vol.value=Math.round(state.vol*100); els.duck.value=Math.round(state.duckAmt*100); updatePlayBtns();
}
boot();
