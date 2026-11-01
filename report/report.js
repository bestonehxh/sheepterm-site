(function () {
  var form = document.getElementById('report-form'), status = document.getElementById('report-status'), button = form.querySelector('button');
  var list = document.getElementById('reports-list'), listStatus = document.getElementById('reports-status');
  async function loadReports() {
    try {
      var response = await fetch('/api/public-reports', {cache: 'no-store'});
      if (!response.ok) throw new Error();
      var data = await response.json(); list.replaceChildren();
      listStatus.textContent = data.reports.length ? 'Most recent reports' : 'No public reports yet.';
      data.reports.forEach(function (report) {
        var item = document.createElement('article'), time = document.createElement('time'), message = document.createElement('p');
        time.textContent = new Date(report.created_at).toLocaleString(); message.textContent = report.message;
        item.append(time, message); list.append(item);
      });
    } catch (error) { listStatus.textContent = 'Could not load reports. Please refresh the page.'; }
  }
  form.addEventListener('submit', async function (event) {
    event.preventDefault(); button.disabled = true; status.textContent = 'Sending…';
    try {
      var response = await fetch('/api/reports', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({message: form.elements.message.value})});
      var result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Please try again.');
      form.reset(); status.textContent = 'Thank you! Your report has been posted.'; await loadReports();
    } catch (error) { status.textContent = 'Could not send your report. ' + (error.message || 'Please try again.'); }
    finally { button.disabled = false; }
  });
  loadReports();
}());
