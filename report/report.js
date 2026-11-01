(function () {
  var form = document.getElementById('report-form'), status = document.getElementById('report-status'), button = form.querySelector('button');
  form.addEventListener('submit', async function (event) {
    event.preventDefault(); button.disabled = true; status.textContent = 'Sending…';
    try {
      var response = await fetch('/api/reports', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({message: form.elements.message.value})});
      var result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Please try again.');
      form.reset(); status.textContent = 'Thank you! Your report has been sent.';
    } catch (error) { status.textContent = 'Could not send your report. ' + (error.message || 'Please try again.'); }
    finally { button.disabled = false; }
  });
}());
