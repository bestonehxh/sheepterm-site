(function () {
  var form = document.getElementById('report-form');
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var data = new FormData(form);
    var platform = data.get('platform');
    var allowed = ['SheepTerm', 'SheepTerm-Windows', 'SheepTerm-Linux'];
    if (allowed.indexOf(platform) < 0) return;
    var body = '## Environment\n- SheepTerm version: ' + data.get('version') + '\n- Operating system: ' + (data.get('os') || 'Not provided') + '\n\n## Steps to reproduce\n' + data.get('steps') + '\n\n## Expected behavior\n' + (data.get('expected') || 'Not provided') + '\n\n## Actual behavior\n' + data.get('actual') + '\n\n## Additional context\n' + (data.get('extra') || 'None');
    var query = new URLSearchParams({title: data.get('title'), body: body});
    window.location.href = 'https://github.com/bestonehxh/' + platform + '/issues/new?' + query.toString();
  });
}());
