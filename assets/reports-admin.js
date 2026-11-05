(async function () {
  var status = document.getElementById('status'), container = document.getElementById('reports');
  try {
    var response = await fetch('/api/reports', {cache: 'no-store'});
    if (!response.ok) throw new Error();
    var data = await response.json(); status.textContent = data.reports.length ? 'Latest reports' : 'No reports yet.';
    data.reports.forEach(function (report) {
      var item = document.createElement('article'), time = document.createElement('time'), message = document.createElement('p');
      time.textContent = new Date(report.created_at).toLocaleString(); message.textContent = report.message;
      item.append(time, message); container.append(item);
    });
  } catch (e) { status.textContent = 'Could not load reports. Please refresh the page.'; }
}());
