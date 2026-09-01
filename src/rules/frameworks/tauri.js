import { lineIndexFor, matches } from '../../core/scan.js';

/**
 * Tauri.
 *
 * Tauri est sur par construction : la fenetre ne voit du systeme que ce que
 * l'« allowlist » lui accorde explicitement. Tout le modele repose donc sur
 * la finesse de cette liste — et `"all": true` la reduit a neant en une
 * ligne. C'est la configuration la plus courante des tutoriels, gardee
 * ensuite jusqu'a la production.
 */
function ligneDe(file, motif) {
  const m = motif.exec(file.content);
  if (!m) return null;
  return { position: lineIndexFor(file).position(m.index), match: m };
}

export default {
  id: 'tauri',
  label: 'Tauri',
  appliesTo: (context) => context.has('tauri'),

  run(context, report) {
    const configs = context.files.filter(
      (f) => f.readable && /(^|\/)tauri\.conf\.json$/.test(f.relativePath),
    );

    for (const file of configs) {
      const index = lineIndexFor(file);
      const brut = file.content;
      let data = null;
      try {
        data = JSON.parse(brut);
      } catch {
        continue; // configuration invalide : le build echouera de lui-meme
      }

      const tauri = data.tauri || {};
      const emettre = (constat) => report({ file: file.relativePath, effort: 'moyen', ...constat });

      if (tauri.allowlist?.all === true) {
        const trouve = ligneDe(file, /"all"\s*:\s*true/);
        emettre({
          ruleId: 'TAURI-ALLOWLIST-TOTALE',
          severity: 'critical',
          title: 'Allowlist Tauri ouverte en totalite',
          message:
            '`allowlist.all: true` accorde a la fenetre l\'ensemble des API natives : systeme de fichiers, shell, processus, HTTP sans restriction d\'origine. Tout le modele de securite de Tauri repose sur cette liste ; l\'ouvrir entierement revient a livrer un Electron sans isolation.',
          line: trouve?.position.line ?? 1,
          suggestion:
            'Remplacez par la liste exacte des API utilisees, par exemple `"fs": { "readFile": true, "scope": ["$APPDATA/*"] }`. Le build echouera sur ce qui manque, ce qui est le bon moment pour l\'ajouter.',
          tags: ['CWE-732'],
          docs: 'https://tauri.app/v1/api/config/#allowlistconfig',
        });
      }

      if (tauri.allowlist?.shell?.all === true || tauri.allowlist?.shell?.execute === true) {
        const trouve = ligneDe(file, /"(?:execute|all)"\s*:\s*true/g);
        emettre({
          ruleId: 'TAURI-SHELL-OUVERT',
          severity: 'critical',
          title: 'Execution shell accordee a la fenetre',
          message:
            'L\'API shell est ouverte : tout JavaScript s\'executant dans la fenetre — y compris injecte par une dependance compromise ou une page distante — peut lancer des commandes systeme avec les droits de l\'utilisateur.',
          line: trouve?.position.line ?? 1,
          suggestion:
            'Retirez `shell.execute`. Si l\'application doit lancer un binaire precis, declarez-le en `scope` avec ses arguments valides, ou exposez une commande Rust `#[tauri::command]` qui encapsule l\'operation.',
          tags: ['CWE-78', 'A03:2021'],
        });
      }

      if (Object.hasOwn(tauri.security || {}, 'csp') && tauri.security.csp === null) {
        const trouve = ligneDe(file, /"csp"\s*:\s*null/);
        emettre({
          ruleId: 'TAURI-CSP-ABSENTE',
          severity: 'high',
          title: 'Politique de securite du contenu desactivee',
          message:
            '`security.csp: null` retire la CSP injectee par Tauri. Rien n\'empeche plus la fenetre de charger et d\'executer un script distant, alors qu\'elle dispose des API natives accordees par l\'allowlist.',
          line: trouve?.position.line ?? 1,
          suggestion:
            "Definissez une CSP, en partant de `\"default-src 'self'; img-src 'self' asset: https://asset.localhost\"` puis en ouvrant au cas par cas.",
          tags: ['CWE-1021', 'A05:2021'],
          docs: 'https://tauri.app/v1/references/architecture/security',
        });
      }

      const ipcDistant = tauri.security?.dangerousRemoteDomainIpcAccess;
      if (Array.isArray(ipcDistant) && ipcDistant.length > 0) {
        const trouve = ligneDe(file, /"dangerousRemoteDomainIpcAccess"/);
        const domaines = ipcDistant.map((e) => e.domain).filter(Boolean).join(', ');
        emettre({
          ruleId: 'TAURI-IPC-DISTANT',
          severity: 'critical',
          title: 'IPC accessible depuis un domaine distant',
          message: `Les pages servies par ${domaines || 'un domaine distant'} peuvent appeler vos commandes Rust. Une compromission de ce domaine — ou de son CDN, ou une simple XSS — devient une execution de code sur la machine de l'utilisateur.`,
          line: trouve?.position.line ?? 1,
          suggestion:
            'Servez l\'interface depuis les assets empaquetes. Si du contenu distant est indispensable, affichez-le dans une fenetre separee sans acces IPC, et faites transiter les donnees par le processus Rust.',
          tags: ['CWE-346'],
          docs: 'https://tauri.app/v1/api/config/#securityconfig.dangerousremotedomainipcaccess',
        });
      }

      if (data.build?.withGlobalTauri === true) {
        const trouve = ligneDe(file, /"withGlobalTauri"\s*:\s*true/);
        emettre({
          ruleId: 'TAURI-GLOBAL-EXPOSE',
          severity: 'medium',
          title: 'API Tauri exposee sur window',
          message:
            '`withGlobalTauri` place l\'API sur `window.__TAURI__`, ou tout script de la page la trouve — y compris une dependance tierce. L\'import via `@tauri-apps/api` reste disponible pour votre code sans etre accessible aux autres.',
          line: trouve?.position.line ?? 1,
          suggestion: 'Passez a false et importez `@tauri-apps/api` dans vos modules.',
          effort: 'rapide',
          tags: ['CWE-1188'],
        });
      }

      void index;
    }
  },
};
