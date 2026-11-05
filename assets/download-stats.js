(function(){
var period=document.getElementById("period"),status=document.getElementById("status"),report=document.getElementById("report"),tables=document.getElementById("tables"),serial=0;
var BKK={timeZone:"Asia/Bangkok"};
function when(ts){var d=new Date(ts);return d.toLocaleDateString("en-GB",Object.assign({day:"numeric",month:"short"},BKK))+" "+d.toLocaleTimeString("en-GB",Object.assign({hour:"2-digit",minute:"2-digit"},BKK))}
// GitHub keeps one running total per platform; the change between two days is that day's downloads
function ghDaily(rows){var by={},out=[];rows.forEach(function(r){(by[r.platform]=by[r.platform]||[]).push(r)});
 Object.keys(by).forEach(function(p){var list=by[p];for(var i=0;i<list.length-1;i++)out.push({day:list[i].day,platform:p,count:list[i].total-list[i+1].total})});
 return out.sort(function(a,b){return a.day<b.day?1:a.day>b.day?-1:a.platform<b.platform?-1:1})}
function table(title,rows,fields){
 var box=document.createElement("section");box.className="stat-box";
 var heading=document.createElement("h2");heading.textContent=title;box.appendChild(heading);
 if(!rows.length){var empty=document.createElement("p");empty.textContent="No recorded requests yet.";box.appendChild(empty);return box}
 var scroll=document.createElement("div");scroll.className="table-scroll";var t=document.createElement("table");
 var head=document.createElement("tr");fields.concat(["count"]).forEach(function(f){var cell=document.createElement("th");cell.textContent=f.replace(/_/g," ");cell.scope="col";head.appendChild(cell)});var thead=document.createElement("thead");thead.appendChild(head);t.appendChild(thead);
 var body=document.createElement("tbody");rows.forEach(function(row){var tr=document.createElement("tr");if(row._repeat)tr.className="repeat";fields.concat(["count"]).forEach(function(f){var cell=document.createElement("td");cell.textContent=row[f]==null?"—":row[f];tr.appendChild(cell)});body.appendChild(tr)});t.appendChild(body);scroll.appendChild(t);box.appendChild(scroll);return box;
}
async function load(){var current=++serial;status.textContent="Loading statistics…";
 try{var r=await fetch("/api/download-stats?days="+period.value,{cache:"no-store"});if(r.status===401){location.reload();return}if(!r.ok)throw Error();var data=await r.json();if(current!==serial)return;
 document.getElementById("total").textContent=data.total.toLocaleString();tables.replaceChildren();
 var gh=data.github||{},ghTotal=0;Object.keys(gh).forEach(function(k){if(gh[k])ghTotal+=gh[k].total});
 document.getElementById("visitors").textContent=(data.visitors||0).toLocaleString();document.getElementById("ghtotal").textContent=ghTotal.toLocaleString();
 tables.appendChild(table("Recent downloads (site links)",(data.recent||[]).map(function(r){return{time:when(r.ts),platform:r.platform,version:r.version,country:r.country,source:r.source,button:r.placement,visitor:r.visitor,count:r.times>1?"×"+r.times+" (same visitor)":"1",_repeat:r.times>1}}),["time","platform","version","country","source","button","visitor"])).classList.add("wide");
 tables.appendChild(table("Daily (site links)",(data.daily||[]).map(function(r){return{day:r.day,visitors:r.visitors||null,count:r.count}}),["day","visitors"]));
 tables.appendChild(table("GitHub totals (all downloads)",Object.keys(gh).filter(function(k){return gh[k]}).map(function(k){return{platform:k,count:gh[k].total}}),["platform"]));
 tables.appendChild(table("GitHub per day",ghDaily(data.github_daily||[]),["day","platform"]));
 tables.appendChild(table("GitHub per release",[].concat.apply([],Object.keys(gh).filter(function(k){return gh[k]}).map(function(k){return gh[k].releases.slice(0,8).map(function(r){return{platform:k,release:r.tag,published:r.published,count:r.count}})})),["platform","release","published"]));
 [["Platforms","platforms",["platform"]],["Versions","versions",["platform","version"]],["Sources","sources",["source"]],["Countries","countries",["country"]],["Campaigns","campaigns",["source","medium","campaign"]],["Buttons","placements",["placement"]]].forEach(function(s){tables.appendChild(table(s[0],data[s[1]],s[2]))});
 status.textContent="Tracking enabled: "+new Date(data.started_at).toLocaleString("en-GB",{timeZone:"Asia/Bangkok"})+" (Bangkok). Updated: "+new Date(data.generated_at).toLocaleString("en-GB",{timeZone:"Asia/Bangkok"});report.hidden=false;
 }catch(e){if(current===serial){status.textContent="Statistics are temporarily unavailable. Downloads are still available from the home page.";report.hidden=true}}
}period.addEventListener("change",load);document.addEventListener("visibilitychange",function(){if(!document.hidden)load()});setInterval(function(){if(!document.hidden)load()},15000);load();
})();
