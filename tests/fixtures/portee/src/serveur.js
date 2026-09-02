import express from 'express';
import { db } from './db.js';

const app = express();

// 1. VRAIE injection : la valeur vient de la requete et finit dans le SQL.
app.get('/utilisateur', (requete, reponse) => {
  const identifiant = requete.query.id;
  db.query('SELECT * FROM users WHERE id = ' + identifiant);
});

// 2. FAUX POSITIF attendu du lexical : `identifiant` est ici une constante
//    litterale, jamais influencee par l'exterieur.
app.get('/admin', (requete, reponse) => {
  const identifiant = 'admin';
  db.query('SELECT * FROM users WHERE role = ' + identifiant);
});

// 3. MASQUAGE : le parametre masque la constante sure du module.
const table = 'users';
function lister(table) {
  db.query('SELECT * FROM ' + table);
}

// 4. REAFFECTATION : sure a la declaration, empoisonnee ensuite.
app.get('/recherche', (requete, reponse) => {
  let critere = 'defaut';
  critere = requete.body.critere;
  db.query('SELECT * FROM users WHERE nom = ' + critere);
});

// 5. DESTRUCTURATION : la source est la requete, via decomposition.
app.get('/profil/:slug', (requete, reponse) => {
  const { slug } = requete.params;
  db.query('SELECT * FROM profils WHERE slug = ' + slug);
});

// 6. Variable locale reellement inutilisee.
function calculer(valeurs) {
  const total = valeurs.length;
  const inutilise = valeurs.map((v) => v * 2);
  return total;
}

// 7. FAUX POSITIF attendu : utilisee uniquement dans un gabarit.
function saluer(prenom) {
  const message = `Bonjour ${prenom}`;
  return message;
}

// 8. FAUX POSITIF attendu : utilisee seulement en decomposition d'objet.
function emballer(donnees) {
  const horodatage = Date.now();
  return { donnees, horodatage };
}

export { lister, calculer, saluer, emballer, app };
