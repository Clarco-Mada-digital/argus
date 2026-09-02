import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluerChargement, SEUILS } from '../src/perf/regles.js';
import { trouverNavigateur } from '../src/perf/navigateur.js';

/**
 * Ces tests portent sur l'evaluation, pas sur le pilotage du navigateur :
 * exiger Chrome les rendrait ininstallables en integration continue, et une
 * suite qu'on ne peut pas lancer partout finit par ne plus etre lancee.
 */
const mesuresSaines = {
  url: 'https://exemple.com',
  lcp: 1200, cls: 0.02, ttfb: 300, premierePeinture: 900,
  requetes: 20, octets: 400 * 1024, parType: { Document: 20000, Script: 100000 },
  lourdes: [],
};

const avec = (surcharges) => ({ ...mesuresSaines, ...surcharges });
const ids = (mesures) => evaluerChargement(mesures).map((c) => c.ruleId);

test('perf : une page rapide ne produit aucun constat', () => {
  assert.deepEqual(evaluerChargement(mesuresSaines), []);
});

test('perf : les seuils sont ceux des Core Web Vitals', () => {
  // Inventer ses propres seuils rendrait le resultat incomparable avec la
  // Search Console de l'utilisateur, qui est la seule mesure ayant des
  // consequences pour lui.
  assert.equal(SEUILS.lcp.bon, 2500);
  assert.equal(SEUILS.lcp.mauvais, 4000);
  assert.equal(SEUILS.cls.bon, 0.1);
  assert.equal(SEUILS.ttfb.bon, 800);
});

test('perf : le LCP est gradue, pas binaire', () => {
  assert.deepEqual(ids(avec({ lcp: 2400 })), [], 'sous le seuil : rien');

  const moyen = evaluerChargement(avec({ lcp: 3000 }));
  assert.equal(moyen[0].ruleId, 'PERF-LCP-LENT');
  assert.equal(moyen[0].severity, 'medium');

  const grave = evaluerChargement(avec({ lcp: 5000 }));
  assert.equal(grave[0].severity, 'high');
  assert.match(grave[0].title, /5\.00 s/);
});

test('perf : un decalage de mise en page est explique en termes concrets', () => {
  const constats = evaluerChargement(avec({ cls: 0.3 }));
  const cls = constats.find((c) => c.ruleId === 'PERF-CLS-INSTABLE');

  assert.equal(cls.severity, 'high');
  // Le message doit dire ce que le visiteur *vit*, pas seulement le chiffre.
  assert.match(cls.message, /saute|derobe/);
  assert.match(cls.suggestion, /width.*height|hauteur minimale/);
});

test('perf : un serveur lent est signale sans dramatiser', () => {
  // Le TTFB compte, mais il ne merite pas le meme rang qu'un rendu casse :
  // il est souvent hors de portee immediate de celui qui lit le rapport.
  const constats = evaluerChargement(avec({ ttfb: 2500 }));
  const ttfb = constats.find((c) => c.ruleId === 'PERF-TTFB-LENT');

  assert.equal(ttfb.severity, 'medium');
  assert.match(ttfb.message, /aucune optimisation cote navigateur/i);
});

test('perf : le poids total detaille sa repartition', () => {
  const constats = evaluerChargement(
    avec({ octets: 6 * 1024 * 1024, parType: { Image: 4 * 1024 * 1024, Script: 2 * 1024 * 1024 } }),
  );
  const poids = constats.find((c) => c.ruleId === 'PERF-POIDS-TOTAL');

  assert.equal(poids.severity, 'medium');
  assert.match(poids.title, /6\.0 Mo/);
  // Sans repartition, le constat n'indique pas par ou commencer.
  assert.match(poids.suggestion, /Image 4\.0 Mo/);
});

test('perf : seules les ressources vraiment lourdes remontent', () => {
  const constats = evaluerChargement(
    avec({
      lourdes: [
        { url: 'https://exemple.com/a/banniere.png', octets: 800 * 1024, type: 'Image' },
        { url: 'https://exemple.com/b/app.js', octets: 300 * 1024, type: 'Script' },
        { url: 'https://exemple.com/c/petit.css', octets: 120 * 1024, type: 'Stylesheet' },
      ],
    }),
  );
  const lourdes = constats.filter((c) => c.ruleId === 'PERF-RESSOURCE-LOURDE');

  assert.equal(lourdes.length, 2, 'en dessous de 200 Ko, le constat serait du bruit');
  assert.equal(lourdes[0].severity, 'medium');
  assert.match(lourdes[0].message, /banniere\.png/);
  // Le conseil depend du type : convertir une image, decouper un script.
  assert.match(lourdes[0].suggestion, /AVIF|WebP/);
  assert.match(lourdes[1].suggestion, /Decoupez/);
});

test('perf : un LCP a zero n\'est pas un LCP parfait', () => {
  // Une page sans element mesurable renvoie zero : le signaler comme
  // excellent serait un mensonge, l'ignorer est la seule reponse honnete.
  assert.deepEqual(ids(avec({ lcp: 0 })), []);
  assert.deepEqual(ids(avec({ ttfb: 0 })), []);
});

test('perf : l\'absence de navigateur se detecte avant de mesurer', () => {
  // La commande doit pouvoir expliquer le prerequis plutot que d'echouer
  // avec une trace d'erreur incomprehensible.
  const resultat = trouverNavigateur();
  assert.ok(resultat === null || typeof resultat === 'string');
});
