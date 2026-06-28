const http = require('http');
const fs = require('fs');
const path = require('path');

const port = process.env.PORT || 3000;
const html = fs.readFileSync(path.join(__dirname, 'index.html'));

const TYPES = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  // serve downloadable lists / docs (.xlsx, .docx)
  const ext = path.extname(url).toLowerCase();
  if (TYPES[ext]) {
    const file = path.join(__dirname, path.basename(url));
    if (fs.existsSync(file)) {
      res.writeHead(200, {
        'Content-Type': TYPES[ext],
        'Content-Disposition': 'attachment; filename="' + path.basename(url) + '"'
      });
      res.end(fs.readFileSync(file));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(port, () => console.log('GSD dashboard live on port ' + port));
