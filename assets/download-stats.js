(function(){
var period=document.getElementById("period"),status=document.getElementById("status"),report=document.getElementById("report"),tables=document.getElementById("tables"),serial=0;
function table(title,rows,fields){
 var box=document.createElement("section");box.className="stat-box";
 var heading=document.createElement("h2");heading.textContent=title;box.appendChild(heading);
 if(!rows.length){var empty=document.createElement("p");empty.textContent="No recorded requests yet.";box.appendChild(empty);return box}
 var scroll=document.createElement("div");scroll.className="table-scroll";var t=document.createElement("table");
 var head=document.createElement("tr");fields.concat(["count"]).forEach(function(f){var cell=document.createElement("th");cell.textContent=f.replace(/_/g," ");cell.scope="col";head.appendChild(cell)});var thead=document.createElement("thead");thead.appendChild(head);t.appendChild(thead);
 var body=document.createElement("tbody");rows.forEach(function(row){var tr=document.createElement("tr");fields.concat(["count"]).forEach(function(f){var cell=document.createElement("td");cell.textContent=row[f];tr.appendChild(cell)});body.appendChild(tr)});t.appendChild(body);scroll.appendChild(t);box.appendChild(scroll);return box;
}
async function load(){var current=++serial;status.textContent="Loading statistics…";
 try{var r=await fetch("/api/download-stats?days="+period.value,{cache:"no-store"});if(r.status===401){location.reload();return}if(!r.ok)throw Error();var data=await r.json();if(current!==serial)return;
 document.getElementById("total").textContent=data.total.toLocaleString();tables.replaceChildren();
 [["Platforms","platforms",["platform"]],["Versions","versions",["platform","version"]],["Sources","sources",["source"]],["Countries","countries",["country"]],["Campaigns","campaigns",["source","medium","campaign"]],["Buttons","placements",["placement"]],["Daily","daily",["day"]]].forEach(function(s){tables.appendChild(table(s[0],data[s[1]],s[2]))});
 status.textContent="Tracking enabled: "+new Date(data.started_at).toLocaleString("en-GB",{timeZone:"Asia/Bangkok"})+" (Bangkok). Updated: "+new Date(data.generated_at).toLocaleString("en-GB",{timeZone:"Asia/Bangkok"});report.hidden=false;
 }catch(e){if(current===serial){status.textContent="Statistics are temporarily unavailable. Downloads are still available from the home page.";report.hidden=true}}
}period.addEventListener("change",load);document.addEventListener("visibilitychange",function(){if(!document.hidden)load()});setInterval(function(){if(!document.hidden)load()},15000);load();
})();
