import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan } from '../src/index.js';
import { renderReport } from '../src/report/terminal.js';

/**
 * Defauts remontes par une equipe apres usage sur un ERP Django en production
 * (~120 000 lignes). Chacun avait ete verifie dans leur code avant d'etre
 * signale ; chacun est fige ici.
 */

/** Une migration telle que `makemigrations` l'ecrit. */
const MIGRATION = [
  'from django.db import migrations, models',
  '',
  '',
  'class Migration(migrations.Migration):',
  '    initial = True',
  '    dependencies = [("auth", "0012_alter_user_first_name_max_length")]',
  '    operations = [',
  '        migrations.CreateModel(',
  '            name="NOM",',
  '            fields=[("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False))],',
  '        ),',
  '    ]',
].join('\n');

function projetDjango(fichiers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-terrain-'));
  fs.writeFileSync(path.join(dir, 'requirements.txt'), 'Django==5.2.6\n');
  fs.writeFileSync(
    path.join(dir, 'manage.py'),
    [
      'import os',
      'import sys',
      '',
      'if __name__ == "__main__":',
      '    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "monsite.settings")',
      '    from django.core.management import execute_from_command_line',
      '',
      '    execute_from_command_line(sys.argv)',
    ].join('\n'),
  );

  for (const [chemin, contenu] of Object.entries(fichiers)) {
    const complet = path.join(dir, chemin);
    fs.mkdirSync(path.dirname(complet), { recursive: true });
    fs.writeFileSync(complet, contenu);
  }
  return dir;
}

test('terrain : un fichier test_*.py est bien un fichier de test', async () => {
  // La convention Python place le mot avant un underscore ; il ne figurait pas
  // parmi les separateurs. Trois fichiers representaient quinze pour cent des
  // constats d'un projet reel qui les avait pourtant exclus.
  const dir = projetDjango({
    'argus.config.json': JSON.stringify({ includeTests: false }),
    'core/test_journal.py': 'import hashlib\n\ndef test_x():\n    return hashlib.md5(b"a").hexdigest()\n',
    'core/views.py': 'import hashlib\n\ndef vue(request):\n    return hashlib.sha256(b"a").hexdigest()\n',
  });

  const rapport = await scan(dir, { noHistory: true });
  assert.deepEqual(
    rapport.findings.filter((f) => f.file?.includes('test_journal')),
    [],
    'includeTests: false est une consigne explicite',
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('terrain : un CSS compile par Tailwind n\'a pas d\'auteur a blamer', async () => {
  // 84 constats de duplication sur `static/css/output.css`. La marque
  // `@generated` est une convention que peu d'outils suivent.
  const dir = projetDjango({
    'static/css/output.css':
      '/*! tailwindcss v3.4.1 | MIT License | https://tailwindcss.com*/\n' +
      Array.from({ length: 200 }, (_, i) => `.c${i}{color:#111;background:#fff;padding:4px}`).join('\n'),
  });

  const rapport = await scan(dir, { noHistory: true });
  const surLeCss = rapport.findings.filter((f) => f.file?.includes('output.css') && f.category === 'design');
  assert.deepEqual(surLeCss, [], 'un fichier produit par un outil est ecarte');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('terrain : un champ enveloppe par son label est correctement associe', async () => {
  // `<label><input type="checkbox"> Texte</label>` est valide, et c'est meme
  // la forme recommandee pour les cases a cocher.
  const dir = projetDjango({
    'gabarits/page.html': [
      '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Connexion au portail</title>',
      '<meta name="description" content="Connectez-vous a votre espace pour gerer vos commandes et vos preferences."></head>',
      '<body><main><h1>Connexion</h1><form method="post">',
      '  <label><input type="checkbox" name="se_souvenir"> Se souvenir de moi</label>',
      '  <label>Telephone</label>',
      '  <input type="tel" name="telephone">',
      '</form></main></body></html>',
    ].join('\n'),
  });

  const rapport = await scan(dir, { noHistory: true });
  const sansLabel = rapport.findings.filter((f) => f.ruleId === 'A11Y-INPUT-NO-LABEL');

  assert.equal(sansLabel.length, 1, 'seul le champ reellement sans etiquette');
  assert.match(sansLabel[0].snippet, /tel/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('terrain : innerHTML litteral n\'expose rien', async () => {
  // Les six constats du projet portaient tous sur une chaine constante. Le
  // risque vient de la donnee variable, pas de `innerHTML` en soi.
  const dir = projetDjango({
    'static/app.js': [
      'export function init(btn, donnees) {',
      "  btn.innerHTML = '<i class=\"fa fa-chevron-left\"></i>';",
      "  document.getElementById('titre').innerHTML = donnees.titre;",
      '}',
    ].join('\n'),
  });

  const rapport = await scan(dir, { noHistory: true });
  const html = rapport.findings.filter((f) => f.ruleId === 'SEC-INNERHTML');

  assert.equal(html.length, 1, 'seule la valeur variable doit remonter');
  assert.match(html[0].snippet, /donnees\.titre/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('terrain : du JSON interpole dans un <script> est une faille', async () => {
  // Faille reelle qu'Argus n'avait pas vue. Un JSON valide n'est pas sur
  // dans un <script> : la chaine « </script » y ferme la balise.
  const dir = projetDjango({
    'gabarits/tableau.html': [
      '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Tableau de bord</title>',
      '<meta name="description" content="Vue d ensemble de vos indicateurs et de votre activite recente."></head>',
      '<body><main><h1>Tableau</h1>',
      '<script>window.sons = {{ preferences_json|safe }};</script>',
      '</main></body></html>',
    ].join('\n'),
  });

  const rapport = await scan(dir, { noHistory: true });
  const constat = rapport.findings.find((f) => f.ruleId === 'SEC-DONNEES-DANS-SCRIPT');

  assert.ok(constat, 'l\'interpolation dans un script doit etre signalee');
  assert.equal(constat.severity, 'high');
  assert.match(constat.suggestion, /json_script/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('terrain : un defaut de developpement surcharge en production', async () => {
  // Un projet correctement durci etait declare non durci, au rang le plus
  // grave. La valeur qui compte est la derniere evaluee.
  const avecSurcharge = projetDjango({
    'monsite/settings.py': [
      'import os',
      '',
      'DEBUG = os.environ.get("DEBUG", "0") == "1"',
      'SESSION_COOKIE_SECURE = False',
      '',
      'if not DEBUG:',
      '    SESSION_COOKIE_SECURE = True',
    ].join('\n'),
  });

  const rapport = await scan(avecSurcharge, { noHistory: true });
  assert.deepEqual(
    rapport.findings.filter((f) => f.ruleId === 'SEC-SECURE-FLAG-OFF'),
    [],
    'la surcharge en production doit etre vue',
  );
  fs.rmSync(avecSurcharge, { recursive: true, force: true });

  // Sans surcharge, le constat reste.
  const sansSurcharge = projetDjango({
    'monsite/settings.py': 'SESSION_COOKIE_SECURE = False\n',
  });
  const rapport2 = await scan(sansSurcharge, { noHistory: true });
  assert.ok(rapport2.findings.some((f) => f.ruleId === 'SEC-SECURE-FLAG-OFF'));
  fs.rmSync(sansSurcharge, { recursive: true, force: true });
});

test('terrain : un constat critique n\'est jamais tronque', async () => {
  // « 820 probleme(s) non affiches » masquait leur unique constat critique :
  // le budget d'affichage se consommait dans l'ordre des categories, et la
  // sienne venait tard.
  const bruit = Array.from(
    { length: 80 },
    (_, i) => `<div><img src="i${i}.png"><input type="text" name="f${i}"></div>`,
  ).join('\n');

  const dir = projetDjango({
    'page.html': bruit,
    // argus-ignore SEC-SECRET-AWS-SECRET : la clef d'exemple de la
    // documentation AWS, ici pour declencher un constat critique — c'est
    // exactement ce que le test verifie.
    'monsite/secrets.py': 'AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"\n',
  });

  const rapport = await scan(dir, { noHistory: true });
  const critiques = rapport.findings.filter((f) => f.severity === 'critical');
  assert.ok(critiques.length > 0, 'le decor du test doit produire un critique');

  const sortie = renderReport(rapport);
  for (const constat of critiques) {
    assert.ok(
      sortie.includes(constat.ruleId),
      `${constat.ruleId} doit apparaitre malgre la troncature`,
    );
  }

  fs.rmSync(dir, { recursive: true, force: true });
});

test('terrain : le rapport dit sur quelle base la veille a conclu', async () => {
  // Deux scans consecutifs, sans toucher aux dependances, avaient donne 2 puis
  // 8 constats : la synchronisation OSV s'etait faite en silence entre les
  // deux. Un score qui bouge sans que le code bouge fait douter du reste.
  const dir = projetDjango({});

  const sans = await scan(dir, { noHistory: true });
  assert.equal(sans.veille.source, 'embarquee');
  assert.match(renderReport(sans), /liste embarquee/);

  fs.mkdirSync(path.join(dir, '.argus'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.argus', 'osv-cache.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), packages: { 'PyPI:django@5.2.6': [] } }),
  );

  const avec = await scan(dir, { noHistory: true });
  assert.equal(avec.veille.source, 'osv');
  assert.equal(avec.veille.entrees, 1);
  assert.match(renderReport(avec), /base OSV, 1 paquet/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('terrain : MD5 d\'empreinte de cache n\'est pas MD5 de mot de passe', async () => {
  // Ils s'en servaient pour suffixer leurs statiques. Signaler les deux au
  // meme rang apprend a ignorer la regle — donc a rater le mot de passe.
  const dir = projetDjango({
    'core/statiques.py': [
      'import hashlib',
      '',
      '',
      'def empreinte_de_cache(chemin):',
      '    \"\"\"Suffixe ?v=... pour invalider le cache navigateur.\"\"\"',
      '    with open(chemin, "rb") as f:',
      '        return hashlib.md5(f.read()).hexdigest()[:8]',
      '',
      '',
      'def etag_du_fichier(contenu):',
      '    return hashlib.md5(contenu).hexdigest()',
      '',
      '',
      'def hacher_mot_de_passe(mot_de_passe):',
      '    return hashlib.md5(mot_de_passe.encode()).hexdigest()',
    ].join('\n'),
  });

  const rapport = await scan(dir, { noHistory: true });
  const parLigne = new Map(
    rapport.findings.filter((f) => f.ruleId === 'SEC-WEAK-HASH').map((f) => [f.line, f.severity]),
  );

  assert.equal(parLigne.get(7), 'low', 'empreinte de cache');
  assert.equal(parLigne.get(11), 'low', 'etag');
  assert.equal(parLigne.get(15), 'high', 'mot de passe : le rang ne bouge pas');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('terrain : un |safe sur une valeur n\'est pas un autoescape off global', async () => {
  const dir = projetDjango({
    'gabarits/page.html': '<p>{{ contenu_utilisateur|safe }}</p>\n',
    'monsite/moteur.py': 'env = Environment(autoescape=False)\n',
  });

  const rapport = await scan(dir, { noHistory: true });
  const constats = rapport.findings.filter((f) => f.ruleId === 'SEC-TEMPLATE-AUTOESCAPE');
  const parFichier = new Map(constats.map((f) => [path.basename(f.file), f.severity]));

  assert.equal(parFichier.get('page.html'), 'medium', 'une valeur : une question, pas un verdict');
  assert.equal(parFichier.get('moteur.py'), 'high', 'le contournement global couvre tout');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('terrain : un projet Django multi-applications n\'est pas du code mort', async () => {
  // Le tableau du paragraphe 4 du releve, reconstruit d'un bloc : espaces de
  // noms d'URL, include(), imports en corps de fonction, imports multi-lignes
  // et migrations generees. Chez eux, 196 + 12 constats de code mort, aucun
  // exploitable.
  const dir = projetDjango({
    'monsite/urls.py': [
      'from django.urls import include, path',
      '',
      'urlpatterns = [',
      '    path("", include("comptes.urls")),',
      '    path("factures/", include("factures.urls")),',
      ']',
    ].join('\n'),

    'comptes/urls.py': [
      'from django.urls import path',
      'from . import views',
      '',
      'app_name = "comptes"',
      '',
      'urlpatterns = [',
      '    path("", views.accueil, name="accueil"),',
      '    path("mot-de-passe/", views.changer, name="change_password_obligatoire"),',
      ']',
    ].join('\n'),

    'factures/urls.py': [
      'from django.urls import path',
      'from . import views',
      '',
      'app_name = "factures"',
      '',
      'urlpatterns = [',
      '    path("", views.liste, name="liste"),',
      ']',
    ].join('\n'),

    'comptes/views.py': [
      'import io',
      '',
      'from django.shortcuts import redirect, render',
      '',
      '',
      'def accueil(request):',
      '    return redirect("comptes:change_password_obligatoire")',
      '',
      '',
      'def changer(request):',
      '    # Import differe : casse un cycle avec le module de facturation.',
      '    import segno',
      '',
      '    tampon = io.BytesIO()',
      '    segno.make("x").save(tampon, kind="png")',
      '    return render(request, "comptes/mot_de_passe.html")',
    ].join('\n'),

    'factures/views.py': [
      'from decimal import (',
      '    Decimal,',
      '    ROUND_HALF_UP,',
      ')',
      '',
      'from django.shortcuts import render',
      '',
      '',
      'def liste(request):',
      '    total = Decimal("1.005").quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)',
      '    return render(request, "factures/liste.html", {"total": total})',
    ].join('\n'),

    'comptes/migrations/0001_initial.py': MIGRATION.replace(/NOM/g, 'Profil'),
    'comptes/migrations/0002_reglage.py': MIGRATION.replace(/NOM/g, 'Reglage'),
  });

  const rapport = await scan(dir, { noHistory: true });
  const parRegle = (id) => rapport.findings.filter((f) => f.ruleId === id);

  assert.deepEqual(
    parRegle('ROUTE-BROKEN-LINK').map((f) => f.snippet),
    [],
    'redirect("comptes:x") designe une route nommee, pas un chemin',
  );
  assert.deepEqual(
    parRegle('ROUTE-DUPLICATE').map((f) => f.message),
    [],
    'deux applications montees sous deux prefixes ne declarent pas la meme route',
  );
  assert.deepEqual(
    parRegle('DEAD-IMPORT').map((f) => `${f.file}:${f.line}`),
    [],
    'import en corps de fonction et import multi-lignes sont vus',
  );
  assert.deepEqual(
    parRegle('QUAL-DUPLICATION').map((f) => f.file),
    [],
    'les migrations sont ecrites par makemigrations',
  );

  // Le prefixe du montage doit avoir ete propage, sinon la comparaison
  // ci-dessus passerait pour la mauvaise raison.
  const factures = rapport.routes.find((r) => r.handler === 'factures:liste');
  assert.equal(factures?.pattern, '/factures');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('terrain : les six facons d\'importer sans que ce soit mort', async () => {
  // Sur `requests` et `flask`, 90 constats d'import mort. Zero etait fonde.
  // Chaque ligne ci-dessous represente une des familles rencontrees ; la
  // derniere, elle, doit toujours remonter.
  const dir = projetDjango({
    'lib/formes.py': [
      'from __future__ import annotations',
      '',
      'from typing import TYPE_CHECKING',
      '',
      'import platform',
      'import json  # noqa: F401',
      '',
      'from urllib3.util import Timeout as TimeoutSauce',
      'from decimal import (',
      '    Decimal,',
      '    ROUND_HALF_UP,',
      ')',
      '',
      'import csv',
      '',
      'if TYPE_CHECKING:',
      '    from .models import Facture',
      '',
      '',
      'def version() -> str:',
      '    """Exemple d\'usage :',
      '',
      '    .. code-block:: python',
      '',
      '        import gevent',
      '        from flask import copy_current_request_context',
      '    """',
      '    delai = TimeoutSauce(connect=1)',
      '    montant = Decimal("1.005").quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)',
      '    return f"Python {platform.python_version()} {delai} {montant}"',
      '',
      '',
      'def total(facture: "Facture") -> int:',
      '    return facture.total',
    ].join('\n'),
  });

  const rapport = await scan(dir, { noHistory: true });
  const morts = rapport.findings
    .filter((f) => f.ruleId === 'DEAD-IMPORT')
    .map((f) => f.data.symbol);

  // `csv` n'est utilise nulle part : c'est le seul vrai constat du fichier.
  assert.deepEqual(morts, ['csv'], `constats inattendus : ${morts.join(', ')}`);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('terrain : une interpolation Python compte comme un usage', async () => {
  // Le masquage effacait la f-string entiere, gabarits JavaScript exceptes.
  // `f"{platform.python_version()}"` ne comptait donc pas comme un usage.
  const { maskCommentsAndStrings } = await import('../src/core/scan.js');

  const source = 'x = f"Python {platform.python_version()} et {{litteral}}"';
  const masque = maskCommentsAndStrings(source, 'python');

  assert.ok(masque.includes('platform.python_version()'), 'le code interpole survit');
  assert.ok(!masque.includes('Python '), 'le texte litteral est bien efface');
  assert.ok(!masque.includes('litteral'), 'une accolade doublee est un caractere, pas du code');
});
