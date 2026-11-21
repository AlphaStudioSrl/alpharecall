import{i as e,l as t,n,r}from"./bundle-mjs-Wdbt-Exa.js";import{Ct as i,G as a,K as o,St as s,Vt as c,Wt as l,at as u,et as d,ft as f,ht as p,it as m,tt as h,yt as g}from"./dist-hi1ENn3a.js";import{t as _}from"./headset-dKvucaXj.js";import{t as v}from"./pencil-CHezSetv.js";import{C as y,Qr as b,S as x,St as S,cn as ee,cr as C,gr as w,hr as T,mr as E,nn as D,oi as te,p as ne,pr as re,un as O,xn as ie,yn as ae,zr as oe}from"./app-BJjbRkDI.js";import{n as k,r as se,t as ce}from"./markdown-components-DHORbGeR.js";import{B as A,C as j,E as M,J as N,K as P,L as F,P as le,R as I,T as L,U as R,X as ue,_ as de,a as fe,c as pe,d as me,f as z,g as he,h as ge,i as _e,l as ve,m as ye,n as be,o as xe,r as Se,s as Ce,t as we,u as Te,w as Ee,z as De}from"./chart-DKqUgOK2.js";import"./card-D4yEucHA.js";var B=t(e(),1),Oe=/^[A-Za-z0-9_-]{16,64}$/,ke=/^[a-f0-9]{32}$/,Ae=/^[0-9]+$/,je=[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298];function Me(e){let t=[];for(let n of e){let e=n.codePointAt(0);e<=127?t.push(e):e<=2047?t.push(192|e>>>6,128|e&63):e<=65535?t.push(224|e>>>12,128|e>>>6&63,128|e&63):t.push(240|e>>>18,128|e>>>12&63,128|e>>>6&63,128|e&63)}return t}function Ne(e){let t=Me(e),n=t.length*8;for(t.push(128);t.length%64!=56;)t.push(0);let r=Math.floor(n/4294967296),i=n>>>0;for(let e=24;e>=0;e-=8)t.push(r>>>e&255);for(let e=24;e>=0;e-=8)t.push(i>>>e&255);let a=[1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225],o=Array(64);for(let e=0;e<t.length;e+=64){for(let n=0;n<16;n+=1){let r=e+n*4;o[n]=(t[r]<<24|t[r+1]<<16|t[r+2]<<8|t[r+3])>>>0}for(let e=16;e<64;e+=1){let t=o[e-15],n=o[e-2],r=(t>>>7|t<<25)^(t>>>18|t<<14)^t>>>3,i=(n>>>17|n<<15)^(n>>>19|n<<13)^n>>>10;o[e]=o[e-16]+r+o[e-7]+i>>>0}let[n,r,i,s,c,l,u,d]=a;for(let e=0;e<64;e+=1){let t=(c>>>6|c<<26)^(c>>>11|c<<21)^(c>>>25|c<<7),a=c&l^~c&u,f=d+t+a+je[e]+o[e]>>>0,p=((n>>>2|n<<30)^(n>>>13|n<<19)^(n>>>22|n<<10))+(n&r^n&i^r&i)>>>0;d=u,u=l,l=c,c=s+f>>>0,s=i,i=r,r=n,n=f+p>>>0}a[0]=a[0]+n>>>0,a[1]=a[1]+r>>>0,a[2]=a[2]+i>>>0,a[3]=a[3]+s>>>0,a[4]=a[4]+c>>>0,a[5]=a[5]+l>>>0,a[6]=a[6]+u>>>0,a[7]=a[7]+d>>>0}return a.map(e=>e.toString(16).padStart(8,`0`)).join(``)}function Pe(e){let t=0;for(let n of e.toLowerCase()){let e=Number.parseInt(n,16);if(!Number.isFinite(e))return t;if(e===0){t+=4;continue}e<2?t+=3:e<4?t+=2:e<8&&(t+=1);break}return t}function Fe(e,t,n){return ke.test(e)&&Ae.test(t)&&Number.isInteger(n)&&n>=1&&n<=32&&Pe(Ne(`${e}.${t}`))>=n}function Ie(e){if(!e||typeof e!=`object`)return null;let t=e,n=t.detail&&typeof t.detail==`object`?t.detail:null,r=(t.challenge&&typeof t.challenge==`object`?t.challenge:null)||(n?.challenge&&typeof n.challenge==`object`?n.challenge:null)||t;if(typeof r.id!=`string`||!Oe.test(r.id)||typeof r.seed!=`string`||!ke.test(r.seed)||!Number.isInteger(r.difficulty)||r.difficulty<1||r.difficulty>32||r.algorithm!==void 0&&r.algorithm!==`sha256`)return null;let i=r.expires_in===void 0?120:r.expires_in;return typeof i!=`number`||!Number.isFinite(i)||i<=0?null:{id:r.id,seed:r.seed,difficulty:r.difficulty,algorithm:`sha256`,expires_in:i}}function Le(e,t){return`${e.id}.${t}`}function Re(){if(typeof DOMException<`u`)return new DOMException(`Aborted`,`AbortError`);let e=Error(`Aborted`);return e.name=`AbortError`,e}function ze(){let e=typeof globalThis<`u`?globalThis.crypto:void 0;return e&&typeof e.getRandomValues==`function`?e.getRandomValues(new Uint32Array(1))[0]:Math.floor(Math.random()*4294967296)}var Be=`
const K = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
];
function utf8(input) {
  const bytes = [];
  for (const char of input) {
    const code = char.codePointAt(0);
    if (code <= 0x7f) bytes.push(code);
    else if (code <= 0x7ff) bytes.push(0xc0 | (code >>> 6), 0x80 | (code & 0x3f));
    else if (code <= 0xffff) bytes.push(0xe0 | (code >>> 12), 0x80 | ((code >>> 6) & 0x3f), 0x80 | (code & 0x3f));
    else bytes.push(0xf0 | (code >>> 18), 0x80 | ((code >>> 12) & 0x3f), 0x80 | ((code >>> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return bytes;
}
function sha256(input) {
  const bytes = utf8(input);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);
  const hash = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const words = new Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const index = offset + i * 4;
      words[i] = ((bytes[index] << 24) | (bytes[index + 1] << 16) | (bytes[index + 2] << 8) | bytes[index + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const x = words[i - 15];
      const y = words[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = hash;
    for (let i = 0; i < 64; i += 1) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + K[i] + words[i]) >>> 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}
function zeroBits(hex) {
  let count = 0;
  for (const char of hex) {
    const value = parseInt(char, 16);
    if (value === 0) { count += 4; continue; }
    if (value < 2) count += 3;
    else if (value < 4) count += 2;
    else if (value < 8) count += 1;
    break;
  }
  return count;
}
self.onmessage = function (event) {
  const seed = event.data.seed;
  const difficulty = event.data.difficulty;
  let nonce = event.data.start;
  while (zeroBits(sha256(seed + "." + nonce)) < difficulty) nonce += 1;
  self.postMessage({ nonce: String(nonce) });
};`;function Ve(e,t,n){return typeof Worker>`u`||typeof Blob>`u`||typeof URL>`u`||typeof URL.createObjectURL!=`function`?Promise.reject(Error(`worker_unavailable`)):new Promise((r,i)=>{let a=URL.createObjectURL(new Blob([Be],{type:`text/javascript`})),o=new Worker(a),s=!1,c=e=>{s||(s=!0,window.clearTimeout(u),n?.removeEventListener(`abort`,l),o.terminate(),URL.revokeObjectURL(a),e())},l=()=>c(()=>i(Re())),u=window.setTimeout(()=>c(()=>i(Error(`pow_expired`))),e.expires_in*1e3);if(o.onmessage=t=>{let n=t.data?.nonce;if(typeof n!=`string`||!Fe(e.seed,n,e.difficulty)){c(()=>i(Error(`worker_invalid_solution`)));return}c(()=>r(n))},o.onerror=()=>c(()=>i(Error(`worker_error`))),n?.addEventListener(`abort`,l,{once:!0}),n?.aborted){l();return}o.postMessage({seed:e.seed,difficulty:e.difficulty,start:t})})}async function He(e,t,n,r){let i=t,a=r+e.expires_in*1e3;for(;Date.now()<a;){let t=Date.now();for(;Date.now()-t<20;){if(n?.aborted)throw Re();let t=String(i);if(Fe(e.seed,t,e.difficulty))return t;i+=1}await new Promise(e=>window.setTimeout(e,0))}throw Error(`pow_expired`)}var V=new Map;function Ue(e,t={}){let n=V.get(e.id);if(n)return n;let r=Date.now(),i=ze(),a=Ve(e,i,t.signal).catch(n=>{if(t.signal?.aborted)throw Re();if(n?.name===`AbortError`||n?.message===`pow_expired`)throw n;return He(e,i,t.signal,r)});return V.set(e.id,a),a.finally(()=>{V.get(e.id)===a&&V.delete(e.id)}).catch(()=>void 0),a}var We=`X-AlphaRecall-PoW-Inline`,Ge=e=>typeof e?.headers?.get==`function`&&e.headers.get(`X-AlphaRecall-PoW-Challenge`)===`1`,Ke=async e=>{if(!Ge(e))return e;let t=await e.text().catch(()=>``);return new Response(t,{status:428,statusText:`Precondition Required`,headers:{"Content-Type":e.headers.get(`Content-Type`)||`application/json`}})};async function qe(e,t,n={}){let r=typeof Request<`u`&&e instanceof Request,i=r?e.clone():e,a=e=>{let n=new Headers(e?e.headers:void 0);return new Headers(t?.headers).forEach((e,t)=>n.set(t,e)),n.set(We,`1`),n},o=!r&&t?.headers&&!(t.headers instanceof Headers)&&!Array.isArray(t.headers)?{...t.headers,[We]:`1`}:a(r?e:null),s=await fetch(e,{...t,headers:o});if(s.status!==428&&!Ge(s))return s;let c=null;try{c=Ie(await s.clone().json())}catch{return Ke(s)}if(!c)return Ke(s);n.onChallenge?.();let l=await Ue(c,{signal:t?.signal||void 0});n.onSolved?.();let u=a(r?i:null);return u.set(`X-AlphaRecall-PoW`,Le(c,l)),Ke(await fetch(i,{...t,headers:u}))}var Je=/^[A-Za-z0-9_-]{16,64}$/;function Ye(e){return typeof e==`string`&&Je.test(e)}function Xe(){let e=new Uint8Array(16);if(typeof crypto<`u`&&typeof crypto.getRandomValues==`function`)crypto.getRandomValues(e);else for(let t=0;t<e.length;t+=1)e[t]=Math.floor(Math.random()*256);return Array.from(e,e=>e.toString(16).padStart(2,`0`)).join(``)}function Ze({restBase:e,headers:t,turnId:n,shownChars:r}){if(!e||!Ye(n)||typeof fetch!=`function`)return Promise.resolve(!1);let i={turn_id:n};return typeof r==`number`&&Number.isFinite(r)&&r>=0&&(i.shown_chars=Math.floor(r)),fetch(`${e.replace(/\/$/,``)}/chat/cancel`,{method:`POST`,headers:{...t,"Content-Type":`application/json`},credentials:`same-origin`,keepalive:!0,body:JSON.stringify(i)}).then(e=>e.ok).catch(()=>!1)}var Qe=1e5,H=class extends Error{constructor(e,t,n=0,r=null,i=null){super(t),this.kind=e,this.status=n,this.retryAfterMs=r,this.handoff=i}},$e=`rest_cookie_invalid_nonce`,U=null,W=null,et=!1;function G(){return l().restUrl.replace(/\/$/,``)}async function tt(){if(et)return;let e=l().siteUrl;try{if(e&&new URL(e,location.href).origin===location.origin&&!(await fetch(e,{credentials:`same-origin`,cache:`no-store`})).ok)return;et=!0}catch{}}async function nt(){if(U&&U.expiresAt-Date.now()>6e4)return U;await tt();let e=await fetch(`${G()}/chat-signature`,{headers:{"X-WP-Nonce":l().nonce},cache:`no-store`,credentials:`same-origin`});if(!e.ok)throw et=!1,ct(e,await it(e),`session`);let t=await e.json();if(!t.chatSig||!t.chatTs)throw new H(`session`,`invalid signature`,e.status);return U={chatSig:t.chatSig,chatTs:String(t.chatTs),expiresAt:Date.now()+(Number(t.expiresIn)>0?Number(t.expiresIn):3600)*1e3},U}function rt(e){return{"Content-Type":`application/json`,"X-WP-Nonce":l().nonce,"X-AlphaRecall-Signature":e.chatSig,"X-AlphaRecall-Timestamp":e.chatTs}}async function it(e){try{let t=await e.json();return{message:String(t?.message||t?.detail||t?.error||``),code:typeof t?.code==`string`?t.code:``,retryAfter:Number(t?.retry_after)||0}}catch{return{message:``,code:``,retryAfter:0}}}function at(e,t){return c(t>0?String(t):e.headers.get(`Retry-After`))}var ot=1440*60*1e3;function st(e,t){if(t>0)return Math.min(ot,t*1e3);let n=(e.headers.get(`Retry-After`)||``).trim();if(/^\d+(\.\d+)?$/.test(n))return Math.min(ot,Number(n)*1e3);let r=n?Date.parse(n):NaN;return Number.isNaN(r)?null:Math.min(ot,Math.max(0,r-Date.now()))}function ct(e,t,n){return t.code===$e?new H(`expired`,t.message,e.status):e.status===429?new H(`blocked`,t.message,e.status,st(e,t.retryAfter)):e.status===428||t.code===`pow_required`?new H(`challenge`,t.message,e.status):new H(n,t.message,e.status)}async function lt(e){if(W)return W;let t=!1,n;try{n=await qe(`${G()}/visitor-register`,{method:`POST`,headers:rt(e),credentials:`same-origin`,body:JSON.stringify({anonymous:!0})},{onChallenge:()=>{t=!0}})}catch(e){throw t?new H(`challenge`,e instanceof Error?e.message:``,428):e}if(!n.ok)throw ct(n,await it(n),`visitor`);let r=await n.json();if(!r.visitor_token)throw new H(`visitor`,`missing visitor token`,n.status);return W=r.visitor_token,W}function ut(e){return Array.isArray(e)?e.filter(e=>!!e&&typeof e==`object`&&!Array.isArray(e)):[]}function dt(e){return e.map(e=>String(e.type||e.component||e.name||``)).filter(Boolean)}async function ft(e){let{message:t,code:n,retryAfter:r}=await it(e);return(e.status===401||e.status===403)&&(U=null,W=null),n===$e?new H(`expired`,t,e.status):e.status===402||n===`quota_exceeded`?new H(`quota`,t,e.status):e.status===429?new H(`rate`,t,e.status,at(e,r)):e.status===504||e.status===524||n===`upstream_timeout`?new H(`timeout`,t,e.status):new H(`chat`,t,e.status)}async function pt(e,t,n){let r=await nt(),i=await lt(r),a=new AbortController,o=!1,s=!1,c=setTimeout(()=>{o=!0,a.abort()},Qe),l=Xe(),u=()=>{a.abort(),!s&&Ze({restBase:G(),headers:{...rt(r),"X-Visitor-Token":i},turnId:l,shownChars:0})};n?.aborted&&a.abort(),n?.addEventListener(`abort`,u,{once:!0});let d=performance.now();try{let n=await qe(`${G()}/chat`,{method:`POST`,headers:{...rt(r),"X-Visitor-Token":i,"X-AlphaRecall-Prova":`1`},credentials:`same-origin`,signal:a.signal,body:JSON.stringify({workflow:`chat`,input:{text:e},visitor_token:i,turn_id:l,...t?{conversation_id:t}:{}})});if(s=!0,!n.ok)throw await ft(n);let o=await n.json().catch(e=>{throw a.signal.aborted?e:new H(`unreadable`,``,n.status)});if(!o||typeof o!=`object`||Array.isArray(o))throw new H(`unreadable`,``,n.status);let c=o,u=typeof c.output==`string`?c.output:typeof c.text==`string`?c.text:``,f=ut(c.components);if(!u.trim()&&f.length===0)throw c.handoff===!0||c.ai_enabled===!1||[`handoff`,`escalated`,`closed`].includes(String(c.status??``))?new H(`handoff`,``,n.status,null,{conversationId:c.conversation_id==null?t:String(c.conversation_id),chatStatus:String(c.status||`handoff`)}):new H(`empty`,``,n.status);let p=Math.round(performance.now()-d);return{output:u,citations:Array.isArray(c.citations)?c.citations:[],sources:Array.isArray(c.sources)?c.sources:[],usage:c.usage&&typeof c.usage==`object`?c.usage:null,model:c.model?String(c.model):null,conversationId:c.conversation_id?String(c.conversation_id):t,tool:c.tool?String(c.tool):null,components:dt(f),componentData:f,followups:Array.isArray(c.followups)?c.followups.map(String):[],toolRounds:Array.isArray(c.tool_rounds)?c.tool_rounds.length:typeof c.tool_rounds==`number`?c.tool_rounds:null,ms:p}}catch(e){throw o&&!n?.aborted?new H(`timeout`,``,0):e}finally{clearTimeout(c),n?.removeEventListener(`abort`,u)}}var K=r(),mt=new Set,ht=class extends B.Component{constructor(...e){super(...e),this.state={failed:!1}}static getDerivedStateFromError(){return{failed:!0}}componentDidCatch(e){mt.has(this.props.tool)||(mt.add(this.props.tool),console.error(`AlphaRecall: the "${this.props.tool}" card failed to render`,e))}render(){return this.state.failed?(0,K.jsx)(`p`,{className:`ar-tool-fallback`,role:`note`,children:k().cardUnavailable}):this.props.children}},gt={bookingTitle:`Prenota un appuntamento`,bookingFreeSlots:e=>e===1?`1 orario libero`:`${e} orari liberi`,bookingMinutes:e=>`${e} min`,bookingFrom:e=>`dal ${e}`,bookingOpen:`Scegli giorno e ora`,bookingDayFree:(e,t)=>`${e} · ${t===1?`1 orario libero`:`${t} orari liberi`}`,bookingPickTime:`Scegli un orario`,bookingConfirm:(e,t)=>`Conferma ${e} alle ${t}`,bookingRequested:(e,t)=>`Hai scelto ${e} alle ${t}`,bookingRequestedSub:`Completiamo la prenotazione qui in chat`,bookingTimezone:e=>`Orari nel fuso ${e}`,bookingDays:`Giorni`,bookingTimes:`Orari`,bookingPrevDays:`Giorni precedenti`,bookingNextDays:`Giorni successivi`,bookingMessage:(e,t)=>`Vorrei prenotare ${e} alle ${t}`,bookingIntro:`Scegli un orario libero:`,bookingReasons:{busy:`Quell'orario è già occupato. Ecco i primi orari liberi:`,outside_hours:`Quell'orario è fuori dagli orari di apertura. Ecco i primi orari liberi:`,too_soon:`Quell'orario è troppo vicino per prenotare. Ecco i primi orari liberi:`,needs_exact_time:`Scegli uno di questi orari liberi:`},draftLabel:`Richiesta da inviare`,draftName:`Nome`,draftEmail:`Email`,draftPhone:`Telefono`,draftSubject:`Oggetto`,draftBody:`Richiesta`,draftFrom:`Da`,draftTo:`A`,draftEdit:e=>`Modifica ${e.toLowerCase()}`,draftDone:`Fatto`,draftSend:e=>e?`Invia a ${e}`:`Invia richiesta`,draftConsent:`Inviando ci autorizzi a ricontattarti per questa richiesta`,draftCancel:`Annulla`,draftSendingIn:e=>`Invio tra ${e}s`,draftUndo:`Annulla invio`,draftSent:`Richiesta inviata`,draftAlreadySent:`Richiesta già inviata`,draftSentAt:e=>`Inviata alle ${e}`,draftCancelled:`Richiesta non inviata`,draftReadAll:`Leggi tutto`,draftShowLess:`Mostra meno`,draftCorrection:e=>`Ho corretto i dati della richiesta, inviatela così:\n${e}`,draftSubmitting:`Invio in corso…`,draftRetry:`Riprova`,draftSendError:`Non sono riuscito a inviare la richiesta. Controlla la connessione e riprova.`,draftInvalid:`Qualche dato non è valido: controlla email e telefono e riprova.`,draftSessionExpired:`La sessione della chat è scaduta: ricarica la pagina e riprova.`,draftReplaced:`Questa richiesta non è più valida: ne è stata preparata una più recente.`,draftMissing:`Non trovo più questa richiesta: chiedi all'assistente di prepararla di nuovo.`,flowTitle:`Capiamo cosa ti serve`,flowQuestionOf:(e,t)=>`Domanda ${e} di ${t}`,flowOneQuestion:`Una domanda veloce`,flowQuestions:e=>`${e} domande veloci`,flowStart:`Rispondi`,flowNext:`Avanti`,flowDone:`Invia risposta`,flowBack:`Domanda precedente`,flowSkip:e=>`Salta e scrivi a ${e}`,flowSkipGeneric:`Salta e scrivi in chat`,flowOther:`Scrivilo qui`,flowAnswered:`Hai risposto`,flowMulti:`Puoi sceglierne più di una`,pricesLabel:`Listino`,pricesShowAll:e=>`Vedi tutto (${e})`,pricesShowLess:`Mostra meno`,pricesAsk:`Chiedi`,pricesAskAbout:e=>`Mi interessa: ${e}`,pricesAskLabel:e=>`Chiedi informazioni su ${e}`,carouselPage:(e,t)=>`Pagina ${e} di ${t}`,carouselLabel:`Elenco scorrevole`,open:`Vedi`,handoffTitle:`Ti rispondiamo qui`,handoffWaiting:`Una persona del team continua questa chat`,handoffEmail:`Il team ti risponde anche via email`,handoffJoined:`Il team è in chat`,handoffJoinedSub:`Scrivi pure qui, ti risponde una persona`,handoffNoWait:`Non vuoi aspettare?`,handoffCallback:`Ricontattatemi`,handoffEmailLabel:`La tua email`,handoffEmailHelp:`Ti rispondiamo via email. Dopo l'invio puoi chiudere la chat.`,handoffEmailInvalid:`Controlla l'indirizzo email`,handoffDetailsLabel:`Info aggiuntive (facoltativo)`,handoffSend:`Invia`,handoffError:`Invio non riuscito. Riprova.`,handoffSentTitle:`Richiesta inviata`,handoffSentSub:`Ora puoi chiudere la chat e iniziarne una nuova.`,handoffNewChat:`Nuova chat`,handoffEmailNote:`Se chiudi la chat, ti rispondiamo via email`,feedbackTitle:`Com'è andata?`,feedbackSub:`Ci aiuti a rispondere meglio`,feedbackStars:`Valutazione`,feedbackStar:e=>e===1?`1 stella`:`${e} stelle`,feedbackComment:`Raccontaci in una frase`,feedbackPlaceholder:`Cosa ti è piaciuto? Cosa miglioreresti?`,feedbackNeedComment:`Scrivi un commento per inviare`,feedbackSend:`Invia feedback`,feedbackMessage:(e,t)=>e>0?`Vorrei lasciare un feedback sulla chat: voto ${e} su 5. ${t}`:`Vorrei lasciare un feedback sulla chat: ${t}`,feedbackThanks:`Grazie per il feedback`,feedbackSaved:`L'abbiamo girato al team`,feedbackError:`Feedback non inviato, riprova`,feedbackRated:e=>`Valutazione ${e} su 5`,rateUp:`Risposta utile`,rateDown:`Risposta non utile`,rateThanks:`Grazie, ne terremo conto`,rateError:`Valutazione non salvata, riprova`,infoCall:`Chiama`,infoDirections:`Indicazioni`,infoEmail:`Scrivi`,infoHours:`Orari`,infoPlace:`La nostra sede`,eventRegister:`Iscriviti`,eventSeats:(e,t)=>`${e} di ${t} posti presi`,couponValid:`Codice valido`,couponInvalid:`Codice non valido`,toolError:`Non sono riuscito a mostrare questo contenuto.`,close:`Chiudi`},_t={bookingTitle:`Book an appointment`,bookingFreeSlots:e=>e===1?`1 free slot`:`${e} free slots`,bookingMinutes:e=>`${e} min`,bookingFrom:e=>`from ${e}`,bookingOpen:`Pick a day and time`,bookingDayFree:(e,t)=>`${e} · ${t===1?`1 free slot`:`${t} free slots`}`,bookingPickTime:`Pick a time`,bookingConfirm:(e,t)=>`Confirm ${e} at ${t}`,bookingRequested:(e,t)=>`You picked ${e} at ${t}`,bookingRequestedSub:`We finish the booking here in the chat`,bookingTimezone:e=>`Times in ${e}`,bookingDays:`Days`,bookingTimes:`Times`,bookingPrevDays:`Earlier days`,bookingNextDays:`Later days`,bookingMessage:(e,t)=>`I'd like to book ${e} at ${t}`,bookingIntro:`Pick a free time:`,bookingReasons:{busy:`That time is taken. Here are the first free times:`,outside_hours:`That time is outside opening hours. Here are the first free times:`,too_soon:`That time is too soon to book. Here are the first free times:`,needs_exact_time:`Pick one of these free times:`},draftLabel:`Request to send`,draftName:`Name`,draftEmail:`Email`,draftPhone:`Phone`,draftSubject:`Subject`,draftBody:`Request`,draftFrom:`From`,draftTo:`To`,draftEdit:e=>`Edit ${e.toLowerCase()}`,draftDone:`Done`,draftSend:e=>e?`Send to ${e}`:`Send request`,draftConsent:`By sending you agree to be contacted about this request`,draftCancel:`Cancel`,draftSendingIn:e=>`Sending in ${e}s`,draftUndo:`Undo`,draftSent:`Request sent`,draftAlreadySent:`Request already sent`,draftSentAt:e=>`Sent at ${e}`,draftCancelled:`Request not sent`,draftReadAll:`Read all`,draftShowLess:`Show less`,draftCorrection:e=>`I corrected the request details, please send it like this:\n${e}`,draftSubmitting:`Sending…`,draftRetry:`Try again`,draftSendError:`I couldn't send the request. Check your connection and try again.`,draftInvalid:`Some details aren't valid: check the email and phone and try again.`,draftSessionExpired:`The chat session has expired: reload the page and try again.`,draftReplaced:`This request is no longer valid: a newer one was prepared.`,draftMissing:`I can't find this request anymore: ask the assistant to prepare it again.`,flowTitle:`Let's find what you need`,flowQuestionOf:(e,t)=>`Question ${e} of ${t}`,flowOneQuestion:`One quick question`,flowQuestions:e=>`${e} quick questions`,flowStart:`Answer`,flowNext:`Next`,flowDone:`Send answer`,flowBack:`Previous question`,flowSkip:e=>`Skip and write to ${e}`,flowSkipGeneric:`Skip and write in the chat`,flowOther:`Write it here`,flowAnswered:`You answered`,flowMulti:`You can pick more than one`,pricesLabel:`Price list`,pricesShowAll:e=>`See all (${e})`,pricesShowLess:`Show less`,pricesAsk:`Ask`,pricesAskAbout:e=>`I'm interested in: ${e}`,pricesAskLabel:e=>`Ask about ${e}`,carouselPage:(e,t)=>`Page ${e} of ${t}`,carouselLabel:`Scrollable list`,open:`View`,handoffTitle:`We'll reply here`,handoffWaiting:`A person from the team continues this chat`,handoffEmail:`The team also replies by email`,handoffJoined:`The team is in the chat`,handoffJoinedSub:`Write here, a person will reply`,handoffNoWait:`Rather not wait?`,handoffCallback:`Contact me`,handoffEmailLabel:`Your email`,handoffEmailHelp:`We'll reply by email. Once it's sent you can close the chat.`,handoffEmailInvalid:`Check the email address`,handoffDetailsLabel:`More details (optional)`,handoffSend:`Send`,handoffError:`Couldn't send it. Try again.`,handoffSentTitle:`Request sent`,handoffSentSub:`You can now close the chat and start a new one.`,handoffNewChat:`New chat`,handoffEmailNote:`If you close the chat, we'll reply by email`,feedbackTitle:`How did it go?`,feedbackSub:`Help us answer better`,feedbackStars:`Rating`,feedbackStar:e=>e===1?`1 star`:`${e} stars`,feedbackComment:`Tell us in a sentence`,feedbackPlaceholder:`What did you like? What would you improve?`,feedbackNeedComment:`Write a comment to send`,feedbackSend:`Send feedback`,feedbackMessage:(e,t)=>e>0?`I'd like to leave feedback on the chat: ${e} out of 5. ${t}`:`I'd like to leave feedback on the chat: ${t}`,feedbackThanks:`Thanks for the feedback`,feedbackSaved:`We passed it on to the team`,feedbackError:`Feedback not sent, try again`,feedbackRated:e=>`Rated ${e} out of 5`,rateUp:`Helpful answer`,rateDown:`Not helpful`,rateThanks:`Thanks, we'll take it into account`,rateError:`Rating not saved, try again`,infoCall:`Call`,infoDirections:`Directions`,infoEmail:`Email`,infoHours:`Opening hours`,infoPlace:`Our location`,eventRegister:`Register`,eventSeats:(e,t)=>`${e} of ${t} seats taken`,couponValid:`Valid code`,couponInvalid:`Invalid code`,toolError:`I couldn't show this content.`,close:`Close`};function vt(e){let t=typeof window<`u`?window.AlphaRecallChat?.language:null;return String(e||t||(typeof document<`u`?document.documentElement.lang:`it`)||`it`).startsWith(`it`)?gt:_t}var yt=`alpharecall:product-link`,bt=e=>{if(!e)return null;try{let t=new URL(e,window.location.origin);return t.protocol===`https:`||t.protocol===`http:`?t.href:null}catch{return null}};function xt({items:e,label:t}){let n=vt(),r=B.useRef(null),[i,a]=B.useState(0),[o,s]=B.useState(1),c=B.useCallback(()=>{let e=r.current;if(!e)return;let t=e.clientWidth||1,n=Math.max(1,Math.ceil((e.scrollWidth-4)/t));s(n);let i=e.scrollLeft+t>=e.scrollWidth-4;a(i?n-1:Math.round(e.scrollLeft/t))},[]);B.useEffect(()=>{let e=r.current;if(!e)return;c();let t=0,n=()=>{cancelAnimationFrame(t),t=requestAnimationFrame(c)};e.addEventListener(`scroll`,n,{passive:!0});let i=typeof ResizeObserver<`u`?new ResizeObserver(n):null;return i?.observe(e),()=>{cancelAnimationFrame(t),e.removeEventListener(`scroll`,n),i?.disconnect()}},[c,e.length]);let l=e=>{let t=r.current;if(!t)return;let n=window.matchMedia?.(`(prefers-reduced-motion: reduce)`).matches;t.scrollTo({left:e*t.clientWidth,behavior:n?`auto`:`smooth`})};return e.length?(0,K.jsxs)(`div`,{className:`ar-carousel`,children:[(0,K.jsx)(`ul`,{ref:r,className:`ar-carousel-track`,"aria-label":t||n.carouselLabel,children:e.map(e=>{let t=bt(e.action?.href),n=bt(e.link?.href);if(e.link&&n){let t=e.link.sameSite;return(0,K.jsx)(`li`,{className:`ar-carousel-card`,children:(0,K.jsxs)(`a`,{className:`ar-carousel-link`,href:n,target:t?void 0:`_blank`,rel:t?void 0:`noopener noreferrer`,"aria-label":e.link.ariaLabel,draggable:!1,onClick:()=>{t&&window.dispatchEvent(new CustomEvent(yt,{detail:{href:n}}))},children:[e.image?(0,K.jsx)(`img`,{className:`ar-carousel-img`,src:e.image,alt:``,loading:`lazy`,decoding:`async`,draggable:!1}):null,(0,K.jsxs)(`span`,{className:`ar-carousel-body`,children:[e.badge?(0,K.jsx)(`span`,{className:`ar-carousel-badge`,children:e.badge}):null,(0,K.jsx)(`b`,{className:`ar-carousel-title`,children:e.title}),e.sub?(0,K.jsx)(`small`,{className:`ar-carousel-sub`,children:e.sub}):null,(0,K.jsxs)(`span`,{className:`ar-carousel-foot`,children:[e.price?(0,K.jsx)(`b`,{className:`ar-carousel-price`,children:e.price}):(0,K.jsx)(`span`,{}),e.action?.label?(0,K.jsx)(`span`,{className:`ar-chip`,"aria-hidden":`true`,children:e.action.label}):null]})]})]})},e.id)}return(0,K.jsxs)(`li`,{className:`ar-carousel-card`,children:[e.image?(0,K.jsx)(`img`,{className:`ar-carousel-img`,src:e.image,alt:``,loading:`lazy`,decoding:`async`,draggable:!1}):null,(0,K.jsxs)(`div`,{className:`ar-carousel-body`,children:[e.badge?(0,K.jsx)(`span`,{className:`ar-carousel-badge`,children:e.badge}):null,(0,K.jsx)(`b`,{className:`ar-carousel-title`,children:e.title}),e.sub?(0,K.jsx)(`small`,{className:`ar-carousel-sub`,children:e.sub}):null,e.price||e.action?(0,K.jsxs)(`span`,{className:`ar-carousel-foot`,children:[e.price?(0,K.jsx)(`b`,{className:`ar-carousel-price`,children:e.price}):(0,K.jsx)(`span`,{}),e.action&&t?(0,K.jsx)(`a`,{className:`ar-chip`,href:t,target:`_blank`,rel:`noopener noreferrer`,"aria-label":e.action.ariaLabel,children:e.action.label}):e.action?.onClick?(0,K.jsx)(`button`,{type:`button`,className:`ar-chip`,"aria-label":e.action.ariaLabel,onClick:e.action.onClick,children:e.action.label}):null]}):null]})]},e.id)})}),o>1?(0,K.jsx)(`div`,{className:`ar-dots`,children:Array.from({length:o},(e,t)=>(0,K.jsx)(`button`,{type:`button`,className:`ar-dot`,"data-on":t===i?`true`:void 0,"aria-label":n.carouselPage(t+1,o),"aria-current":t===i?`true`:void 0,onClick:()=>l(t)},t))}):null]}):null}var St=6,Ct=/prezz|cost|price|tariff|importo|quota|fee|€|eur\b/i,wt=/(€|eur\b|\$|£|chf)\s?\d|\d[\d.,]*\s?(€|eur\b|euro|\$|£|chf)|^(gratis|gratuit[ao]|free)$/i;function q(e,t){if(e==null)return``;if(Array.isArray(e))return e.map(e=>q(e)).filter(Boolean).join(`, `);if(typeof e==`boolean`)return e?`Sì`:`No`;if(typeof e==`number`){let n=t?.format?.kind;try{return n===`currency`?new Intl.NumberFormat(`it-IT`,{style:`currency`,currency:t?.format?.currency||`EUR`,maximumFractionDigits:t?.format?.decimals??2}).format(e):n===`percent`?new Intl.NumberFormat(`it-IT`,{style:`percent`,maximumFractionDigits:1}).format(Math.abs(e)>1?e/100:e):new Intl.NumberFormat(`it-IT`).format(e)}catch{return String(e)}}if(typeof e==`object`){let t=e;return q(t.label??t.value??t.text??``)}return String(e).trim()}function Tt(e,t){return e.find(e=>Ct.test(`${e.label||``} ${e.key}`)||e.format?.kind===`currency`)||e.find(e=>{let n=t.map(t=>q(t[e.key],e)).filter(Boolean);return n.length>0&&n.filter(e=>wt.test(e)).length>=Math.ceil(n.length/2)})||null}function Et({component:e,onSendMessage:t}){let n=vt(),[r,i]=B.useState(!1),a=Array.isArray(e.data)?e.data.filter(e=>e&&typeof e==`object`):[],o=Array.isArray(e.columns)&&e.columns.length?e.columns.filter(e=>e&&typeof e.key==`string`):Object.keys(a[0]||{}).filter(e=>e!==`id`).map(e=>({key:e,label:e}));if(!a.length||!o.length)return null;let s=Tt(o,a),c=o.find(e=>e!==s)||o[0],l=o.filter(e=>e!==s&&e!==c);if(s&&s!==c&&a.length>=2&&a.length<=12&&o.length<=4){let r=a.map((e,r)=>{let i=q(e[c.key],c)||`${r+1}`;return{id:`${r}-${i}`,title:i,sub:l.map(t=>q(e[t.key],t)).filter(Boolean).join(` · `)||void 0,price:q(e[s.key],s)||void 0,action:t?{label:n.pricesAsk,ariaLabel:n.pricesAskLabel(i),onClick:()=>t(n.pricesAskAbout(i))}:void 0}});return(0,K.jsxs)(`section`,{className:`ar-prices`,"data-slot":`data-table`,"aria-label":e.title||n.pricesLabel,children:[e.title?(0,K.jsx)(`h3`,{className:`ar-prices-title`,children:e.title}):null,(0,K.jsx)(xt,{items:r,label:e.title||n.pricesLabel})]})}let u=r?a:a.slice(0,St),d=o.filter(e=>e!==c),f=o.length===2;return(0,K.jsxs)(`section`,{className:`ar-card ar-table-card`,"data-slot":`data-table`,"aria-label":e.title||void 0,children:[e.title||e.description?(0,K.jsxs)(`div`,{className:`ar-card-heading`,children:[e.title?(0,K.jsx)(`h3`,{className:`ar-card-title`,children:e.title}):null,e.description?(0,K.jsx)(`p`,{className:`ar-card-sub`,children:e.description}):null]}):null,(0,K.jsx)(`ul`,{className:`ar-rows`,children:u.map((e,t)=>{let n=q(e[c.key],c);if(f){let r=d[0];return(0,K.jsxs)(`li`,{className:`ar-row`,children:[(0,K.jsx)(`span`,{className:`ar-row-label`,children:n}),(0,K.jsx)(`span`,{className:`ar-row-value`,children:q(e[r.key],r)})]},t)}let r=d.map(t=>({label:t.label||t.key,value:q(e[t.key],t)})).filter(e=>e.value);return(0,K.jsxs)(`li`,{className:`ar-row ar-row--stack`,children:[(0,K.jsx)(`span`,{className:`ar-row-label`,children:n}),r.length?(0,K.jsx)(`dl`,{className:`ar-row-details`,children:r.map(e=>(0,K.jsxs)(`div`,{children:[(0,K.jsx)(`dt`,{children:e.label}),(0,K.jsx)(`dd`,{children:e.value})]},e.label))}):null]},t)})}),a.length>St?(0,K.jsx)(`button`,{type:`button`,className:`ar-text-btn`,"aria-expanded":r,onClick:()=>i(e=>!e),children:r?n.pricesShowLess:n.pricesShowAll(a.length)}):null]})}var Dt=t(ue()),Ot=t(N()),kt=t(M()),At=[`type`,`layout`,`connectNulls`,`ref`],jt=[`key`];function J(e){"@babel/helpers - typeof";return J=typeof Symbol==`function`&&typeof Symbol.iterator==`symbol`?function(e){return typeof e}:function(e){return e&&typeof Symbol==`function`&&e.constructor===Symbol&&e!==Symbol.prototype?`symbol`:typeof e},J(e)}function Mt(e,t){if(e==null)return{};var n=Nt(e,t),r,i;if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(e);for(i=0;i<a.length;i++)r=a[i],!(t.indexOf(r)>=0)&&Object.prototype.propertyIsEnumerable.call(e,r)&&(n[r]=e[r])}return n}function Nt(e,t){if(e==null)return{};var n={};for(var r in e)if(Object.prototype.hasOwnProperty.call(e,r)){if(t.indexOf(r)>=0)continue;n[r]=e[r]}return n}function Y(){return Y=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var n=arguments[t];for(var r in n)Object.prototype.hasOwnProperty.call(n,r)&&(e[r]=n[r])}return e},Y.apply(this,arguments)}function Pt(e,t){var n=Object.keys(e);if(Object.getOwnPropertySymbols){var r=Object.getOwnPropertySymbols(e);t&&(r=r.filter(function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable})),n.push.apply(n,r)}return n}function X(e){for(var t=1;t<arguments.length;t++){var n=arguments[t]==null?{}:arguments[t];t%2?Pt(Object(n),!0).forEach(function(t){Q(e,t,n[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(n)):Pt(Object(n)).forEach(function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(n,t))})}return e}function Z(e){return Rt(e)||Lt(e)||It(e)||Ft()}function Ft(){throw TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`)}function It(e,t){if(e){if(typeof e==`string`)return zt(e,t);var n=Object.prototype.toString.call(e).slice(8,-1);if(n===`Object`&&e.constructor&&(n=e.constructor.name),n===`Map`||n===`Set`)return Array.from(e);if(n===`Arguments`||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n))return zt(e,t)}}function Lt(e){if(typeof Symbol<`u`&&e[Symbol.iterator]!=null||e[`@@iterator`]!=null)return Array.from(e)}function Rt(e){if(Array.isArray(e))return zt(e)}function zt(e,t){(t==null||t>e.length)&&(t=e.length);for(var n=0,r=Array(t);n<t;n++)r[n]=e[n];return r}function Bt(e,t){if(!(e instanceof t))throw TypeError(`Cannot call a class as a function`)}function Vt(e,t){for(var n=0;n<t.length;n++){var r=t[n];r.enumerable=r.enumerable||!1,r.configurable=!0,`value`in r&&(r.writable=!0),Object.defineProperty(e,Xt(r.key),r)}}function Ht(e,t,n){return t&&Vt(e.prototype,t),n&&Vt(e,n),Object.defineProperty(e,"prototype",{writable:!1}),e}function Ut(e,t,n){return t=qt(t),Wt(e,Kt()?Reflect.construct(t,n||[],qt(e).constructor):t.apply(e,n))}function Wt(e,t){if(t&&(J(t)===`object`||typeof t==`function`))return t;if(t!==void 0)throw TypeError(`Derived constructors may only return object or undefined`);return Gt(e)}function Gt(e){if(e===void 0)throw ReferenceError(`this hasn't been initialised - super() hasn't been called`);return e}function Kt(){try{var e=!Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],function(){}))}catch{}return(Kt=function(){return!!e})()}function qt(e){return qt=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(e){return e.__proto__||Object.getPrototypeOf(e)},qt(e)}function Jt(e,t){if(typeof t!=`function`&&t!==null)throw TypeError(`Super expression must either be null or a function`);e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,writable:!0,configurable:!0}}),Object.defineProperty(e,"prototype",{writable:!1}),t&&Yt(e,t)}function Yt(e,t){return Yt=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(e,t){return e.__proto__=t,e},Yt(e,t)}function Q(e,t,n){return t=Xt(t),t in e?Object.defineProperty(e,t,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[t]=n,e}function Xt(e){var t=Zt(e,`string`);return J(t)==`symbol`?t:t+``}function Zt(e,t){if(J(e)!=`object`||!e)return e;var n=e[Symbol.toPrimitive];if(n!==void 0){var r=n.call(e,t||`default`);if(J(r)!=`object`)return r;throw TypeError(`@@toPrimitive must return a primitive value.`)}return(t===`string`?String:Number)(e)}var $=function(e){function t(){var e;Bt(this,t);var n=[...arguments];return e=Ut(this,t,[].concat(n)),Q(e,`state`,{isAnimationFinished:!0,totalLength:0}),Q(e,`generateSimpleStrokeDasharray`,function(e,t){return`${t}px ${e-t}px`}),Q(e,`getStrokeDasharray`,function(n,r,i){var a=i.reduce(function(e,t){return e+t});if(!a)return e.generateSimpleStrokeDasharray(r,n);for(var o=Math.floor(n/a),s=n%a,c=r-n,l=[],u=0,d=0;u<i.length;d+=i[u],++u)if(d+i[u]>s){l=[].concat(Z(i.slice(0,u)),[s-d]);break}var f=l.length%2==0?[0,c]:[c];return[].concat(Z(t.repeat(i,o)),Z(l),f).map(function(e){return`${e}px`}).join(`, `)}),Q(e,`id`,P(`recharts-line-`)),Q(e,`pathRef`,function(t){e.mainCurve=t}),Q(e,`handleAnimationEnd`,function(){e.setState({isAnimationFinished:!0}),e.props.onAnimationEnd&&e.props.onAnimationEnd()}),Q(e,`handleAnimationStart`,function(){e.setState({isAnimationFinished:!1}),e.props.onAnimationStart&&e.props.onAnimationStart()}),e}return Jt(t,e),Ht(t,[{key:`componentDidMount`,value:function(){if(this.props.isAnimationActive){var e=this.getTotalLength();this.setState({totalLength:e})}}},{key:`componentDidUpdate`,value:function(){if(this.props.isAnimationActive){var e=this.getTotalLength();e!==this.state.totalLength&&this.setState({totalLength:e})}}},{key:`getTotalLength`,value:function(){var e=this.mainCurve;try{return e&&e.getTotalLength&&e.getTotalLength()||0}catch{return 0}}},{key:`renderErrorBar`,value:function(e,t){if(this.props.isAnimationActive&&!this.state.isAnimationFinished)return null;var n=this.props,r=n.points,i=n.xAxis,a=n.yAxis,o=n.layout,s=n.children,c=De(s,L);if(!c)return null;var l=function(e,t){return{x:e.x,y:e.y,value:e.value,errorVal:Ee(e.payload,t)}},u={clipPath:e?`url(#clipPath-${t})`:null};return B.createElement(F,u,c.map(function(e){return B.cloneElement(e,{key:`bar-${e.props.dataKey}`,data:r,xAxis:i,yAxis:a,layout:o,dataPointFormatter:l})}))}},{key:`renderDots`,value:function(e,n,r){if(this.props.isAnimationActive&&!this.state.isAnimationFinished)return null;var i=this.props,a=i.dot,o=i.points,s=i.dataKey,c=I(this.props,!1),l=I(a,!0),u=o.map(function(e,n){var r=X(X(X({key:`dot-${n}`,r:3},c),l),{},{index:n,cx:e.x,cy:e.y,value:e.value,dataKey:s,payload:e.payload,points:o});return t.renderDotItem(a,r)}),d={clipPath:e?`url(#clipPath-${n?``:`dots-`}${r})`:null};return B.createElement(F,Y({className:`recharts-line-dots`,key:`dots`},d),u)}},{key:`renderCurveStatically`,value:function(e,t,n,r){var i=this.props,a=i.type,o=i.layout,s=i.connectNulls;i.ref;var c=X(X(X({},I(Mt(i,At),!0)),{},{fill:`none`,className:`recharts-line-curve`,clipPath:t?`url(#clipPath-${n})`:null,points:e},r),{},{type:a,layout:o,connectNulls:s});return B.createElement(he,Y({},c,{pathRef:this.pathRef}))}},{key:`renderCurveWithAnimation`,value:function(e,t){var n=this,r=this.props,i=r.points,a=r.strokeDasharray,o=r.isAnimationActive,s=r.animationBegin,c=r.animationDuration,l=r.animationEasing,u=r.animationId,d=r.animateNewValues,f=r.width,p=r.height,m=this.state,h=m.prevPoints,g=m.totalLength;return B.createElement(ge,{begin:s,duration:c,isActive:o,easing:l,from:{t:0},to:{t:1},key:`line-${u}`,onAnimationEnd:this.handleAnimationEnd,onAnimationStart:this.handleAnimationStart},function(r){var o=r.t;if(h){var s=h.length/i.length,c=i.map(function(e,t){var n=Math.floor(t*s);if(h[n]){var r=h[n],i=R(r.x,e.x),a=R(r.y,e.y);return X(X({},e),{},{x:i(o),y:a(o)})}if(d){var c=R(f*2,e.x),l=R(p/2,e.y);return X(X({},e),{},{x:c(o),y:l(o)})}return X(X({},e),{},{x:e.x,y:e.y})});return n.renderCurveStatically(c,e,t)}var l=R(0,g)(o),u;if(a){var m=`${a}`.split(/[,\s]+/gim).map(function(e){return parseFloat(e)});u=n.getStrokeDasharray(l,g,m)}else u=n.generateSimpleStrokeDasharray(g,l);return n.renderCurveStatically(i,e,t,{strokeDasharray:u})})}},{key:`renderCurve`,value:function(e,t){var n=this.props,r=n.points,i=n.isAnimationActive,a=this.state,o=a.prevPoints,s=a.totalLength;return i&&r&&r.length&&(!o&&s>0||!(0,kt.default)(o,r))?this.renderCurveWithAnimation(e,t):this.renderCurveStatically(r,e,t)}},{key:`render`,value:function(){var e=this.props,t=e.hide,r=e.dot,i=e.points,a=e.className,o=e.xAxis,s=e.yAxis,c=e.top,l=e.left,u=e.width,d=e.height,f=e.isAnimationActive,p=e.id;if(t||!i||!i.length)return null;var m=this.state.isAnimationFinished,h=i.length===1,g=n(`recharts-line`,a),_=o&&o.allowDataOverflow,v=s&&s.allowDataOverflow,y=_||v,b=(0,Ot.default)(p)?this.id:p,x=I(r,!1)??{r:3,strokeWidth:2},S=x.r,ee=S===void 0?3:S,C=x.strokeWidth,w=C===void 0?2:C,T=(A(r)?r:{}).clipDot,E=T===void 0||T,D=ee*2+w;return B.createElement(F,{className:g},_||v?B.createElement(`defs`,null,B.createElement(`clipPath`,{id:`clipPath-${b}`},B.createElement(`rect`,{x:_?l:l-u/2,y:v?c:c-d/2,width:_?u:u*2,height:v?d:d*2})),!E&&B.createElement(`clipPath`,{id:`clipPath-dots-${b}`},B.createElement(`rect`,{x:l-D/2,y:c-D/2,width:u+D,height:d+D}))):null,!h&&this.renderCurve(y,b),this.renderErrorBar(y,b),(h||r)&&this.renderDots(y,E,b),(!f||m)&&de.renderCallByParent(this.props,i))}}],[{key:`getDerivedStateFromProps`,value:function(e,t){return e.animationId===t.prevAnimationId?e.points===t.curPoints?null:{curPoints:e.points}:{prevAnimationId:e.animationId,curPoints:e.points,prevPoints:t.curPoints}}},{key:`repeat`,value:function(e,t){for(var n=e.length%2==0?e:[].concat(Z(e),[0]),r=[],i=0;i<t;++i)r=[].concat(Z(r),Z(n));return r}},{key:`renderDotItem`,value:function(e,t){var r;if(B.isValidElement(e))r=B.cloneElement(e,t);else if((0,Dt.default)(e))r=e(t);else{var i=t.key,a=Mt(t,jt),o=n(`recharts-line-dot`,typeof e==`boolean`?``:e.className);r=B.createElement(ye,Y({key:i},a,{className:o}))}return r}}])}(B.PureComponent);Q($,`displayName`,`Line`),Q($,`defaultProps`,{xAxisId:0,yAxisId:0,connectNulls:!1,activeDot:!0,dot:!0,legendType:`line`,stroke:`#3182bd`,strokeWidth:1,fill:`#fff`,points:[],isAnimationActive:!le.isSsr,animateNewValues:!0,animationBegin:0,animationDuration:1500,animationEasing:`ease`,hide:!1,label:!1}),Q($,`getComposedData`,function(e){var t=e.props,n=e.xAxis,r=e.yAxis,i=e.xAxisTicks,a=e.yAxisTicks,o=e.dataKey,s=e.bandSize,c=e.displayedData,l=e.offset,u=t.layout;return X({points:c.map(function(e,t){var c=Ee(e,o);return u===`horizontal`?{x:j({axis:n,ticks:i,bandSize:s,entry:e,index:t}),y:(0,Ot.default)(c)?null:r.scale(c),value:c,payload:e}:{x:(0,Ot.default)(c)?null:n.scale(c),y:j({axis:r,ticks:a,bandSize:s,entry:e,index:t}),value:c,payload:e}}),layout:u},l)});var Qt=Ce({chartName:`LineChart`,GraphicalChild:$,axisComponents:[{axisType:`xAxis`,AxisComp:ve},{axisType:`yAxis`,AxisComp:pe}],formatAxisMap:me}),$t=[`var(--ar-brand, var(--chart-1))`,`color-mix(in srgb, var(--ar-brand, var(--chart-1)) 60%, var(--ar-panel, #fff))`,`color-mix(in srgb, var(--ar-brand, var(--chart-1)) 35%, var(--ar-panel, #fff))`,`var(--ar-ink-3, var(--chart-4))`,`var(--ar-ink-2, var(--chart-5))`],en=(0,B.memo)(function({id:e,type:t,title:n,description:r,data:i,xKey:a,series:o,colors:s,showLegend:c=!1,showGrid:l=!0,className:u,onDataPointClick:d}){let f=s?.length?s:$t,m=(0,B.useMemo)(()=>o.map((e,t)=>e.color??f[t%f.length]),[o,f]),h=(0,B.useMemo)(()=>Object.fromEntries(o.map((e,t)=>[e.key,{label:e.label,color:m[t]}])),[o,m]),g=(0,B.useCallback)((e,t,n,r)=>{d?.({seriesKey:e,seriesLabel:t,xValue:n[a],yValue:n[e],index:r,payload:n})},[d,a]),_=(0,K.jsx)(we,{config:h,className:`ar-chart min-h-[200px] w-full`,"data-tool-ui-id":e,children:(0,K.jsxs)(t===`bar`?xe:Qt,{data:i,accessibilityLayer:!0,children:[l&&(0,K.jsx)(Te,{vertical:!1,stroke:`var(--ar-fill-2)`}),(0,K.jsx)(ve,{dataKey:a,tickLine:!1,tickMargin:10,axisLine:!1,tick:{fontSize:11,fill:`var(--ar-ink-3)`}}),(0,K.jsx)(pe,{tickLine:!1,axisLine:!1,tickMargin:10,width:36,tick:{fontSize:11,fill:`var(--ar-ink-3)`}}),(0,K.jsx)(_e,{content:(0,K.jsx)(fe,{className:`ar-chart-tip`})}),c&&(0,K.jsx)(be,{content:(0,K.jsx)(Se,{})}),t===`bar`&&o.map((e,t)=>(0,K.jsx)(z,{dataKey:e.key,fill:m[t],radius:6,onClick:t=>g(e.key,e.label,t.payload,t.index),cursor:d?`pointer`:void 0},e.key)),t===`line`&&o.map((e,t)=>(0,K.jsx)($,{dataKey:e.key,type:`monotone`,stroke:m[t],strokeWidth:2,dot:{r:4,cursor:d?`pointer`:void 0},activeDot:{r:6,cursor:d?`pointer`:void 0,onClick:((t,n)=>{g(e.key,e.label,n.payload,n.index)})}},e.key))]})});return(0,K.jsxs)(`section`,{className:p(`ar-card ar-chart-card`,u),"data-tool-ui-id":e,"data-slot":`chart`,"aria-label":n||void 0,children:[(n||r)&&(0,K.jsx)(`div`,{className:`ar-card-head`,children:(0,K.jsxs)(`div`,{className:`ar-card-heading`,children:[n&&(0,K.jsx)(`h3`,{className:`ar-card-title`,children:n}),r&&(0,K.jsx)(`p`,{className:`ar-card-sub`,children:r})]})}),(0,K.jsx)(`div`,{className:`ar-chart-plot`,children:_})]})});function tn({data:e,color:t=`currentColor`,width:n=64,height:r=24,className:i,style:a,showFill:o=!1,fillOpacity:s=.09}){let c=(0,B.useId)();if(e.length<2)return null;let l=Math.min(...e),u=Math.max(...e)-l||1,d=n,f=r,m=e.map((t,n)=>({x:0+n/(e.length-1)*d,y:0+f-(t-l)/u*f})),h=m.map(e=>`${e.x},${e.y}`).join(` `),g=[`0,${r}`,...m.map(e=>`${e.x},${e.y}`),`${n-0},${r}`].join(` `),_=a?.animationDelay??`0ms`,v=typeof _==`number`?`${_}ms`:_,y=`calc(${v} + 100ms)`;return(0,K.jsxs)(`svg`,{viewBox:`0 0 ${n} ${r}`,"aria-hidden":`true`,className:p(`h-full w-full shrink-0`,i),style:a,preserveAspectRatio:`none`,children:[o&&(0,K.jsxs)(K.Fragment,{children:[(0,K.jsx)(`defs`,{children:(0,K.jsxs)(`linearGradient`,{id:c,x1:`0`,y1:`0`,x2:`0`,y2:`1`,children:[(0,K.jsx)(`stop`,{offset:`0%`,stopColor:t,stopOpacity:s}),(0,K.jsx)(`stop`,{offset:`100%`,stopColor:t,stopOpacity:0})]})}),(0,K.jsx)(`polygon`,{points:g,fill:`url(#${c})`,className:`animate-in fade-in duration-1000 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] fill-mode-both`,style:{animationDelay:_}})]}),(0,K.jsx)(`polyline`,{points:h,fill:`none`,stroke:t,strokeWidth:1,strokeOpacity:.15,strokeLinecap:`round`,strokeLinejoin:`round`,vectorEffect:`non-scaling-stroke`}),(0,K.jsx)(`polyline`,{points:h,fill:`none`,stroke:t,strokeWidth:.75,strokeLinecap:`round`,strokeLinejoin:`round`,vectorEffect:`non-scaling-stroke`,pathLength:1,strokeDasharray:`0.36 0.64`,strokeDashoffset:0,strokeOpacity:.2,className:`opacity-0 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-700 motion-safe:ease-out motion-safe:fill-mode-both`,style:{animationDelay:v}}),(0,K.jsx)(`polyline`,{points:h,fill:`none`,stroke:t,strokeWidth:.75,strokeLinecap:`round`,strokeLinejoin:`round`,vectorEffect:`non-scaling-stroke`,pathLength:1,strokeDasharray:`0.24 0.76`,strokeDashoffset:0,strokeOpacity:.65,className:`opacity-0 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500 motion-safe:ease-out motion-safe:fill-mode-both`,style:{animationDelay:y}})]})}function nn({value:e,format:t,locale:n}){if(typeof e==`string`||!t)return(0,K.jsx)(`span`,{className:`ar-num`,children:String(e)});switch(t.kind){case`number`:{let r=t.decimals??0;if(t.compact){let t=new Intl.NumberFormat(n,{minimumFractionDigits:r,maximumFractionDigits:r,notation:`compact`}).formatToParts(e);return(0,K.jsx)(`span`,{className:`ar-num`,"aria-label":new Intl.NumberFormat(n).format(e),children:t.map((e,t)=>e.type===`compact`?(0,K.jsx)(`span`,{className:`ar-stat-unit`,"aria-hidden":`true`,children:e.value},t):(0,K.jsx)(`span`,{children:e.value},t))})}return(0,K.jsx)(`span`,{className:`ar-num`,children:new Intl.NumberFormat(n,{minimumFractionDigits:r,maximumFractionDigits:r}).format(e)})}case`currency`:{let r=t.currency,i=t.decimals??2,a=new Intl.NumberFormat(n,{style:`currency`,currency:r,minimumFractionDigits:i,maximumFractionDigits:i}).format(e);return(0,K.jsx)(`span`,{className:`ar-num`,"aria-label":new Intl.NumberFormat(n,{style:`currency`,currency:r,currencyDisplay:`name`,minimumFractionDigits:i,maximumFractionDigits:i}).format(e),children:a})}case`percent`:{let n=t.decimals??2,r=((t.basis??`fraction`)===`fraction`?e*100:e).toFixed(n);return(0,K.jsxs)(`span`,{className:`ar-num`,"aria-label":k().percent(r),children:[r,(0,K.jsx)(`span`,{className:`ar-stat-unit`,"aria-hidden":`true`,children:`%`})]})}default:return(0,K.jsx)(`span`,{className:`ar-num`,children:String(e)})}}function rn({diff:e}){let{value:t,decimals:n=1,upIsPositive:r=!0,label:i}=e,a=t>0,o=t<0,s=r?a:o,c=r?o:a,l=Math.abs(t).toFixed(n);return(0,K.jsxs)(`span`,{className:`ar-stat-delta`,"data-tone":s?`good`:c?`bad`:`flat`,children:[!r&&(0,K.jsx)(`span`,{"aria-hidden":`true`,children:s?`↓`:`↑`}),`${o?`−`:`+`}${l}%`,i&&(0,K.jsx)(`span`,{className:`ar-stat-delta-label`,children:i})]})}function an({stat:e,locale:t}){let n=e.sparkline?.color??`var(--ar-brand)`;return(0,K.jsxs)(`div`,{className:`ar-stat`,children:[e.sparkline&&(0,K.jsx)(tn,{data:e.sparkline.data,color:n,showFill:!0,fillOpacity:.1,className:`ar-stat-spark`}),(0,K.jsx)(`span`,{className:`ar-stat-label`,children:e.label}),(0,K.jsx)(`span`,{className:`ar-stat-value`,children:(0,K.jsx)(nn,{value:e.value,format:e.format,locale:t})}),e.diff&&(0,K.jsx)(rn,{diff:e.diff})]})}function on({id:e,title:t,description:n,stats:r,className:i,locale:a}){let o=a??(typeof navigator<`u`?navigator.language:void 0),s=!!(t||n);return(0,K.jsxs)(`section`,{"data-slot":`stats-display`,"data-tool-ui-id":e,className:p(`ar-card ar-stats-card`,i),"aria-label":t||void 0,children:[s&&(0,K.jsx)(`div`,{className:`ar-card-head`,children:(0,K.jsxs)(`div`,{className:`ar-card-heading`,children:[t&&(0,K.jsx)(`h3`,{className:`ar-card-title`,children:t}),n&&(0,K.jsx)(`p`,{className:`ar-card-sub`,children:n})]})}),(0,K.jsx)(`div`,{className:`ar-stats-grid`,"data-single":r.length===1?`true`:void 0,children:r.map(e=>(0,K.jsx)(an,{stat:e,locale:o},e.key))})]})}var sn=[`/* Messenger cards inside the Concierge thread: booking, request draft,
   guided questions, price list, hand-off, feedback, ratings and the other
   tool results. Built on the card kit in widget-design.css (.ar-card,
   .ar-btn, .ar-field, sheets).

   This file loads before widget-design.css, and ui-surfaces.css styles every
   button/input with an ID-level selector, so every rule here is prefixed with
   :is(#alpharecall-chat-root, .lp-root) (ID specificity, also for the admin
   preview). Borderless: surfaces separate by fills. Icons sit bare. Inside a
   thread card (--ar-fill) controls use --ar-panel; inside a sheet (--ar-panel)
   they use --ar-fill; in dark mode both use --ar-fill-2. */

/* ── Small shared pieces ───────────────────────────────────────────────── */
:is(#alpharecall-chat-root, .lp-root) .ar-sr-only {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
:is(#alpharecall-chat-root, .lp-root) .ar-card-text { margin: 0; color: var(--ar-ink-2); font-size: calc(13.5px * var(--ar-font-scale, 1)); line-height: 1.45; }
:is(#alpharecall-chat-root, .lp-root) .ar-card-icon--ok { color: var(--ar-ok); }
:is(#alpharecall-chat-root, .lp-root) .ar-card-icon--bad { color: var(--ar-red); }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) .ar-card-icon--ok { color: var(--ar-ok); }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) .ar-card-icon--bad { color: var(--ar-red); }
:is(#alpharecall-chat-root, .lp-root) .ar-note {
  margin: 0;
  color: var(--ar-ink-3);
  font-size: calc(12px * var(--ar-font-scale, 1));
  line-height: 1.45;
  text-align: center;
}
:is(#alpharecall-chat-root, .lp-root) .ar-note--start { text-align: left; }
:is(#alpharecall-chat-root, .lp-root) .ar-live-dot {
  width: 8px; height: 8px; flex: none; margin: 0 6px; border-radius: 50%;
  background: var(--ar-live);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ar-live) 20%, transparent) !important;
}

/* Quiet text button ("Leggi tutto", "Salta e scrivi a Sofia", "Ricontattatemi"). */
:is(#alpharecall-chat-root, .lp-root) button.ar-text-btn {
  align-self: flex-start;
  min-height: 32px;
  margin: 0;
  padding: 0 2px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ar-ink-2);
  font: inherit;
  font-size: calc(13px * var(--ar-font-scale, 1));
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
  cursor: pointer;
}
:is(#alpharecall-chat-root, .lp-root) button.ar-text-btn:hover:not(:disabled) { color: var(--ar-ink); }
:is(#alpharecall-chat-root, .lp-root) button.ar-text-btn--center { align-self: center; }
:is(#alpharecall-chat-root, .lp-root) button.ar-text-btn--brand { color: var(--ar-brand); font-weight: 500; text-decoration: none; }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) button.ar-text-btn--brand { color: color-mix(in srgb, var(--ar-brand) 55%, #fff); }
:is(#alpharecall-chat-root, .lp-root) button.ar-text-btn:disabled { background: transparent; color: var(--ar-ink-3); }

/* Bare icon button (pencil, chevrons, done). */
:is(#alpharecall-chat-root, .lp-root) button.ar-icon-btn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: none;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--ar-ink-3);
  cursor: pointer;
}
:is(#alpharecall-chat-root, .lp-root) button.ar-icon-btn svg { width: 16px; height: 16px; stroke-width: 1.8; }
:is(#alpharecall-chat-root, .lp-root) button.ar-icon-btn:hover:not(:disabled) { color: var(--ar-ink); background: color-mix(in srgb, var(--ar-ink) 6%, transparent); }
:is(#alpharecall-chat-root, .lp-root) button.ar-icon-btn:disabled { background: transparent; color: var(--ar-ink-3); opacity: 0.35; }

/* Round header button inside a full sheet (back), same as the sheet close. */
:is(#alpharecall-chat-root, .lp-root) button.ar-round-btn {
  display: grid; place-items: center; width: 34px; height: 34px; flex: none; margin: 0; padding: 0;
  border: 0; border-radius: 50%; background: var(--ar-fill); color: var(--ar-ink-2); cursor: pointer;
}
:is(#alpharecall-chat-root, .lp-root) button.ar-round-btn svg { width: 18px; height: 18px; }
:is(#alpharecall-chat-root, .lp-root) button.ar-round-btn:hover { color: var(--ar-ink); }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) button.ar-round-btn { background: var(--ar-fill-2); }
:is(#alpharecall-chat-root, .lp-root) .ar-round-btn-space { width: 34px; height: 34px; flex: none; }

/* Buttons: sizes the kit does not have. */
:is(#alpharecall-chat-root, .lp-root) .ar-btn.ar-btn--xl { min-height: 50px; border-radius: 16px; font-size: calc(15px * var(--ar-font-scale, 1)); }
:is(#alpharecall-chat-root, .lp-root) .ar-btn.ar-btn--sm { min-height: 36px; padding: 0 12px; border-radius: 12px; font-size: calc(13px * var(--ar-font-scale, 1)); }
:is(#alpharecall-chat-root, .lp-root) .ar-btn-row--main > :first-child:not(:last-child) { flex: 0 0 auto; }
:is(#alpharecall-chat-root, .lp-root) .ar-btn-row--main > :last-child { flex: 1 1 auto; }
/* A waiting primary explains itself ("Scrivi un commento per inviare"): muted, not the tenant color. */
:is(#alpharecall-chat-root, .lp-root) :is(.ar-booking-sheet, .ar-flow-sheet, .ar-feedback-sheet) button.ar-btn--primary:disabled {
  background: var(--ar-fill-2);
  color: var(--ar-ink-3);
  opacity: 1;
  cursor: not-allowed;
  filter: none;
}
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) :is(.ar-booking-sheet, .ar-flow-sheet, .ar-feedback-sheet) button.ar-btn--primary:disabled { background: var(--ar-fill-2); }

/* Tinted pill action on a card ("Chiedi", "Vedi"). A button, so it keeps its fill. */
:is(#alpharecall-chat-root, .lp-root) .ar-chip {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  margin: 0;
  padding: 0 11px;
  border: 0;
  border-radius: 999px;
  background: var(--ar-brand-soft);
  color: var(--ar-brand);
  font: inherit;
  font-size: calc(12.5px * var(--ar-font-scale, 1));
  font-weight: 500;
  line-height: 1;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
}
:is(#alpharecall-chat-root, .lp-root) .ar-chip:hover { background: color-mix(in srgb, var(--ar-brand) 18%, var(--ar-panel)); }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) .ar-chip {
  background: color-mix(in srgb, var(--ar-brand) 22%, var(--ar-fill-2));
  color: color-mix(in srgb, var(--ar-brand) 45%, #fff);
}

/* Fields: a taller comment box and a hint line. */
:is(#alpharecall-chat-root, .lp-root) .ar-field.ar-field--tall { min-height: 92px; }
:is(#alpharecall-chat-root, .lp-root) .ar-field textarea { resize: none; field-sizing: content; min-height: 44px; max-height: 160px; }
:is(#alpharecall-chat-root, .lp-root) .ar-field-hint { color: var(--ar-ink-3); font-size: calc(12px * var(--ar-font-scale, 1)); }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) .ar-card .ar-field { background: var(--ar-fill-2); }
/* Those fields already rest on fill-2, so focus lifts them one more step. */
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) :is(.ar-card, .ar-sheet) .ar-field:has(:focus) { background: color-mix(in srgb, var(--ar-ink) 5%, var(--ar-fill-2)); }
:is(#alpharecall-chat-root, .lp-root) .ar-field select { appearance: auto; }

/* Sheet extras. */
:is(#alpharecall-chat-root, .lp-root) .ar-sheet-title.ar-sheet-title--sm { font-size: calc(17px * var(--ar-font-scale, 1)); }
:is(#alpharecall-chat-root, .lp-root) .ar-sheet-head.ar-sheet-head--center { align-items: center; padding: 6px 36px 0; text-align: center; gap: 4px; }

/* ── Booking (w-booking B) ─────────────────────────────────────────────── */
:is(#alpharecall-chat-root, .lp-root) .ar-days { display: flex; gap: 6px; min-width: 0; }
:is(#alpharecall-chat-root, .lp-root) button.ar-day {
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  margin: 0;
  padding: 7px 0;
  border: 0;
  border-radius: 14px;
  background: var(--ar-panel);
  color: var(--ar-ink-2);
  font: inherit;
  font-size: calc(11.5px * var(--ar-font-scale, 1));
  font-weight: 400;
  line-height: 1.3;
  cursor: pointer;
}
:is(#alpharecall-chat-root, .lp-root) button.ar-day b { color: var(--ar-ink); font-size: calc(16px * var(--ar-font-scale, 1)); font-weight: 500; font-variant-numeric: tabular-nums; }
:is(#alpharecall-chat-root, .lp-root) button.ar-day:hover { background: var(--ar-fill-2); }
:is(#alpharecall-chat-root, .lp-root) .ar-sheet button.ar-day { background: var(--ar-fill); }
:is(#alpharecall-chat-root, .lp-root) .ar-sheet button.ar-day:hover { background: var(--ar-fill-2); }
:is(#alpharecall-chat-root, .lp-root) button.ar-day[aria-checked="true"],
:is(#alpharecall-chat-root, .lp-root) .ar-sheet button.ar-day[aria-checked="true"] { background: var(--ar-ink); color: var(--ar-panel); }
:is(#alpharecall-chat-root, .lp-root) button.ar-day[aria-checked="true"] b { color: var(--ar-panel); }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) button.ar-day { background: var(--ar-fill-2); }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) button.ar-day[aria-checked="true"] { background: var(--ar-ink); color: var(--ar-fill); }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) button.ar-day[aria-checked="true"] b { color: var(--ar-fill); }

:is(#alpharecall-chat-root, .lp-root) .ar-booking-month { display: flex; align-items: center; justify-content: space-between; min-height: 32px; font-size: calc(13.5px * var(--ar-font-scale, 1)); }
:is(#alpharecall-chat-root, .lp-root) .ar-booking-month b { font-weight: 500; }
:is(#alpharecall-chat-root, .lp-root) .ar-booking-pager { display: flex; gap: 2px; }
:is(#alpharecall-chat-root, .lp-root) .ar-booking-day { margin: 0; color: var(--ar-ink-3); font-size: calc(12.5px * var(--ar-font-scale, 1)); }

:is(#alpharecall-chat-root, .lp-root) .ar-slots { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
:is(#alpharecall-chat-root, .lp-root) button.ar-slot {
  margin: 0;
  padding: 10px 0;
  border: 0;
  border-radius: 12px;
  background: var(--ar-fill);
  color: var(--ar-ink);
  font: inherit;
  font-size: calc(14px * var(--ar-font-scale, 1));
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
:is(#alpharecall-chat-root, .lp-root) button.ar-slot:hover { background: var(--ar-fill-2); }
:is(#alpharecall-chat-root, .lp-root) button.ar-slot[aria-checked="true"] { background: var(--ar-brand); color: var(--ar-brand-ink); font-weight: 500; }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) button.ar-slot:not([aria-checked="true"]) { background: var(--ar-fill-2); }
:is(#alpharecall-chat-root, .lp-root) .ar-booking-sheet { gap: 12px; }
:is(#alpharecall-chat-root, .lp-root) .ar-booking-sheet .ar-btn--lg { margin-top: 2px; }

/* ── Request draft (w-draft B) ─────────────────────────────────────────── */
:is(#alpharecall-chat-root, .lp-root) .ar-card.ar-draft-card { gap: 4px; padding: 6px; }
:is(#alpharecall-chat-root, .lp-root) .ar-draft-card > .ar-card-head { padding: 10px 10px 4px; }
:is(#alpharecall-chat-root, .lp-root) .ar-draft-rows { display: flex; flex-direction: column; gap: 2px; margin: 0; }
:is(#alpharecall-chat-root, .lp-root) .ar-draft-row { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 7px 6px 7px 10px; border-radius: 12px; }
:is(#alpharecall-chat-root, .lp-root) .ar-draft-row[data-editing] { padding: 2px 6px 2px 0; }
:is(#alpharecall-chat-root, .lp-root) .ar-draft-text { display: flex; flex: 1 1 auto; flex-direction: column; gap: 1px; min-width: 0; }
:is(#alpharecall-chat-root, .lp-root) .ar-draft-text dd { display: flex; flex-direction: column; align-items: flex-start; margin: 0; min-width: 0; }
:is(#alpharecall-chat-root, .lp-root) .ar-draft-value { color: var(--ar-ink); font-size: calc(14.5px * var(--ar-font-scale, 1)); line-height: 1.4; overflow-wrap: anywhere; white-space: pre-wrap; }
:is(#alpharecall-chat-root, .lp-root) .ar-draft-value[data-clamped] { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
:is(#alpharecall-chat-root, .lp-root) .ar-draft-edit { flex: 1 1 auto; }
:is(#alpharecall-chat-root, .lp-root) .ar-draft-actions { display: flex; flex-direction: column; gap: 8px; padding: 6px 6px 6px; }
:is(#alpharecall-chat-root, .lp-root) .ar-draft-sending {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 6px 6px 6px 10px; color: var(--ar-ink-2); font-size: calc(13.5px * var(--ar-font-scale, 1)); font-variant-numeric: tabular-nums;
}
:is(#alpharecall-chat-root, .lp-root) .ar-draft-card[data-state="sent"] .ar-draft-row { padding-top: 5px; padding-bottom: 5px; }
:is(#alpharecall-chat-root, .lp-root) .ar-draft-card .ar-draft-error { margin: 0; padding: 4px 10px 0; color: var(--ar-red); }

/* ── Guided questions (w-flow B) ───────────────────────────────────────── */
/* The step sheet takes the whole panel body; the chat header stays above it. */
:is(#alpharecall-chat-root, .lp-root) .ar-sheet.ar-sheet--full { height: 100%; gap: 0; padding: 12px 18px 16px; }
:is(#alpharecall-chat-root, .lp-root) .ar-sheet.ar-sheet--full > .ar-sheet-handle { display: none; }
:is(#alpharecall-chat-root, .lp-root) .ar-flow-top { display: flex; align-items: center; gap: 10px; min-height: 34px; }
:is(#alpharecall-chat-root, .lp-root) .ar-flow-heading { display: flex; flex: 1 1 auto; flex-direction: column; align-items: center; min-width: 0; line-height: 1.3; text-align: center; }
:is(#alpharecall-chat-root, .lp-root) .ar-flow-heading b { font-size: calc(14px * var(--ar-font-scale, 1)); font-weight: 600; }
:is(#alpharecall-chat-root, .lp-root) .ar-flow-heading small { color: var(--ar-ink-3); font-size: calc(12.5px * var(--ar-font-scale, 1)); font-variant-numeric: tabular-nums; }
:is(#alpharecall-chat-root, .lp-root) .ar-progress { display: flex; gap: 4px; margin-top: 12px; }
:is(#alpharecall-chat-root, .lp-root) .ar-progress i { flex: 1 1 0; height: 4px; border-radius: 4px; background: var(--ar-fill-2); transition: background-color var(--ar-duration, 260ms) ease; }
:is(#alpharecall-chat-root, .lp-root) .ar-progress i[data-on] { background: var(--ar-brand); }
:is(#alpharecall-chat-root, .lp-root) .ar-flow-body {
  display: flex; flex: 1 1 auto; flex-direction: column; gap: 14px; min-height: 0; padding: 26px 0 14px;
  animation: ar-message-enter var(--ar-duration, 260ms) var(--ar-ease, ease) both;
}
:is(#alpharecall-chat-root, .lp-root) .ar-flow-question { margin: 0 0 4px; font-size: calc(24px * var(--ar-font-scale, 1)); font-weight: 600; line-height: 1.15; letter-spacing: -0.035em; }
:is(#alpharecall-chat-root, .lp-root) .ar-options { display: flex; flex-direction: column; gap: 8px; }
:is(#alpharecall-chat-root, .lp-root) button.ar-option {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 56px;
  margin: 0;
  padding: 13px 16px;
  border: 0;
  border-radius: 18px;
  background: var(--ar-fill);
  color: var(--ar-ink);
  font: inherit;
  font-weight: 400;
  text-align: left;
  cursor: pointer;
}
:is(#alpharecall-chat-root, .lp-root) button.ar-option:hover:not(:disabled) { background: var(--ar-fill-2); }
:is(#alpharecall-chat-root, .lp-root) button.ar-option[aria-checked="true"] { background: var(--ar-brand-soft); }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) button.ar-option { background: var(--ar-fill-2); }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) button.ar-option[aria-checked="true"] { background: color-mix(in srgb, var(--ar-brand) 26%, var(--ar-fill-2)); }
:is(#alpharecall-chat-root, .lp-root) .ar-option-text { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; line-height: 1.35; }
:is(#alpharecall-chat-root, .lp-root) .ar-option-text b { font-size: calc(15px * var(--ar-font-scale, 1)); font-weight: 500; overflow-wrap: anywhere; }
:is(#alpharecall-chat-root, .lp-root) .ar-option-text small { color: var(--ar-ink-3); font-size: calc(12.5px * var(--ar-font-scale, 1)); }
:is(#alpharecall-chat-root, .lp-root) .ar-option-check { width: 18px; height: 18px; flex: none; color: var(--ar-brand); stroke-width: 2.2; }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) .ar-option-check { color: color-mix(in srgb, var(--ar-brand) 50%, #fff); }
:is(#alpharecall-chat-root, .lp-root) .ar-option-icon { display: grid; place-items: center; color: var(--ar-ink-2); }
:is(#alpharecall-chat-root, .lp-root) .ar-flow-actions { display: flex; flex-direction: column; gap: 6px; padding-top: 6px; }
:is(#alpharecall-chat-root, .lp-root) .ar-flow-sheet .ar-flow-actions .ar-text-btn { text-decoration: none; color: var(--ar-ink-3); }

/* ── Price list and carousels (w-prices B) ─────────────────────────────── */
:is(#alpharecall-chat-root, .lp-root) .ar-prices { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
:is(#alpharecall-chat-root, .lp-root) .ar-prices-title { margin: 0; color: var(--ar-ink-2); font-size: calc(13px * var(--ar-font-scale, 1)); font-weight: 500; }
:is(#alpharecall-chat-root, .lp-root) .ar-carousel { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
/* The row bleeds to the panel edge so the next card peeks in. */
:is(#alpharecall-chat-root, .lp-root) .ar-carousel-track {
  display: flex;
  gap: 8px;
  margin: 0 -18px;
  padding: 0 18px;
  list-style: none;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scroll-snap-type: x mandatory;
  scroll-padding-inline: 18px;
  scrollbar-width: none;
}
:is(#alpharecall-chat-root, .lp-root) .ar-carousel-track::-webkit-scrollbar { display: none; }
:is(#alpharecall-chat-root, .lp-root) .ar-carousel-card {
  display: flex;
  flex: 0 0 170px;
  flex-direction: column;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  border-radius: 18px;
  background: var(--ar-fill);
  scroll-snap-align: start;
}
/* A product card is one link to the product page (the chip only labels it). */
:is(#alpharecall-chat-root, .lp-root) a.ar-carousel-link {
  display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0;
  color: inherit; text-decoration: none; border-radius: inherit; cursor: pointer;
}
:is(#alpharecall-chat-root, .lp-root) a.ar-carousel-link:hover .ar-carousel-title { text-decoration: underline; text-underline-offset: 2px; }
:is(#alpharecall-chat-root, .lp-root) a.ar-carousel-link:focus-visible { outline: 2px solid var(--ar-brand); outline-offset: -2px; }
:is(#alpharecall-chat-root, .lp-root) .ar-carousel-img { display: block; width: 100%; height: 100px; max-width: none; margin: 0; object-fit: cover; border-radius: 0; background: var(--ar-fill-2); }
:is(#alpharecall-chat-root, .lp-root) .ar-carousel-body { display: flex; flex: 1 1 auto; flex-direction: column; gap: 2px; padding: 11px 12px 12px; line-height: 1.3; }
:is(#alpharecall-chat-root, .lp-root) .ar-carousel-badge { align-self: flex-start; margin-bottom: 4px; color: var(--ar-ok); font-size: calc(11.5px * var(--ar-font-scale, 1)); font-weight: 500; }
:is(#alpharecall-chat-root, .lp-root) .ar-carousel-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: calc(14px * var(--ar-font-scale, 1)); font-weight: 500; }
:is(#alpharecall-chat-root, .lp-root) .ar-carousel-sub { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--ar-ink-3); font-size: calc(12px * var(--ar-font-scale, 1)); }
:is(#alpharecall-chat-root, .lp-root) .ar-carousel-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; padding-top: 10px; }
:is(#alpharecall-chat-root, .lp-root) .ar-carousel-price { font-size: calc(14px * var(--ar-font-scale, 1)); font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
:is(#alpharecall-chat-root, .lp-root) .ar-dots { display: flex; justify-content: center; gap: 0; }
:is(#alpharecall-chat-root, .lp-root) button.ar-dot {
  display: grid; place-items: center; width: 15px; height: 15px; margin: 0; padding: 0; border: 0; border-radius: 6px;
  background: transparent; cursor: pointer;
}
:is(#alpharecall-chat-root, .lp-root) button.ar-dot::before { content: ""; display: block; width: 5px; height: 5px; border-radius: 5px; background: var(--ar-fill-2); transition: width 200ms ease, background-color 200ms ease; }
:is(#alpharecall-chat-root, .lp-root) button.ar-dot[data-on] { width: 24px; }
:is(#alpharecall-chat-root, .lp-root) button.ar-dot[data-on]::before { width: 16px; background: var(--ar-brand); }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) .ar-carousel-card { background: var(--ar-fill); }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) button.ar-dot::before { background: var(--ar-fill-2); }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) button.ar-dot[data-on]::before { background: color-mix(in srgb, var(--ar-brand) 55%, #fff); }
@media (max-width: 768px) {
  #alpharecall-chat-root .ar-chat-shell .ar-carousel-track { margin: 0 -16px; padding: 0 16px; scroll-padding-inline: 16px; }
}

/* Plain tables: two columns, six rows, on the card fill. */
:is(#alpharecall-chat-root, .lp-root) .ar-card.ar-table-card { gap: 10px; padding: 12px; }
:is(#alpharecall-chat-root, .lp-root) .ar-table-card > .ar-card-heading { padding: 2px 4px 0; }
:is(#alpharecall-chat-root, .lp-root) .ar-rows { display: flex; flex-direction: column; margin: 0; padding: 4px; list-style: none; border-radius: 14px; background: var(--ar-panel); }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) .ar-rows { background: var(--ar-fill-2); }
:is(#alpharecall-chat-root, .lp-root) .ar-row { display: flex; justify-content: space-between; gap: 12px; margin: 0; padding: 8px 10px; border-radius: 10px; font-size: calc(13.5px * var(--ar-font-scale, 1)); line-height: 1.4; }
:is(#alpharecall-chat-root, .lp-root) .ar-row:nth-child(even) { background: var(--ar-fill); }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) .ar-row:nth-child(even) { background: color-mix(in srgb, var(--ar-ink) 4%, transparent); }
:is(#alpharecall-chat-root, .lp-root) .ar-row-label { min-width: 0; overflow-wrap: anywhere; }
:is(#alpharecall-chat-root, .lp-root) .ar-row-value { flex: none; max-width: 55%; color: var(--ar-ink-2); font-variant-numeric: tabular-nums; text-align: right; overflow-wrap: anywhere; }
:is(#alpharecall-chat-root, .lp-root) .ar-row--stack { flex-direction: column; gap: 3px; }
:is(#alpharecall-chat-root, .lp-root) .ar-row--stack .ar-row-label { font-weight: 500; }
:is(#alpharecall-chat-root, .lp-root) .ar-row-details { display: flex; flex-wrap: wrap; gap: 2px 12px; margin: 0; color: var(--ar-ink-2); font-size: calc(12.5px * var(--ar-font-scale, 1)); }
:is(#alpharecall-chat-root, .lp-root) .ar-row-details > div { display: flex; gap: 4px; min-width: 0; }
:is(#alpharecall-chat-root, .lp-root) .ar-row-details dt { color: var(--ar-ink-3); }
:is(#alpharecall-chat-root, .lp-root) .ar-row-details dt::after { content: ":"; }
:is(#alpharecall-chat-root, .lp-root) .ar-row-details dd { margin: 0; font-variant-numeric: tabular-nums; }
:is(#alpharecall-chat-root, .lp-root) .ar-table-card > .ar-text-btn { margin-left: 4px; }

/* ── Hand-off (w-handoff B) ────────────────────────────────────────────── */
:is(#alpharecall-chat-root, .lp-root) .ar-card.ar-handoff-card { gap: 10px; }
@keyframes ar-wait-slide { from { transform: translateX(-100%); } to { transform: translateX(260%); } }
:is(#alpharecall-chat-root, .lp-root) .ar-wait-bar { height: 4px; overflow: hidden; border-radius: 4px; background: var(--ar-panel); }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) .ar-wait-bar { background: var(--ar-fill-2); }
:is(#alpharecall-chat-root, .lp-root) .ar-wait-bar i { display: block; width: 35%; height: 100%; border-radius: 4px; background: var(--ar-brand); animation: ar-wait-slide 1.8s cubic-bezier(0.45, 0, 0.55, 1) infinite; }
:is(#alpharecall-chat-root, .lp-root) .ar-handoff-alt { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--ar-ink-2); font-size: calc(13px * var(--ar-font-scale, 1)); }
:is(#alpharecall-chat-root, .lp-root) .ar-handoff-alt .ar-text-btn { align-self: center; }
:is(#alpharecall-chat-root, .lp-root) .ar-handoff-form { display: grid; gap: 8px; }
:is(#alpharecall-chat-root, .lp-root) .ar-handoff-form .ar-note { margin: 0; text-align: left; }
:is(#alpharecall-chat-root, .lp-root) .ar-handoff-form .ar-btn { justify-self: start; }
:is(#alpharecall-chat-root, .lp-root) .ar-handoff-error { margin: 0; color: var(--ar-danger, #b42318); font-size: calc(12.5px * var(--ar-font-scale, 1)); }
:is(#alpharecall-chat-root, .lp-root) .ar-handoff-new { justify-self: start; align-self: flex-start; }

/* ── Feedback (w-feedback B) ───────────────────────────────────────────── */
:is(#alpharecall-chat-root, .lp-root) .ar-stars { display: flex; justify-content: center; gap: 6px; }
:is(#alpharecall-chat-root, .lp-root) button.ar-star {
  display: grid; place-items: center; width: 44px; height: 44px; margin: 0; padding: 0; border: 0; border-radius: 12px;
  background: transparent; color: var(--ar-fill-2); cursor: pointer;
}
:is(#alpharecall-chat-root, .lp-root) button.ar-star svg { width: 34px; height: 34px; fill: currentColor; stroke-width: 1; }
:is(#alpharecall-chat-root, .lp-root) button.ar-star[data-on] { color: var(--ar-brand); }
:is(#alpharecall-chat-root, .lp-root) button.ar-star:hover:not([data-on]) { color: color-mix(in srgb, var(--ar-brand) 30%, var(--ar-fill-2)); }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) button.ar-star { color: var(--ar-fill-2); }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) button.ar-star[data-on] { color: color-mix(in srgb, var(--ar-brand) 55%, #fff); }
:is(#alpharecall-chat-root, .lp-root) .ar-feedback-sheet .ar-feedback-done-icon { width: 32px; height: 32px; margin: 0 auto 6px; }
:is(#alpharecall-chat-root, .lp-root) .ar-feedback-sheet .ar-sheet-head .ar-stars--static { justify-content: center; margin-top: 10px; }
:is(#alpharecall-chat-root, .lp-root) .ar-feedback-sheet .ar-note[data-error] { color: var(--ar-red); margin: 0; }
:is(#alpharecall-chat-root, .lp-root) .ar-stars--static { justify-content: flex-start; gap: 3px; color: var(--ar-fill-2); }
:is(#alpharecall-chat-root, .lp-root) .ar-stars--static svg { width: 18px; height: 18px; fill: currentColor; stroke-width: 1; }
:is(#alpharecall-chat-root, .lp-root) .ar-stars--static svg[data-on] { color: var(--ar-brand); }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) .ar-stars--static svg[data-on] { color: color-mix(in srgb, var(--ar-brand) 55%, #fff); }
:is(#alpharecall-chat-root, .lp-root) .ar-card.ar-feedback-card { gap: 8px; }
:is(#alpharecall-chat-root, .lp-root) .ar-feedback-sheet .ar-sheet-form { gap: 12px; }

/* ── Business details without a map ────────────────────────────────────── */
:is(#alpharecall-chat-root, .lp-root) .ar-info-status,
:is(#alpharecall-chat-root, .lp-root) .ar-info-line {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0 2px;
  font-size: calc(13.5px * var(--ar-font-scale, 1)); line-height: 1.4;
}
:is(#alpharecall-chat-root, .lp-root) .ar-info-status b { font-weight: 500; }
:is(#alpharecall-chat-root, .lp-root) .ar-info-status > span:last-child { color: var(--ar-ink-3); }
:is(#alpharecall-chat-root, .lp-root) .ar-info-status .ar-live-dot { margin: 0 2px; }
:is(#alpharecall-chat-root, .lp-root) :is(.ar-info-status, .ar-info-line) svg { width: 16px; height: 16px; flex: none; color: var(--ar-ink-3); }
:is(#alpharecall-chat-root, .lp-root) .ar-info-card .ar-map-hours { padding: 0 2px; }
:is(#alpharecall-chat-root, .lp-root) .ar-info-card .ar-btn--secondary { background: var(--ar-panel); }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) .ar-info-card .ar-btn--secondary { background: var(--ar-fill-2); }

/* ── Events ────────────────────────────────────────────────────────────── */
:is(#alpharecall-chat-root, .lp-root) .ar-events { min-width: 0; }
:is(#alpharecall-chat-root, .lp-root) .ar-event-card { flex-basis: 200px; }
:is(#alpharecall-chat-root, .lp-root) .ar-event-card .ar-carousel-body { gap: 4px; }
:is(#alpharecall-chat-root, .lp-root) .ar-event-date { display: flex; align-items: center; gap: 6px; color: var(--ar-ink-2); font-size: calc(12px * var(--ar-font-scale, 1)); }
:is(#alpharecall-chat-root, .lp-root) :is(.ar-event-date, .ar-event-place) svg { width: 14px; height: 14px; flex: none; color: var(--ar-ink-3); }
:is(#alpharecall-chat-root, .lp-root) .ar-event-place { display: flex; align-items: center; gap: 5px; }
:is(#alpharecall-chat-root, .lp-root) .ar-event-seats { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; color: var(--ar-ink-3); font-size: calc(11.5px * var(--ar-font-scale, 1)); }
:is(#alpharecall-chat-root, .lp-root) .ar-meter { display: block; height: 4px; overflow: hidden; border-radius: 4px; background: var(--ar-fill-2); }
:is(#alpharecall-chat-root, .lp-root) .ar-meter i { display: block; height: 100%; border-radius: 4px; background: var(--ar-brand); }
:is(#alpharecall-chat-root, .lp-root) .ar-spacer { flex: 1 1 auto; min-height: 8px; }

/* ── Coupon ────────────────────────────────────────────────────────────── */
:is(#alpharecall-chat-root, .lp-root) .ar-coupon-code { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-radius: 14px; background: var(--ar-panel); }
:is(#alpharecall-chat-root .ar-chat-shell[data-theme="dark"], .lp-root[data-theme="dark"]) .ar-coupon-code { background: var(--ar-fill-2); }
:is(#alpharecall-chat-root, .lp-root) .ar-coupon-code code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: calc(14px * var(--ar-font-scale, 1)); font-weight: 600; letter-spacing: 0.06em; background: transparent; padding: 0; }
:is(#alpharecall-chat-root, .lp-root) .ar-coupon-code b { color: var(--ar-ok); font-weight: 600; }

/* ── Quick answers (clarify without a question flow) ───────────────────── */
:is(#alpharecall-chat-root, .lp-root) .ar-choice-chips { display: flex; flex-wrap: wrap; gap: 6px; }
:is(#alpharecall-chat-root, .lp-root) button.ar-choice-chip {
  min-height: 36px; margin: 0; padding: 0 14px; border: 0; border-radius: 999px;
  background: var(--ar-fill); color: var(--ar-ink); font: inherit; font-size: calc(13.5px * var(--ar-font-scale, 1)); font-weight: 400; cursor: pointer;
}
:is(#alpharecall-chat-root, .lp-root) button.ar-choice-chip:hover:not(:disabled) { background: var(--ar-fill-2); }
:is(#alpharecall-chat-root, .lp-root) button.ar-choice-chip:disabled { background: var(--ar-fill); color: var(--ar-ink-3); }
:is(#alpharecall-chat-root, .lp-root) button.ar-choice-chip[data-picked]:disabled { background: var(--ar-brand); color: var(--ar-brand-ink); font-weight: 500; }

/* ── Forms on a card (search refinement, quick checkout) ───────────────── */
:is(#alpharecall-chat-root, .lp-root) .ar-card.ar-form-card { gap: 8px; }
:is(#alpharecall-chat-root, .lp-root) .ar-form-card > .ar-card-head { margin-bottom: 4px; }
:is(#alpharecall-chat-root, .lp-root) .ar-form-card > .ar-btn { margin-top: 4px; }

/* ── Answer ratings (thumbs next to copy and retry) ────────────────────── */
:is(#alpharecall-chat-root, .lp-root) .ar-msg-actions button.ar-chat-action-icon.ar-rate[aria-pressed="true"][data-rate] {
  background: transparent;
  color: var(--ar-ink);
  font-weight: inherit;
}
:is(#alpharecall-chat-root, .lp-root) .ar-msg-actions button.ar-chat-action-icon.ar-rate[aria-pressed="true"][data-rate] svg { fill: currentColor; fill-opacity: 1; }
/* A tap leaves :hover stuck on touch screens; the pressed fill already says it was chosen. */
@media (hover: none) {
  :is(#alpharecall-chat-root, .lp-root) .ar-msg-actions button.ar-chat-action-icon.ar-rate[data-rate]:hover { background: transparent; }
}
:is(#alpharecall-chat-root, .lp-root) .ar-rate-note { align-self: center; margin-left: 6px; color: var(--ar-ink-3); font-size: calc(12px * var(--ar-font-scale, 1)); }
:is(#alpharecall-chat-root, .lp-root) .ar-rate-note[data-error] { color: var(--ar-red); }

@media (prefers-reduced-motion: reduce) {
  :is(#alpharecall-chat-root, .lp-root) .ar-wait-bar i { animation: none; width: 100%; opacity: 0.35; }
}
`,y].join(`
`).split(`.lp-root`).join(`#alpharecall-admin-app .lp-root`),cn=new Set([`data_table`,`table`]),ln=new Set([`chart`,`bar_chart`,`line_chart`,`area_chart`]),un=new Set([`stats`,`stats_display`]),dn=new Set([`consent_required`,`appointment_slots`,`event_list`,`geo_map`,`map`,`locations`,`message_draft`,`draft`,`order_summary`,`cart`,`product_list`,`product_carousel`,`product_suggestions`,`products`,`fast_checkout`,`checkout_form`]);function fn(e){return String(e.type??``).trim().toLowerCase()}var pn=e=>Array.isArray(e)&&e.length>0;function mn(e){let t=e=>fn(e)===`consent_required`?0:e.draft_id?1:2,n=e.map((e,t)=>({component:e,index:t})).sort((e,n)=>t(e.component)-t(n.component)||e.index-n.index).map(({component:e})=>e);for(let e of n){let n=fn(e);if(t(e)<2)return{component:e,drawable:!1};if(cn.has(n)){if(pn(e.data))return{component:e,drawable:!0};continue}if(n===`clarify`||n===`question_flow`){if(pn(e.items)||pn(e.options))return{component:e,drawable:!1};continue}if(ln.has(n)||un.has(n))return{component:e,drawable:!0};if(dn.has(n)||n===`tool_status`&&String(e.status??``).toLowerCase()!==`error`)return{component:e,drawable:!1}}return null}function hn({component:e}){let{theme:t,settings:n}=g(),r=n.chat_config||{},i=/^#[0-9a-f]{6}$/i.test(String(r.primaryColor||``))?String(r.primaryColor):``,a=fn(e),o=i?{"--ar-tenant":i,"--ar-on-tenant":x(i)}:void 0,s=null;if(cn.has(a))s=(0,K.jsx)(Et,{component:e});else if(ln.has(a)){let t=e.chart_type||(a===`line_chart`?`line`:`bar`);s=(0,K.jsx)(en,{...e,type:t})}else un.has(a)&&(s=(0,K.jsx)(on,{locale:`it-IT`,...e}));return s?(0,K.jsxs)(`div`,{className:`lp-root as-prova-card`,"data-theme":t,style:o,children:[(0,K.jsx)(`style`,{children:sn}),(0,K.jsx)(ht,{tool:a,children:s})]}):null}function gn(e){return e==null||typeof e==`boolean`?``:typeof e==`string`||typeof e==`number`?String(e):Array.isArray(e)?e.map(gn).join(``):(0,B.isValidElement)(e)?gn(e.props.children):``}function _n(e){let t=e.trim();return t.length>0&&t.length<=24&&/\d/.test(t)&&/^[\d\s.,:/%+\-–×x€$£()]+$/i.test(t)}var vn={...ce,th:({children:e,style:t})=>(0,K.jsx)(`th`,{className:`border border-border bg-muted px-4 py-2 font-semibold`,style:t,"data-figure":_n(gn(e))?``:void 0,children:e}),td:({children:e,style:t})=>(0,K.jsx)(`td`,{className:`border border-border px-4 py-2`,style:t,"data-figure":_n(gn(e))?``:void 0,children:e})},yn=15e3,bn=[`friendly`,`professional`,`creative`];function xn(){ie({fill:!0});let{t:e,settings:t,licenseTier:n}=g(),r=n===`business`||n===`enterprise`,a=oe(),c=re(t,e(`assistant.common.fallbackName`)),f=re(t,``),p=t.tenant_settings||{},v=t.chat_config||{},y=String(p.chatbot_tone||``),x=bn.includes(y)?e(`persona.${y}`):y&&y!==`custom`?y:``,C=Array.isArray(v.starterQuestions)?v.starterQuestions:Array.isArray(v.starter_questions)?v.starter_questions:[],w=l(),T=v.enabled===!1,E=w.chatAvailable===!1||T,[O,k]=(0,B.useState)([]),[ce,A]=(0,B.useState)(null),[j,M]=(0,B.useState)(``),N=ne(j),P=(0,B.useRef)(null),F=(0,B.useRef)(null),le=(0,B.useRef)(1),I=(0,B.useRef)(null),L=(0,B.useRef)(null),R=O.some(e=>e.pending),ue=O.find(e=>e.id===ce)??null,de=O[O.length-1],[,fe]=(0,B.useState)(0),pe=de?.retryAt??0;(0,B.useEffect)(()=>()=>F.current?.abort(),[]),(0,B.useEffect)(()=>{I.current?.scrollTo({top:I.current.scrollHeight,behavior:`smooth`})},[O.length,R]),(0,B.useEffect)(()=>{let e=pe-Date.now();if(e<=0)return;let t=window.setTimeout(()=>fe(e=>e+1),e+50);return()=>window.clearTimeout(t)},[pe]);function me(t){return t instanceof H?kn(t)?e(`assistant.prova.errorRoles`):t.kind===`expired`?e(`assistant.prova.errorExpired`):t.kind===`session`||t.kind===`visitor`?e(`assistant.prova.errorSession`):t.kind===`quota`?e(`assistant.prova.errorQuota`):t.kind===`rate`?Tn(e,t.retryAfterMs):t.kind===`blocked`?Tn(e,t.retryAfterMs,`errorBlocked`):t.kind===`challenge`?e(`assistant.prova.errorChallenge`):t.kind===`timeout`?s(e(`assistant.prova.errorTimeout`),{name:c}):t.kind===`empty`?s(e(`assistant.prova.errorEmpty`),{name:c}):t.kind===`unreadable`?s(e(`assistant.prova.errorUnreadable`),{name:c}):s(e(`assistant.prova.errorChat`),{name:c}):e(`assistant.prova.errorNetwork`)}async function z(e){let t=e.trim();if(!t||R||E)return;let n=le.current++;k(e=>[...e,{id:n,question:t,pending:!0}]),A(n),M(``),L.current&&(L.current.style.height=``);let r=new AbortController;F.current=r;try{let e=await pt(t,P.current,r.signal);P.current=e.conversationId,k(t=>t.map(t=>t.id===n?{...t,reply:e,pending:!1}:t))}catch(e){if(r.signal.aborted)return;if(e instanceof H&&e.kind===`handoff`){let t=e.handoff??{conversationId:P.current,chatStatus:`handoff`};t.conversationId&&(P.current=t.conversationId),k(e=>e.map(e=>e.id===n?{...e,handoff:t,pending:!1}:e));return}e instanceof H||console.warn(`AlphaRecall: the Prova request failed`,e);let t=e instanceof H?e.kind:`network`,i=e instanceof H&&kn(e)?`widget`:t===`expired`?`reload`:void 0,a=!i&&t!==`quota`,o=e instanceof H&&(e.kind===`rate`||e.kind===`blocked`)?Date.now()+(e.retryAfterMs??wn):void 0;k(r=>r.map(r=>r.id===n?{...r,error:me(e),errorKind:t,errorFix:i,retryable:a,retryAt:o,pending:!1}:r))}finally{F.current===r&&(F.current=null)}}function he(e){R||(e.retryAt??0)>Date.now()||(k(t=>t.filter(t=>t.id!==e.id)),z(e.question))}function ge(){F.current?.abort(),F.current=null,P.current=null,k([]),A(null),M(``),L.current?.focus()}return(0,K.jsxs)(`div`,{className:`as-prova`,children:[(0,K.jsx)(ee,{title:s(e(`assistant.prova.title`),{name:c}),subtitle:e(`assistant.prova.subtitle`),actions:(0,K.jsxs)(S,{variant:`secondary`,onClick:ge,disabled:O.length===0,children:[(0,K.jsx)(h,{className:`size-4`}),e(`assistant.prova.restart`)]})}),E?(0,K.jsx)(D,{icon:o,title:e(T?`assistant.prova.widgetOffTitle`:`assistant.prova.unavailableTitle`),description:T?i(e,`assistant.prova.widgetOffBody`,f):w.chatUnavailableReason||i(e,`assistant.prova.unavailableBody`,f),action:T?(0,K.jsx)(S,{variant:`secondary`,onClick:()=>a(`widget/widget`),children:e(`assistant.prova.openWidget`)}):void 0}):(0,K.jsxs)(K.Fragment,{children:[(0,K.jsxs)(`div`,{className:`as-prova-cols`,children:[(0,K.jsxs)(`section`,{className:`as-prova-col`,"aria-labelledby":`as-prova-chat`,ref:I,children:[(0,K.jsxs)(`div`,{className:`as-prova-col-head`,children:[(0,K.jsx)(`b`,{id:`as-prova-chat`,children:e(`assistant.prova.visitorView`)}),x&&(0,K.jsx)(ae,{children:x})]}),O.length===0?(0,K.jsxs)(`div`,{className:`flex flex-col gap-3`,children:[(0,K.jsx)(`p`,{className:`text-[13px] text-ink-2`,children:s(e(`assistant.prova.emptyBody`),{name:c})}),C.length>0&&(0,K.jsx)(`div`,{className:`as-suggestions`,"aria-label":e(`assistant.prova.suggestions`),role:`group`,children:C.map(e=>(0,K.jsx)(`button`,{type:`button`,className:`as-suggestion`,onClick:()=>void z(e),children:e},e))})]}):(0,K.jsx)(`ol`,{className:`as-msgs`,"aria-live":`polite`,"aria-label":e(`assistant.prova.conversation`),children:O.map(t=>(0,K.jsxs)(`li`,{className:`contents`,children:[(0,K.jsx)(`div`,{className:`as-v`,children:t.question}),t.handoff?(0,K.jsxs)(`div`,{className:`as-sys`,"data-tone":`handoff`,role:`status`,children:[(0,K.jsx)(_,{"aria-hidden":`true`}),(0,K.jsxs)(`div`,{className:`as-sys-body`,children:[(0,K.jsx)(`span`,{className:`sr-only`,children:i(e,`assistant.prova.errorTitle`,f)}),(0,K.jsx)(`p`,{children:i(e,t.handoff.chatStatus===`closed`?`assistant.prova.handoffClosed`:`assistant.prova.handoff`,f)}),t.id===de?.id&&(0,K.jsxs)(`div`,{className:`flex flex-wrap gap-2`,children:[(0,K.jsxs)(S,{variant:`secondary`,size:`sm`,onClick:ge,children:[(0,K.jsx)(h,{className:`size-3.5`}),e(`assistant.prova.restart`)]}),t.handoff.conversationId&&(0,K.jsx)(S,{variant:`secondary`,size:`sm`,onClick:()=>a(`inbox/conversazioni`,{params:{thread:String(t.handoff.conversationId)}}),children:e(`assistant.prova.openInInbox`)})]})]})]}):t.error?(0,K.jsxs)(`div`,{className:`as-sys`,role:`alert`,children:[(0,K.jsx)(te,{"aria-hidden":`true`}),(0,K.jsxs)(`div`,{className:`as-sys-body`,children:[(0,K.jsx)(`span`,{className:`sr-only`,children:i(e,`assistant.prova.errorTitle`,f)}),(0,K.jsx)(`p`,{children:t.error}),t.errorFix===`reload`&&(0,K.jsxs)(S,{variant:`secondary`,size:`sm`,className:`self-start`,onClick:()=>window.location.reload(),children:[(0,K.jsx)(d,{className:`size-3.5`}),e(`assistant.prova.reload`)]}),t.errorFix===`widget`&&(0,K.jsx)(S,{variant:`secondary`,size:`sm`,className:`self-start`,onClick:()=>a(`widget/widget`),children:e(`assistant.prova.openWidget`)}),t.retryable&&t.id===de?.id&&(0,K.jsxs)(S,{variant:`secondary`,size:`sm`,className:`self-start`,disabled:R||(t.retryAt??0)>Date.now(),onClick:()=>he(t),children:[(0,K.jsx)(h,{className:`size-3.5`}),e(`assistant.prova.retry`)]})]})]}):t.pending?(0,K.jsx)(En,{name:c}):(0,K.jsxs)(`div`,{className:`as-ai`,"data-selectable":``,"data-selected":ce===t.id?``:void 0,onClick:e=>{e.target.closest(`a, button`)||A(t.id)},children:[(0,K.jsx)(`span`,{className:`as-ai-mark`,children:(0,K.jsx)(u,{"aria-hidden":`true`})}),(0,K.jsxs)(`div`,{className:`as-ai-body`,children:[t.reply?.output.trim()&&(0,K.jsx)(`div`,{className:`as-ai-text as-md`,children:(0,K.jsx)(se,{components:vn,children:t.reply.output})}),t.reply&&(0,K.jsx)(Dn,{reply:t.reply}),(0,K.jsx)(`button`,{type:`button`,className:`as-ai-pick`,"aria-pressed":ce===t.id,"aria-controls":`as-prova-trace-body`,"aria-label":s(e(`assistant.prova.selectAnswer`),{name:c}),onClick:()=>A(t.id),children:e(`assistant.prova.showTrace`)})]})]})]},t.id))})]}),(0,K.jsxs)(`section`,{className:`as-prova-col`,"aria-labelledby":`as-prova-trace`,children:[(0,K.jsx)(`div`,{className:`as-prova-col-head`,children:(0,K.jsx)(`b`,{id:`as-prova-trace`,children:e(`assistant.prova.traceTitle`)})}),(0,K.jsx)(`div`,{id:`as-prova-trace-body`,"aria-live":`polite`,children:(0,K.jsx)(Sn,{turn:ue,name:c,canWriteFaq:r,onUnlock:()=>a(`impostazioni/piano`),onFix:e=>a(`assistente/faq`,{intent:`add-faq`,params:{q:e}})})})]})]}),(0,K.jsxs)(`div`,{className:`as-composer-wrap`,children:[(0,K.jsxs)(`form`,{className:`as-composer`,onSubmit:e=>{e.preventDefault(),z(j)},children:[(0,K.jsx)(`textarea`,{ref:L,rows:1,value:j,onChange:e=>{M(e.target.value),e.target.style.height=`auto`,e.target.style.height=`${e.target.scrollHeight}px`},onKeyDown:e=>{e.key===`Enter`&&!e.shiftKey&&!e.nativeEvent.isComposing&&(e.preventDefault(),z(j))},onPaste:N.onPaste,placeholder:e(`assistant.prova.placeholder`),"aria-label":e(`assistant.prova.placeholder`),"aria-describedby":[R&&j.trim()?`as-prova-wait`:``,N.showCount||N.cut?`as-prova-limit`:``].filter(Boolean).join(` `)||void 0,maxLength:N.max}),(0,K.jsxs)(S,{type:`submit`,disabled:!j.trim()||R,children:[R&&(0,K.jsx)(b,{className:`size-4 animate-spin`}),e(`assistant.prova.send`)]})]}),(0,K.jsxs)(`div`,{id:`as-prova-limit`,className:`as-composer-limit`,"aria-live":`polite`,children:[N.cut&&(0,K.jsx)(`span`,{children:s(e(`assistant.prova.truncated`),{max:N.max})}),N.showCount&&(0,K.jsxs)(`small`,{className:`as-num`,"data-full":N.count>=N.max?``:void 0,children:[N.count,`/`,N.max]})]})]}),R&&j.trim()&&(0,K.jsx)(`p`,{id:`as-prova-wait`,className:`as-note`,role:`status`,children:s(e(`assistant.prova.waitForAnswer`),{name:c})}),(0,K.jsxs)(`div`,{className:`as-note`,children:[(0,K.jsx)(m,{"aria-hidden":`true`}),(0,K.jsx)(`p`,{children:e(`assistant.prova.disclosure`)})]})]})]})}function Sn({turn:e,name:t,canWriteFaq:n,onFix:r,onUnlock:o}){let{t:c,settings:l}=g(),u=re(l,``),d=(0,B.useMemo)(()=>{let t=[...e?.reply?.citations||[]].sort((e,t)=>Number(t.score??0)-Number(e.score??0)),n=new Set;return t.filter(e=>{let t=String(e.url||e.source_id||e.title||``);return n.has(t)?!1:(n.add(t),!0)})},[e]);if(!e)return(0,K.jsx)(`p`,{className:`text-[13px] text-ink-3`,children:s(c(`assistant.prova.traceEmpty`),{name:t})});if(e.pending)return(0,K.jsxs)(`div`,{className:`flex items-center gap-2 text-[13px] text-ink-3`,role:`status`,children:[(0,K.jsx)(b,{className:`size-4 animate-spin`,"aria-hidden":`true`}),(0,K.jsx)(`p`,{children:s(c(`assistant.prova.thinking`),{name:t})})]});if(e.handoff)return(0,K.jsx)(`p`,{className:`text-[13px] text-ink-3`,children:i(c,`assistant.prova.traceHandoff`,u)});if(e.error||!e.reply)return(0,K.jsx)(`p`,{className:`text-[13px] text-ink-3`,children:i(c,e.errorKind===`empty`?`assistant.prova.traceUnread`:e.errorKind===`unreadable`?`assistant.prova.traceUnreadable`:e.errorKind===`blocked`||e.errorKind===`challenge`?`assistant.prova.traceBlocked`:e.errorKind===`session`||e.errorKind===`visitor`?`assistant.prova.traceNoSession`:e.errorKind===`timeout`||e.errorKind===`chat`||e.errorKind===`network`?`assistant.prova.traceNoAnswer`:`assistant.prova.traceError`,u)});let p=e.reply,m=d.reduce((e,t)=>Math.max(e,Number(t.score??0)),0),h=p.usage?.total_tokens;return(0,K.jsxs)(`div`,{className:`as-trace`,children:[(0,K.jsxs)(`div`,{className:`as-trace-stats`,children:[(0,K.jsxs)(`div`,{className:`as-trace-stat`,children:[(0,K.jsxs)(`b`,{children:[C(p.ms/1e3),` s`]}),(0,K.jsx)(`small`,{children:c(`assistant.prova.statTime`)})]}),(0,K.jsxs)(`div`,{className:`as-trace-stat`,children:[(0,K.jsx)(`b`,{children:d.length}),(0,K.jsx)(`small`,{children:c(`assistant.prova.statSources`)})]}),(0,K.jsxs)(`div`,{className:`as-trace-stat`,children:[(0,K.jsx)(`b`,{children:typeof h==`number`?C(h):c(`assistant.prova.na`)}),(0,K.jsx)(`small`,{children:c(`assistant.prova.statTokens`)})]})]}),(0,K.jsxs)(`div`,{className:`as-trace-block`,children:[(0,K.jsx)(`h3`,{className:`ark-lbl`,children:c(`assistant.prova.usedSources`)}),d.length===0?(0,K.jsx)(`p`,{className:`text-[12.5px] text-ink-3`,children:c(`assistant.prova.noSources`)}):d.map((e,t)=>{let n=e.title||(e.url?T(e.url):e.source_id)||c(`assistant.prova.untitled`),r=Cn(c,e),i=m>0?Number(e.score??0)/m*100:0,a=(0,K.jsxs)(K.Fragment,{children:[(0,K.jsxs)(`span`,{children:[(0,K.jsx)(`b`,{children:n}),r&&(0,K.jsx)(`small`,{children:r})]}),(0,K.jsx)(O,{value:i,tone:`accent`,label:s(c(`assistant.prova.relevance`),{score:Number(e.score??0).toFixed(2)})})]});return e.url&&/^https?:/i.test(e.url)?(0,K.jsx)(`a`,{className:`as-trace-src`,href:e.url,target:`_blank`,rel:`noreferrer`,children:a},`${e.url}-${t}`):(0,K.jsx)(`div`,{className:`as-trace-src`,children:a},`${e.source_id}-${t}`)})]}),(p.tool||p.components.length>0)&&(0,K.jsxs)(`div`,{className:`as-trace-block`,children:[(0,K.jsx)(`h3`,{className:`ark-lbl`,children:c(`assistant.prova.actions`)}),p.tool&&(0,K.jsxs)(`div`,{className:`as-trace-tool`,children:[(0,K.jsx)(f,{"aria-hidden":`true`}),(0,K.jsxs)(`span`,{children:[(0,K.jsx)(`b`,{children:On(c,p.tool)}),p.toolRounds!=null&&p.toolRounds>1&&(0,K.jsx)(`small`,{children:s(c(`assistant.prova.toolRounds`),{n:p.toolRounds})})]})]}),p.components.length>0&&(0,K.jsxs)(`div`,{className:`as-trace-tool`,children:[(0,K.jsx)(a,{"aria-hidden":`true`}),(0,K.jsxs)(`span`,{children:[(0,K.jsx)(`b`,{children:c(`assistant.prova.componentsTitle`)}),(0,K.jsx)(`small`,{children:jn(c,p.components)})]})]})]}),p.model&&(0,K.jsx)(`p`,{className:`text-[11.5px] text-ink-3`,children:s(c(`assistant.prova.model`),{model:p.model})}),(0,K.jsxs)(`div`,{className:`flex flex-col gap-2`,children:[(0,K.jsx)(`p`,{className:`text-[12.5px] text-ink-2`,children:c(n?`assistant.prova.fixHint`:`assistant.prova.fixLocked`)}),n?(0,K.jsxs)(S,{variant:`secondary`,size:`sm`,className:`self-start`,onClick:()=>r(e.question),children:[(0,K.jsx)(v,{className:`size-3.5`}),c(`assistant.prova.fix`)]}):(0,K.jsx)(S,{variant:`secondary`,size:`sm`,className:`self-start`,onClick:o,children:c(`assistant.gaps.unlock`)})]})]})}function Cn(e,t){return!t.url&&!t.source_id?``:t.url&&/^https?:/i.test(t.url)?`${E(t.url)}${T(t.url)}`:e(w({source_url:t.url??``,source_id:t.source_id??``})===`file`?`assistant.contenuti.typeFile`:`assistant.contenuti.typeText`)}var wn=1e4;function Tn(e,t,n=`errorRate`){let r=`assistant.prova.${n}`;if(!t)return e(`${r}Soon`);let i=Math.max(1,Math.ceil(t/1e3));if(i===1)return e(`${r}One`);if(i<90)return s(e(r),{n:i});let a=Math.ceil(i/60);return a<90?s(e(`${r}Minutes`),{n:a}):s(e(`${r}Hours`),{n:Math.ceil(a/60)})}function En({name:e}){let{t}=g(),[n,r]=(0,B.useState)(!1);return(0,B.useEffect)(()=>{let e=window.setTimeout(()=>r(!0),yn);return()=>window.clearTimeout(e)},[]),(0,K.jsxs)(`div`,{className:`as-ai`,role:`status`,children:[(0,K.jsx)(`span`,{className:`as-ai-mark`,children:(0,K.jsx)(u,{"aria-hidden":`true`})}),(0,K.jsxs)(`div`,{className:`as-ai-body`,children:[(0,K.jsxs)(`span`,{className:`as-typing`,"aria-label":s(t(`assistant.prova.thinking`),{name:e}),children:[(0,K.jsx)(`i`,{}),(0,K.jsx)(`i`,{}),(0,K.jsx)(`i`,{})]}),n&&(0,K.jsx)(`span`,{className:`as-note`,children:t(`assistant.prova.slowHint`)})]})]})}function Dn({reply:e}){let{t}=g(),n=(0,B.useMemo)(()=>mn(e.componentData),[e]);return n?(0,K.jsx)(K.Fragment,{children:n.drawable?(0,K.jsx)(hn,{component:n.component}):(0,K.jsxs)(`span`,{className:`as-note`,children:[(0,K.jsx)(a,{"aria-hidden":`true`}),s(t(`assistant.prova.componentsShown`),{list:jn(t,[String(n.component.type??``)])})]})}):null}function On(e,t){let n=`assistant.tools.${t}.label`,r=e(n);return r&&r!==n?r:t}function kn(e){return e.status===403&&/\bWordPress roles\b/i.test(e.message)}var An={data_table:`table`,table:`table`,chart:`chart`,bar_chart:`chart`,line_chart:`chart`,area_chart:`chart`,geo_map:`map`,map:`map`,locations:`map`,clarify:`choices`,option_list:`choices`,select:`choices`,question_flow:`questionFlow`,appointment_slots:`appointment`,appointment:`appointment`,event_list:`events`,message_draft:`draft`,draft:`draft`,order_summary:`order`,cart:`order`,stats:`stats`,stats_display:`stats`,product_list:`products`,product_carousel:`products`,product_suggestions:`products`,products:`products`,tool_status:`status`,consent_required:`consent`,contact_form:`contactForm`,faq_list:`faq`};function jn(e,t){let n=t.map(t=>{let n=t.trim().replace(/([a-z0-9])([A-Z])/g,`$1_$2`).replace(/-/g,`_`).toLowerCase();return e(`assistant.prova.componentTypes.${Object.prototype.hasOwnProperty.call(An,n)?An[n]:`other`}`)});return[...new Set(n)].join(`, `)}export{xn as ProvaPage,Cn as citationDetail,jn as componentList,Tn as rateText};