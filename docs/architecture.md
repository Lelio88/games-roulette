# Architecture — La Roulette

## Vue d'ensemble

La Roulette est un **site statique zéro-build** : trois fichiers (`index.html`, `style.css`, `script.js`) servis tels quels, sans bundler ni framework. Le jeu tire au sort une entité Minecraft sur une roue dessinée au Canvas, joue ses sons et révèle son render.

Deux modes cohabitent dans le même code :
- **Solo** — tirage local, progression persistée en `localStorage`.
- **Multi** — synchronisation temps réel via **Firebase Realtime Database** + **Auth anonyme**. L'hôte lance la roue, le résultat est diffusé, les autres joueurs devinent l'entité à partir du son, un scoreboard se met à jour en direct.

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
                                              │  (mode multi uniquement)
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

1. **Création** — l'hôte saisit un pseudo → `createRoom()` : auth anonyme, génère un code à 5 caractères libre, écrit `rooms/<CODE>` (`host`, `state.phase = idle`, `players/<uid>`). `onDisconnect(roomRef).remove()` nettoie la room si l'hôte part.
2. **Jointure** — un joueur ouvre `#room=<CODE>` → `joinRoom()` : auth, vérifie l'existence de la room, écrit `players/<uid>` avec `onDisconnect` de suppression.
3. **Écoute** — `setupRoomListeners()` abonne chaque client à `state`, `players`, `won` ; seul l'hôte écoute `guesses` (`onChildAdded`).
4. **Lancer** — l'hôte clique : `spin()` calcule le gagnant + `finalRotation`, garde `currentEntity` **en secret localement**, et écrit `state.phase = spinning` (+ `finalRotation`, `soundUrl`, `round`).
5. **Animation** — le listener `state` de **tous** les clients (hôte inclus) applique la rotation Canvas et joue le son après 5 s. L'hôte planifie le passage à `guessing`.
6. **Devinette** — `state.phase = guessing` déverrouille la barre de saisie. Un client pousse sa proposition dans `guesses/<id>` ; l'hôte la valide (`handleClientGuess`) contre `currentEntity` normalisé. L'hôte joue localement sans round-trip (`handleHostLocalGuess`).
7. **Résolution** — à la bonne réponse, l'hôte écrit atomiquement `players/<id>/points +1`, `won/<entity>`, et `state.phase = resolved` (+ `winnerId`, `entityName`). Tous les clients révèlent l'entité en haut et rafraîchissent le scoreboard.

**Invariant** : l'**hôte est l'autorité**. Lui seul connaît l'entité tirée et tranche les propositions ; les clients ne font que proposer et rendre l'état diffusé.

## Machine à états du tour (`MULTI.roundPhase`)

```
idle  ──(hôte lance)──▶  spinning  ──(≈5 s)──▶  guessing  ──(bonne réponse)──▶  resolved
  ▲                                                                                │
  └──────────────────────────(reset / nouveau tour)───────────────────────────────┘
```

`setRoundPhase(phase)` est le seul point qui pilote l'état de la buzz bar (activation de la saisie, messages). `handleStateUpdate(state)` traduit les changements Firebase en appels à `setRoundPhase` et déclenche l'animation, le son et le reveal.

## Modèle de sécurité Firebase

- **La clé `apiKey` de `FIREBASE_CONFIG` n'est pas un secret.** Dans une app web Firebase, elle identifie le projet côté client ; la protection réelle vient des **règles Realtime Database** définies dans la console Firebase. Ne jamais confondre avec une clé de compte de service / admin, qui, elle, ne doit **jamais** être committée.
- Les règles Realtime DB **ne sont pas versionnées dans ce dépôt**. Elles sont la seule barrière entre un client et les données : tout nouveau chemin `rooms/*` écrit par un client (nouveau sous-arbre `state`, `guesses`, etc.) doit être couvert par une règle correspondante, sinon il est soit ouvert à tous, soit rejeté.
- Le pseudo est le seul contenu réellement fourni par l'utilisateur ; il est échappé par `escapeHtml()` avant insertion `innerHTML` dans le scoreboard. Conserver cette discipline pour toute nouvelle donnée utilisateur affichée.

## Pipeline de données (`extract.py`)

Script Python **stdlib pure** (`json`, `re`, `zipfile`, `urllib`, `shutil`), exécuté ponctuellement sur un poste où Minecraft 1.20.4 est installé.

Pour chaque entité de `ENTITIES` (nom → mots-clés de son, chemins de texture candidats, titre de page wiki) :
1. **Sons** — parcourt l'index d'assets (`assets/indexes/12.json`), copie chaque `.ogg` correspondant depuis `assets/objects/<hash>`.
2. **Texture** — extrait le premier chemin candidat présent dans `1.20.4.jar`.
3. **Render** — interroge l'API MediaWiki de minecraft.wiki pour l'image principale de la page ; fallback silencieux sur la texture brute.
4. Réécrit intégralement `entities.json`.

Idempotent sur les renders (skip si le fichier existe déjà). En l'absence des assets locaux, le script s'interrompt proprement sans rien écrire.

## Anti-patterns à éviter

- ❌ Introduire un bundler, `npm`, ou un framework front — le zéro-build est un choix, pas un manque.
- ❌ Éditer à la main les champs dérivés d'`entities.json` (sons, texture, render, color) : ils divergeraient de `extract.py`.
- ❌ Insérer du contenu utilisateur en `innerHTML` sans `escapeHtml()`.
- ❌ Ajouter un chemin Firebase écrit par un client sans mettre à jour les règles Realtime DB.
- ❌ Faire valider une proposition par un client : l'entité tirée ne doit rester connue que de l'hôte.
- ❌ Committer une vraie clé privée / compte de service Firebase (≠ l'`apiKey` web).
- ❌ Laisser `entities.json` être servi en `file://` : `fetch` et les ES modules exigent un serveur HTTP.

## Dépendances externes critiques

| Dépendance | Usage | Chargement |
|---|---|---|
| Firebase 10.7.0 (`app`, `database`, `auth`) | Rooms multi temps réel + auth anonyme | ESM depuis `www.gstatic.com` (CDN) |
| minecraft.wiki (API MediaWiki) | Renders des entités | Appelée par `extract.py` uniquement (hors ligne) |
| Installation Minecraft 1.20.4 locale | Sons + textures brutes | Lue par `extract.py` uniquement (hors ligne) |
