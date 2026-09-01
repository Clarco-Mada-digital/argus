export default async function handler(req, res) {
  const { montant, client } = req.body;
  const resultat = await enregistrer(montant, client);
  res.status(200).json(resultat);
}

async function enregistrer(montant, client) {
  return { montant, client };
}
