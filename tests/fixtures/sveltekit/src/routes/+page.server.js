import { db } from '$lib/db.js';

export async function load({ url }) {
  const recherche = url.searchParams.get('q');
  const articles = await db.query(`SELECT * FROM articles WHERE titre LIKE '%${recherche}%'`);
  return { articles, cleAdmin: process.env.ADMIN_SECRET };
}
