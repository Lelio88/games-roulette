# La Roulette — Contexte d'Opération et Garde-Fous Agentiques

Résolvez les problèmes sans introduire de régression ni de dette technique architecturale.

## I. Finalité

**Application** : La Roulette — roue de la fortune web qui tire au sort une entité Minecraft, joue ses sons et révèle son render.
**Objectif métier** : jeu de devinette. En **solo**, on tire et on suit sa progression ; en **multi**, l'hôte lance la roue et les autres joueurs devinent l'entité au son (scoreboard temps réel via Firebase). Registre de jeux extensible (Pokémon, Zelda à venir).

## II. Architecture

**Modèle** : site statique **zéro-build** (HTML + CSS + un seul module JS impératif orienté DOM). Temps réel délégué à Firebase Realtime Database + Auth anonyme. Données pré-générées par un script Python hors ligne.

**Détails complets** (cycle d'un tour multi, machine à états, modèle de sécurité, pipeline de données, topologie) : voir [`docs/architecture.md`](./docs/architecture.md).

Topologie rapide :
- `index.html` — structure de l'UI (landing, setup multi, roue, tracker, scoreboard, buzz bar)
- `style.css` — design tokens (thème sombre) + toutes les animations
- `script.js` — logique unique : roue Canvas, filtres, multi Firebase, machine à états
- `entities.json` — 70 entités (**généré** ; ne pas éditer à la main les champs dérivés)
- `extract.py` — pipeline d'extraction sons/textures/renders → `entities.json`
- `assets/` — `sounds/*.ogg`, `textures/*.png` (jar), `renders/*.png` (wiki)

## III. Pile Technologique

*Aucun gestionnaire de paquets : dépendances chargées par CDN ou stdlib. N'introduisez ni bundler ni framework sans approbation.*

- **Front** : HTML5 Canvas, CSS custom properties, JavaScript ES modules (vanilla, sans framework)
- **Temps réel** : Firebase 10.7.0 (`app`, `database`, `auth`) importé depuis le CDN gstatic
- **Data** : Python 3 (stdlib seule : `json`, `zipfile`, `urllib`) — `extract.py`

## IV. Garde-Fous non négociables

1. **Zéro-build** : pas de npm/bundler/framework. Le site doit tourner tel quel derrière un simple serveur statique.
2. **Sécurité multi = règles Firebase Realtime Database** (définies dans la console, non versionnées ici). Tout nouveau chemin `rooms/*` écrit par un client doit être couvert par une règle. La clé `apiKey` de `script.js` n'est **pas** un secret (modèle Firebase web) ; ne jamais committer en revanche une clé de service / compte admin.
3. **`entities.json` est généré** par `extract.py`. Pour ajouter/modifier une entité, éditer `extract.py` (dicts `ENTITIES` / `TYPES` / `COLORS`) puis régénérer — ne pas diverger à la main.
4. **Échapper tout contenu utilisateur** (pseudos) via `escapeHtml()` avant toute insertion `innerHTML`.
5. **L'hôte est l'autorité du tour multi** : il détient `currentEntity` (secret) et valide les propositions. Préserver la machine à états `idle → spinning → guessing → resolved`.
6. **Français** dans l'UI, les commentaires et la doc.

## V. Flux de Travail (Explore → Plan → Code → Verify)

1. **Exploration** — lire les fonctions adjacentes dans `script.js` pour calquer le style impératif et le nommage.
2. **Planification** — soumettre l'approche pour tout changement touchant la sync multi ou la machine à états.
3. **Implémentation** — code minimal, fonctions courtes ; réutiliser les helpers existants (`normalize`, `escapeHtml`, `renderSoundChipsInto`).
4. **Vérification** — servir en local, tester **solo** puis un tour **multi** à deux onglets (création room + jointure via `#room=CODE`).

**Auto-documentation** — tout nouveau fichier principal ou script publie en tête un commentaire-doc : ce qu'il fait, les choix non-évidents et leur motivation, les invariants à préserver. `extract.py` en est l'exemple (docstring de module).

## VI. Commandes de Développement

```bash
# Servir le site (obligatoire : fetch + ES modules ne marchent pas en file://)
python -m http.server 8000        # puis http://localhost:8000

# Régénérer les données (nécessite une install Minecraft 1.20.4 locale)
python extract.py
```

## VII. Maintenance documentaire

**Règle d'or** : le diff du code et le diff de la doc correspondante vont dans **le même commit**.

| Modification | Fichier à mettre à jour |
|---|---|
| Nouveau jeu dans le registre `GAMES` | Section « Registre de jeux » de `docs/architecture.md` |
| Changement de la machine à états / sync multi | Sections « Cycle d'un tour multi » / « Machine à états » de `docs/architecture.md` |
| Nouveau chemin Firebase écrit par un client | Règles Realtime DB (console) + section « Sécurité » de `docs/architecture.md` |
| Changement de schéma d'une entité | `extract.py` + section « Modèle de données » de `docs/architecture.md` |
| Nouvel anti-pattern découvert | Section « Anti-patterns » de `docs/architecture.md` |

## VIII. Contexte de Session

- **Dernier focus** : —
- **Focus immédiat** : —
