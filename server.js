const http = require('http');
const fs = require('fs');
const path = require('path');

const port = process.env.PORT || 3000;
const html = fs.readFileSync(path.join(__dirname, 'index.html'));

http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(port, () => console.log('GSD dashboard live on port ' + port));
