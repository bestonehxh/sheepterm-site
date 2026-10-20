(function(){
var API="https://api.github.com/repos/bestonehxh/",GH="https://github.com/bestonehxh/";
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
   var a=(j.assets||[]).filter(function(x){return/\.zip$/i.test(x.name)})[0];if(!a)throw 0;
   var o={v:human(j.tag_name),url:a.browser_download_url,size:a.size};
   res(o)}).catch(rej)})}
var NM={mac:"macOS",win:"Windows"};
// per-OS highlight inside each .dl group
document.querySelectorAll(".dl").forEach(function(g){
 var b=g.querySelectorAll("a.btn[data-os]");if(!b.length)return;
 var hit=null;b.forEach(function(x){if(x.dataset.os===ME)hit=x});
 if(!hit){b.forEach(function(x){if(x.dataset.os==="mac")hit=x})}
 if(hit)hit.classList.add("mine");
});
// buttons with a repo
document.querySelectorAll("a[data-repo]").forEach(function(a){
 release(a.dataset.repo).then(function(r){
  a.href=r.url;
  var lbl=a.dataset.label||NM[a.dataset.os]||"";
  a.setAttribute("aria-label","Download "+(a.dataset.app||"")+" "+r.v+" for "+lbl+", "+mb(r.size));
  document.querySelectorAll('[data-meta="'+a.dataset.repo+'"]').forEach(function(m){m.innerHTML=(m.dataset.pre||"")+"<b>"+r.v+"</b> · "+mb(r.size)+(m.dataset.sep?" · ":"")});
 }).catch(function(){});
});
// quick download: OS-aware single button
document.querySelectorAll("a[data-quick]").forEach(function(a){
 var os=(ME==="win"&&a.dataset.win)?"win":"mac",repo=os==="win"?a.dataset.win:a.dataset.mac;
 var t=a.querySelector(".t");if(t)t.textContent=(a.dataset.prefix||"Download")+" for "+NM[os];
 a.href=GH+repo+"/releases/latest";
 release(repo).then(function(r){a.href=r.url;
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
})();
