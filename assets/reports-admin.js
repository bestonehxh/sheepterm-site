(async function(){
  var status=document.getElementById('status'),container=document.getElementById('reports'),labels={open:'Open','under-review':'Under review',planned:'Planned','in-progress':'Under development',completed:'Completed',closed:'Closed'};
  function el(tag, text){var node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node}
  try{
    var response=await fetch('/api/reports',{cache:'no-store'});if(!response.ok)throw Error();var data=await response.json();status.textContent=data.reports.length?'Choose a report to update. Replies are public for public posts.':'No feedback yet.';
    data.reports.forEach(function(report){
      var item=el('article'), header=el('time',(report.type==='feature'?'Feature request · ':'Problem report · ')+new Date(report.created_at).toLocaleString()), form=el('form'), messageLabel=el('label','Post'),message=el('textarea'),replyLabel=el('label','Public reply from SheepTerm'),reply=el('textarea'), selectLabel=el('label','Status'),select=el('select'), save=el('button','Save changes'),note=el('p');
      message.value=report.message;message.required=true;message.maxLength=3000;message.rows=3;messageLabel.append(message);
      reply.value=report.reply||'';reply.maxLength=3000;reply.rows=3;replyLabel.append(reply);
      Object.entries(labels).forEach(function(pair){var option=el('option',pair[1]);option.value=pair[0];select.append(option)});select.value=report.status;selectLabel.append(select);
      save.type='submit';note.setAttribute('role','status');
      form.addEventListener('submit',async function(event){event.preventDefault();save.disabled=true;note.textContent='Saving…';try{var edit=await fetch('/api/feedback-edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:report.id,message:message.value,reply:reply.value})});if(!edit.ok)throw Error();var result=await fetch('/api/feedback-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:report.id,status:select.value})});if(!result.ok)throw Error('The text was saved, but the status was not.');note.textContent='Saved.'}catch(error){note.textContent=error.message||'Could not save. Please try again.'}finally{save.disabled=false}});
      form.append(messageLabel,replyLabel,selectLabel,save,note);item.append(header,form);container.append(item);
    });
  }catch(e){status.textContent='Could not load feedback. Please refresh the page.'}
}());
