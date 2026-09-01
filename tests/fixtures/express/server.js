const express = require('express');
const session = require('express-session');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'garder-ce-secret-bien-au-chaud-2024',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 3600000 },
}));

app.use('/public', express.static('public', { dotfiles: 'allow' }));

app.get('/api/profil/:id', (req, res) => {
  res.json({ id: req.params.id });
});

app.post('/api/connexion', (req, res) => {
  res.json({ ok: true });
});

// Gestionnaire d'erreurs : renvoie la trace au client
app.use((err, req, res, next) => {
  res.status(500).json({ erreur: err.message, trace: err.stack });
});

app.listen(3000);
