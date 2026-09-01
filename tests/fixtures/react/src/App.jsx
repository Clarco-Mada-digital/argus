import { useState } from 'react';

export default function App({ articles, utilisateur }) {
  const [filtre, setFiltre] = useState('');

  async function connecter(reponse) {
    localStorage.setItem('auth_token', reponse.jeton);
  }

  return (
    <main>
      <h1>Articles</h1>
      <label htmlFor="f">Filtrer</label>
      <input id="f" value={filtre} onChange={(e) => setFiltre(e.target.value)} />
      <ul>
        {articles.map((article) => (
          <li>
            <a href={article.lienExterne}>{article.titre}</a>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => connecter(utilisateur)}>Connexion</button>
    </main>
  );
}
