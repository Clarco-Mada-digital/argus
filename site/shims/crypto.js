/**
 * SHA-1 en JavaScript pur, pour `createHash` cote navigateur.
 *
 * L'API Web Crypto est asynchrone, alors qu'Argus calcule ses empreintes de
 * maniere synchrone. Plutot que de rendre asynchrone toute la chaine d'analyse
 * pour une empreinte, on implemente l'algorithme — il est court et fige.
 *
 * Le resultat est identique a celui de Node : une baseline reste donc
 * interchangeable entre la ligne de commande et le navigateur.
 */
// argus-disable-next-line — SHA-1 sert ici d'empreinte, jamais de protection : il
// doit reproduire exactement le resultat de Node pour que les baselines restent
// interchangeables. Un algorithme plus recent donnerait des empreintes differentes.
function sha1(octets) {
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const longueur = octets.length;
  const totalBits = longueur * 8;

  const rembourre = new Uint8Array((((longueur + 8) >> 6) + 1) << 6);
  rembourre.set(octets);
  rembourre[longueur] = 0x80;
  new DataView(rembourre.buffer).setUint32(rembourre.length - 4, totalBits >>> 0, false);
  new DataView(rembourre.buffer).setUint32(rembourre.length - 8, Math.floor(totalBits / 2 ** 32), false);

  const mot = new Int32Array(80);
  const vue = new DataView(rembourre.buffer);

  for (let bloc = 0; bloc < rembourre.length; bloc += 64) {
    for (let i = 0; i < 16; i++) mot[i] = vue.getInt32(bloc + i * 4, false);
    for (let i = 16; i < 80; i++) {
      const x = mot[i - 3] ^ mot[i - 8] ^ mot[i - 14] ^ mot[i - 16];
      mot[i] = (x << 1) | (x >>> 31);
    }

    let [a, b, c, d, e] = h;
    for (let i = 0; i < 80; i++) {
      let f;
      let k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }

      const temp = (((a << 5) | (a >>> 27)) + f + e + k + mot[i]) | 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = temp;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0;
  }

  return h.map((n) => (n >>> 0).toString(16).padStart(8, '0')).join('');
}

export function createHash(algorithme) {
  if (algorithme !== 'sha1') throw new Error(`Algorithme non disponible dans le navigateur : ${algorithme}`);
  let contenu = '';
  return {
    update(texte) { contenu += texte; return this; },
    // argus-disable-next-line — meme raison : empreinte, pas condensat de securite
    digest() { return sha1(new TextEncoder().encode(contenu)); },
  };
}

export default { createHash };
