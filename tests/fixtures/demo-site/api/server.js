const express = require('express');
const app = express();

app.use(cors());
app.get('/api/users', (req, res) => { res.json([]); });
app.get('/api/users', (req, res) => { res.json([]); });
app.post('/api/login', (req, res) => {
  const cmd = exec("grep " + req.body.user + " /etc/passwd");
  res.sendFile(req.query.path);
});
app.get('/api/Admin', (req, res) => res.json({}));
app.listen(3000, '0.0.0.0');
