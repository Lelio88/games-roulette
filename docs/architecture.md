# Architecture — La Roulette

## Vue d'ensemble

La Roulette est un **site statique zéro-build** : trois fichiers (`index.html`, `style.css`, `script.js`) servis tels quels, sans bundler ni framework. Le jeu tire au sort une entité Minecraft sur une roue dessinée au Canvas, joue ses sons et révèle son render.

Deux modes cohabitent dans le même code :
- **Solo** — tirage local, progression persistée en `localStorage`. Aucun service tiers n'est contacté.
- **Multi** — synchronisation temps réel via **Firebase Realtime Database** + **Auth anonyme**. Le SDK n'est téléchargé qu'à l'entrée en multi. L'hôte lance la roue, le résultat est diffusé, les autres joueurs devinent l'entité à partir du son, un scoreboard se met à jour en direct.

Deux pages statiques, `mentions-legales.html` et `confidentialite.html`, partagent `style.css` et sont liées depuis l'écran d'accueil et le pied de page.

Les données de jeu (`entities.json`) et les assets sont **pré-générés hors ligne** par `extract.py` à partir d'une installation Minecraft locale et de la wiki. À l'exécution, le front ne fait que `fetch` du JSON et des médias.

## Topologie

```
┌───────────────────────────── NAVIGATEUR ─────────────────────────────┐
│                                                                       │
│   index.html ── charge ──▶ style.css        (tokens + animations)     │
│        │                                                              │
│        └──── <script type="module"> ──▶ script.js                     │
│                                            │                          │
│         ┌──────────────────────────────────┼───────────────────┐     │
│         ▼                                  ▼                    ▼      │
│   fetch entities.json          Canvas (roue + reveal)   localStorage   │
│   fetch assets/* (sons,                                 (solo: won,    │
│   textures, renders)                                     pseudo, jeu)  │
│                                            │                          │
└────────────────────────────────────────────┼─────────────────────────┘
                                              │  (mode multi uniquement : import()
                                              │   du SDK depuis www.gstatic.com)
                                              ▼
                              ┌──────────────────────────────┐
                              │   Firebase Realtime Database  │
                              │   rooms/<CODE>/               │
                              │     ├─ state  (phase, round…) │
                              │     ├─ players (name, points) │
                              │     ├─ guesses (client→hôte)  │
                              │     └─ won                    │
                              │   + Auth anonyme (uid)        │
                              └──────────────────────────────┘

  HORS LIGNE (préparation des données) :
  extract.py ──▶ entities.json  +  assets/sounds|textures|renders/*
     ▲
     └── lit ~/.minecraft (assets 1.20.4 + jar) + minecraft.wiki (API)
```

Le front et le pipeline de données sont **découplés** : `extract.py` ne tourne jamais en production, il alimente seulement les fichiers que le navigateur consomme.

## Arbre des fichiers

| Fichier / dossier | Rôle |
|---|---|
| `index.html` | Structure de l'UI : landing (choix de mode), setup multi, roue + tracker + panel, scoreboard, buzz bar. Tout est présent dans le DOM et masqué via `hidden`. |
| `style.css` | Design tokens (`:root`, thème sombre), layout responsive, et l'intégralité des animations (reveal, rayons, shimmer). |
| `script.js` | Module unique : init Firebase, registre `GAMES`, chargement des entités, roue Canvas, filtres, tracker, machine à états multi, cycle de vie des rooms. |
| `entities.json` | 70 entités. **Généré** — voir « Modèle de données ». |
| `extract.py` | Pipeline d'extraction hors ligne. Docstring de module en tête. |
| `assets/sounds/*.ogg` | Cris/sons extraits des assets Minecraft. |
| `assets/textures/*.png` | Textures brutes extraites du `.jar` (rendu pixelisé). |
| `assets/renders/*.png` | Renders soignés récupérés depuis minecraft.wiki (fallback : texture brute). |
| `database.rules.json` | Règles Realtime Database, déployées par `firebase deploy --only database`. Voir « Modèle de sécurité ». |
| `firebase.json`, `.firebaserc` | Projet `roulette-multijeux`, fichier de règles, port de l'émulateur. |
| `tests/regles.test.mjs` | Rejoue chaque écriture de `script.js` et ses détournements contre l'émulateur. Sans dépendance npm. |
| `mentions-legales.html`, `confidentialite.html` | Pages légales. La seconde reprend l'inventaire « Données personnelles ». |

## Registre de jeux (`GAMES`)

`script.js` définit un objet `GAMES` qui rend l'app **multi-jeux extensible**. Chaque entrée : `name`, `icon`, `color`, `available`. Un jeu disponible pointe vers un `dataPath` (JSON au même schéma que `entities.json`) ; un jeu indisponible fournit un `csDescription` affiché sur l'écran « Bientôt ». Seul `minecraft` est actif ; `pokemon` et `zelda` sont des jalons.

**Ajouter un jeu** : ajouter une entrée `GAMES`, fournir son JSON au schéma d'entité, basculer `available: true`. La roue, les filtres et le tracker fonctionnent sans autre changement.

## Modèle de données (`entities.json`)

Racine : `{ "entities": [ … ] }`. Chaque entité :

| Champ | Type | Source |
|---|---|---|
| `name` | string | Clé du dict `ENTITIES` d'`extract.py` |
| `type` | `hostile` \| `neutral` \| `passive` \| `boss` | Dict `TYPES` (pilote les filtres) |
| `sounds` | `[{ label, action, n, path }]` | Toutes les variantes de son extraites |
| `sound` | string | Raccourci = `sounds[0].path` (indice sonore du tirage) |
| `texture` | string | `assets/textures/<slug>.png` ou `""` |
| `render` | string | `assets/renders/<slug>.png` ou `""` |
| `color` | string `#rrggbb` | Dict `COLORS` (couleur de la part de roue) |

Le reveal privilégie `render`, retombe sur `texture` (marquée `pixelated`), puis rien. Les champs sont **dérivés** : ne pas les éditer à la main, passer par `extract.py`.

## Cycle d'un tour multi (flux typique)

C'est le scénario le plus riche du code — le tracer end-to-end est le meilleur point d'entrée pour un nouveau contributeur.

1. **Création** — l'hôte saisit un pseudo → `createRoom()` : chargement du SDK et auth anonyme (`initFirebase`), génère un code à 5 caractères libre, écrit `rooms/<CODE>` (`host`, `state.phase = idle`, `players/<uid>`). `onDisconnect(roomRef).remove()` nettoie la room si l'hôte part.
2. **Jointure** — un joueur ouvre `#room=<CODE>` → `joinRoom()` : auth, vérifie l'existence de la room, écrit `players/<uid>` avec `onDisconnect` de suppression.
3. **Écoute** — `setupRoomListeners()` abonne chaque client à `state`, `players`, `won` ; seul l'hôte écoute `guesses` (`onChildAdded`).
4. **Lancer** — l'hôte clique : `spin()` calcule le gagnant + `finalRotation`, garde `currentEntity` **en secret localement**, et écrit `state.phase = spinning` (+ `finalRotation`, `soundUrl`, `round`).
5. **Animation** — le listener `state` de **tous** les clients (hôte inclus) applique la rotation Canvas et joue le son après 5 s. L'hôte planifie le passage à `guessing`.
6. **Devinette** — `state.phase = guessing` déverrouille la barre de saisie. Un client pousse sa proposition dans `guesses/<id>` ; l'hôte la valide (`handleClientGuess`) contre `currentEntity` normalisé. L'hôte joue localement sans round-trip (`handleHostLocalGuess`).
7. **Résolution** — à la bonne réponse, l'hôte écrit atomiquement `players/<id>/points +1`, `won/<entity>`, et `state.phase = resolved` (+ `winnerId`, `entityName`). Tous les clients révèlent l'entité en haut et rafraîchissent le scoreboard.

**Invariant** : l'**hôte est l'autorité**. Lui seul connaît l'entité tirée et tranche les propositions ; les clients ne font que proposer et rendre l'état diffusé. La remise à zéro du salon (bouton Reset, `resetWon`) lui est aussi réservée : le bouton est masqué chez les autres joueurs, et les règles refuseraient l'écriture.

## Machine à états du tour (`MULTI.roundPhase`)

```
idle  ──(hôte lance)──▶  spinning  ──(≈5 s)──▶  guessing  ──(bonne réponse)──▶  resolved
  ▲                                                                                │
  └──────────────────────────(reset / nouveau tour)───────────────────────────────┘
```

`setRoundPhase(phase)` est le seul point qui pilote l'état de la buzz bar (activation de la saisie, messages). `handleStateUpdate(state)` traduit les changements Firebase en appels à `setRoundPhase` et déclenche l'animation, le son et le reveal.

## Modèle de sécurité Firebase

- **La clé `apiKey` de `FIREBASE_CONFIG` n'est pas un secret.** Dans une app web Firebase, elle identifie le projet côté client ; elle est en outre restreinte par domaine (`127.0.0.1` est refusé, `localhost` accepté). Ne jamais la confondre avec une clé de compte de service / admin, qui, elle, ne doit **jamais** être committée.
- **Les règles `database.rules.json` sont la seule barrière** entre un client et les données : n'importe qui obtient un compte anonyme avec la clé publique. Elles sont versionnées ici et déployées par le CLI ; la console ne sert plus à les éditer.
- **Piège de la cascade** : en Realtime Database, un `.write` accordé à un nœud ne peut pas être retiré plus bas. Un `.write` ouvert au niveau `rooms/$roomId` annule donc toutes les règles fines en dessous. Seul l'hôte y reçoit l'écriture.

| Chemin | Qui écrit | Contraintes |
|---|---|---|
| `rooms/$roomId` | l'hôte (`host` = son uid) ; à la création, celui qui s'y inscrit comme hôte | code de 5 caractères de l'alphabet de `genRoomCode` ; `host`, `createdAt`, `state` obligatoires, immuables pour les deux premiers ; aucune clé inconnue |
| `state` | l'hôte | `phase` dans la machine à états ; `soundUrl` vide ou limité à `assets/…/*.ogg` (jamais une URL externe) ; tailles bornées ; aucune clé inconnue |
| `players/$uid` | le joueur lui-même, pour s'inscrire (salon existant, `points` = 0) ou partir ; l'hôte pour le reste | `name` de 1 à 20 caractères, `points` nombre de 0 à 10 000 |
| `guesses/$id` | un joueur inscrit, en création seule, pendant la phase `guessing`, à son propre nom, sans verdict | `text` de 1 à 40 caractères ; le `verdict` (`correct`/`wrong`) n'est écrit que par l'hôte |
| `won/$entité` | l'hôte | booléen |

- La lecture d'un salon est ouverte à tout compte authentifié qui en connaît le code, même sans le rejoindre (il faut le lire pour le rejoindre) ; la liste des salons ne l'est pas. `confidentialite.html` le dit : les données d'un salon sont visibles de quiconque en a le lien.
- **Tout champ lu en base est traité comme hostile côté client** : les pseudos passent par `escapeHtml()`, les points sont forcés en nombre avant l'insertion `innerHTML` du scoreboard, `winnerName` est posé en `textContent`.
- **Limite assumée** : les règles ne savent pas limiter un débit. Un compte malveillant peut multiplier salons ou propositions ; leur taille est bornée, et un salon disparaît avec son hôte.

## Pipeline de données (`extract.py`)

Script Python **stdlib pure** (`json`, `re`, `zipfile`, `urllib`, `shutil`), exécuté ponctuellement sur un poste où Minecraft 1.20.4 est installé.

Pour chaque entité de `ENTITIES` (nom → mots-clés de son, chemins de texture candidats, titre de page wiki) :
1. **Sons** — parcourt l'index d'assets (`assets/indexes/12.json`), copie chaque `.ogg` correspondant depuis `assets/objects/<hash>`.
2. **Texture** — extrait le premier chemin candidat présent dans `1.20.4.jar`.
3. **Render** — interroge l'API MediaWiki de minecraft.wiki pour l'image principale de la page ; fallback silencieux sur la texture brute.
4. Réécrit intégralement `entities.json`.

Idempotent sur les renders (skip si le fichier existe déjà). En l'absence des assets locaux, le script s'interrompt proprement sans rien écrire.

## Données personnelles (inventaire)

Source de `confidentialite.html` ; toute nouvelle donnée ou tout nouveau service s'ajoute aux deux.

| Donnée | Finalité | Base légale | Durée | Stockage | Sous-traitant |
|---|---|---|---|---|---|
| Progression, jeu, mode, pseudo | Retrouver sa partie à la visite suivante | Fonctionnement demandé (stockage exempté de consentement) | Jusqu'à effacement par le joueur | `localStorage` du navigateur | — |
| Identifiant anonyme | Reconnaître le joueur dans un salon | Fournir le jeu | **Sans limite** : aucun nettoyage automatique (choix assumé) ; plus rattaché à rien une fois le salon fermé | Firebase Authentication (+ IndexedDB du navigateur) | Google (États-Unis possible) |
| Pseudo, points | Scoreboard du salon | Fournir le jeu | Jusqu'au départ du joueur (`onDisconnect`) ou à la fermeture du salon | Realtime DB `europe-west1` (Belgique) | Google |
| Propositions | Validation par l'hôte | Fournir le jeu | Jusqu'à la remise à zéro ou la fermeture du salon | Realtime DB | Google |
| Adresse IP | Servir le site, charger et joindre Firebase | Intérêt légitime | Journaux des prestataires | — | GitHub, Google |

Aucun cookie, aucune mesure d'audience, aucune publicité : pas de bandeau de consentement. Ajouter un traceur non essentiel imposerait un bandeau.

## Anti-patterns à éviter

- ❌ Introduire un bundler, `npm`, ou un framework front — le zéro-build est un choix, pas un manque.
- ❌ Éditer à la main les champs dérivés d'`entities.json` (sons, texture, render, color) : ils divergeraient de `extract.py`.
- ❌ Insérer en `innerHTML` un champ lu en base sans `escapeHtml()` (texte) ou `Number()` (nombre) : n'importe quel joueur du salon peut l'avoir écrit.
- ❌ Ajouter un chemin ou un champ Firebase écrit par un client sans règle dans `database.rules.json` ni cas dans `tests/regles.test.mjs`.
- ❌ Accorder `.write` à un non-hôte au niveau `rooms/$roomId` : la cascade rend inopérantes toutes les règles plus fines.
- ❌ Éditer les règles dans la console Firebase : le prochain déploiement les écraserait, et le test ne les couvrirait plus.
- ❌ Importer Firebase statiquement en tête de `script.js` : le mode solo contacterait Google sans raison.
- ❌ Faire valider une proposition par un client : l'entité tirée ne doit rester connue que de l'hôte.
- ❌ Committer une vraie clé privée / compte de service Firebase (≠ l'`apiKey` web).
- ❌ Laisser `entities.json` être servi en `file://` : `fetch` et les ES modules exigent un serveur HTTP.

## Dépendances externes critiques

| Dépendance | Usage | Chargement |
|---|---|---|
| Firebase 10.7.0 (`app`, `database`, `auth`) | Rooms multi temps réel + auth anonyme | ESM depuis `www.gstatic.com` (CDN), par `import()` à l'entrée en multi |
| `firebase-tools` (via `npx`) + Java | Émulateur pour `tests/regles.test.mjs`, déploiement des règles | Poste de développement uniquement |
| minecraft.wiki (API MediaWiki) | Renders des entités | Appelée par `extract.py` uniquement (hors ligne) |
| Installation Minecraft 1.20.4 locale | Sons + textures brutes | Lue par `extract.py` uniquement (hors ligne) |
