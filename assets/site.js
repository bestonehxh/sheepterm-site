(function(){
var API="https://api.github.com/repos/bestonehxh/",GH="https://github.com/bestonehxh/";
// Tab-scoped campaign attribution, without cookies or visitor identifiers.
var attribution={},incoming=new URLSearchParams(location.search);
try{attribution=JSON.parse(sessionStorage.getItem("sheepterm-attribution")||"{}");if(!attribution||typeof attribution!=="object")attribution={}}catch(e){}
try{
 if(incoming.has("utm_source"))attribution={};
 ["utm_source","utm_medium","utm_campaign"].forEach(function(k){var v=incoming.get(k);if(v&&/^[a-z0-9_.-]{1,64}$/i.test(v))attribution[k]=v});
 if(document.referrer){var ref=new URL(document.referrer);if(ref.hostname!==location.hostname)attribution.ref=ref.origin}
 sessionStorage.setItem("sheepterm-attribution",JSON.stringify(attribution));
}catch(e){}
function trackedLink(a,repo,tag){
 var platform=repo==="SheepTerm"?"mac":repo==="SheepTerm-Windows"?"windows":repo==="SheepTerm-Linux"?(/aarch64/.test(a.dataset.asset||"")?"linux-arm64":"linux"):"";
 if(!platform)return null;
 var u=new URL("/download/"+platform,location.origin);
 Object.keys(attribution).forEach(function(k){if(["utm_source","utm_medium","utm_campaign","ref"].indexOf(k)>=0)u.searchParams.set(k,attribution[k])});
 u.searchParams.set("placement",a.closest(".hero")?"hero":a.closest(".cta2")?"bottom":a.closest(".acard")?"app-card":"content");
 if(tag)u.searchParams.set("version",tag);
 return u.href;
}
document.querySelectorAll('a[href^="/download/"]').forEach(function(a){
 var u=new URL(a.href);Object.keys(attribution).forEach(function(k){if(["utm_source","utm_medium","utm_campaign","ref"].indexOf(k)>=0)u.searchParams.set(k,attribution[k])});a.href=u.href;
});
function detect(){var p="";try{p=(navigator.userAgentData&&navigator.userAgentData.platform)||""}catch(e){}
 var s=(p+" "+navigator.userAgent).toLowerCase();
 if(/android|iphone|ipad|ipod/.test(s))return"";
 if(/win/.test(s))return"win";if(/mac/.test(s))return"mac";if(/linux|x11|cros/.test(s))return"linux";return""}
var ME=detect();document.documentElement.setAttribute("data-os",ME);
function human(t){var m=/^v?(\d+(?:\.\d+)*)-(\d+)$/.exec(t||"");return m?m[1]+" ("+m[2]+")":(t||"").replace(/^v/,"")}
function mb(n){return(n/1048576).toFixed(n<10485760?1:0)+" MB"}
var cache={};
function release(repo){
 if(cache[repo])return cache[repo];
 return cache[repo]=new Promise(function(res,rej){
  fetch(API+repo+"/releases/latest",{headers:{Accept:"application/vnd.github+json"}}).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(j){
   if(!(j.assets||[]).length)throw 0;
   res({v:human(j.tag_name),tag:j.tag_name,assets:j.assets})}).catch(rej)})}
// the asset a button means: its data-asset pattern (Linux: one tar.gz per architecture), else the release's
// disk image (Mac, drag-to-install: a zip unpacked twice became "App 2.app" beside the old copy), else its zip
function pick(r,pat){var a=null;(pat?[pat]:["\\.dmg$","\\.zip$"]).some(function(p){var re=new RegExp(p,"i");
 a=r.assets.filter(function(x){return re.test(x.name)})[0];return!!a});
 if(!a)throw 0;return{v:r.v,url:a.browser_download_url,size:a.size}}
var NM={mac:"macOS",win:"Windows",linux:"Linux"};
// per-OS highlight inside each .dl group
document.querySelectorAll(".dl").forEach(function(g){
 var b=g.querySelectorAll("a.btn[data-os]");if(!b.length)return;
 var hit=null;b.forEach(function(x){if(x.dataset.os===ME)hit=x});
 if(!hit){b.forEach(function(x){if(x.dataset.os==="mac")hit=x})}
 if(hit)hit.classList.add("mine");
});
// buttons with a repo
document.querySelectorAll("a[data-repo]").forEach(function(a){
 var tracked=trackedLink(a,a.dataset.repo);if(tracked)a.href=tracked;
 release(a.dataset.repo).then(function(rel){
  var r=pick(rel,a.dataset.asset);
  a.href=trackedLink(a,a.dataset.repo,rel.tag)||r.url;
  var bv=a.querySelector(".bver");if(bv)bv.textContent=r.v+" · "+mb(r.size); // the version sits on its own button
  var lbl=a.dataset.label||NM[a.dataset.os]||"";
  a.setAttribute("aria-label","Download "+(a.dataset.app||"")+" "+r.v+" for "+lbl+", "+mb(r.size));
  if(!a.dataset.nometa)document.querySelectorAll('[data-meta="'+a.dataset.repo+'"]').forEach(function(m){m.innerHTML=(m.dataset.pre||"")+"<b>"+r.v+"</b> · "+mb(r.size)+(m.dataset.sep?" · ":"")});
 }).catch(function(){});
});
// quick download: OS-aware single button
document.querySelectorAll("a[data-quick]").forEach(function(a){
 var os=(ME==="win"&&a.dataset.win)?"win":(ME==="linux"&&a.dataset.linux)?"linux":"mac";
 var repo=os==="win"?a.dataset.win:os==="linux"?a.dataset.linux:a.dataset.mac;
 var t=a.querySelector(".t");if(t)t.textContent=(a.dataset.prefix||"Download")+" for "+NM[os];
 a.href=trackedLink(a,repo)||GH+repo+"/releases/latest";
 release(repo).then(function(rel){var r=pick(rel,os==="linux"?"linux-x86_64\\.tar\\.gz$":"");a.href=trackedLink(a,repo,rel.tag)||r.url;
  if(a.closest(".acard"))return;
  document.querySelectorAll("[data-quick-meta]").forEach(function(m){m.innerHTML="<b>"+r.v+"</b> · "+mb(r.size)+" · "+NM[os]})}).catch(function(){});
});

// version text: always the latest release (the static text is only the fallback)
document.querySelectorAll("[data-ver]").forEach(function(e){release(e.dataset.ver).then(function(r){e.textContent=r.v}).catch(function(){})});
// phone nav menu
(function(){var n=document.querySelector(".nav"),b=n&&n.querySelector(".menu");if(!b)return;
 b.addEventListener("click",function(){var o=n.classList.toggle("open");b.setAttribute("aria-expanded",o?"true":"false")})})();
// OS switch on screenshots: default = visitor's OS, all switches stay in step
(function(){var all=[].slice.call(document.querySelectorAll(".osvis[data-both='1']"));
 var want=ME==="win"?"win":"mac";
 function set(v,os){v.setAttribute("data-sel",os);[].forEach.call(v.querySelectorAll(".seg button"),function(b){b.setAttribute("aria-pressed",b.dataset.os===os?"true":"false")})}
 all.forEach(function(v){set(v,want);[].forEach.call(v.querySelectorAll(".seg button"),function(b){b.addEventListener("click",function(){all.forEach(function(x){set(x,b.dataset.os)})})})});
})();
// Features page: one panel at a time, #hash = the panel, the list marks it
(function(){var nav=document.querySelector(".fx-nav");if(!nav)return;
 var links=[].slice.call(nav.querySelectorAll("a")),panels=[].slice.call(document.querySelectorAll(".fx-panel"));
 function show(id,focus){var p=document.getElementById(id);if(!p||panels.indexOf(p)<0)p=panels[0];
  panels.forEach(function(x){x.hidden=x!==p});
  links.forEach(function(a){if(a.getAttribute("href")==="#"+p.id){a.setAttribute("aria-current","true");a.scrollIntoView({block:"nearest",inline:"center"})}else a.removeAttribute("aria-current")});
  if(focus){var bar=document.querySelector(".nav"),top=nav.parentNode.getBoundingClientRect().top+window.scrollY-(bar?bar.offsetHeight:60)-20;if(window.scrollY>top)window.scrollTo({top:top,behavior:"auto"});p.focus({preventScroll:true})}}
 links.forEach(function(a){a.addEventListener("click",function(e){if(e.metaKey||e.ctrlKey||e.shiftKey)return;e.preventDefault();var id=a.getAttribute("href").slice(1);
  history.pushState(null,"","#"+id);show(id,true)})});
 function fromHash(){show(decodeURIComponent(location.hash.slice(1)),false)}
 window.addEventListener("hashchange",fromHash);window.addEventListener("popstate",fromHash);fromHash();
})();
})();
