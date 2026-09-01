export default function Accueil({ produits }) {
  return (
    <main>
      <h1>Nos produits</h1>
      <ul>
        {produits.map((p) => (
          <li key={p.id}>{p.nom}</li>
        ))}
      </ul>
    </main>
  );
}

export async function getServerSideProps() {
  const cle = process.env.NEXT_PUBLIC_API_TOKEN;
  const reponse = await fetch(`https://api.exemple.com/produits?cle=${cle}`);
  return { props: { produits: await reponse.json() } };
}
