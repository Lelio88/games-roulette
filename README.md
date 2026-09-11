# La Roulette

Une roue de la fortune qui tire au sort une entité Minecraft, joue ses sons, puis révèle son image. Seul pour s'entraîner, ou à plusieurs pour deviner au son avant les autres.

## À quoi ça sert

Reconnaître une créature de Minecraft à l'oreille est plus dur qu'il n'y paraît : beaucoup partagent une famille de sons, et la roue ne laisse que quelques secondes.

- **En solo**, on tire, on écoute, on devine, et la progression se suit d'un tour à l'autre.
- **En multi**, l'hôte lance la roue et les autres joueurs buzzent ; le tableau des scores se met à jour en temps réel pour tout le monde.
- 70 entités filtrables, avec leurs sons et leurs rendus officiels.

## Démarrage rapide

```bash
git clone https://github.com/Lelio88/games-roulette.git
cd games-roulette
python -m http.server 8000
```

Puis ouvrir `http://localhost:8000`.

Le site n'a **aucune étape de construction** : pas de dépendance à installer, pas de compilation. Il faut en revanche le servir par HTTP — ouvrir le fichier directement ne marche pas, voir Dépannage.

## Utilisation

Le mode solo fonctionne tel quel, sans compte ni configuration.

Pour une partie à plusieurs, l'hôte crée un salon depuis l'écran d'accueil et transmet son code. Chaque joueur le saisit pour rejoindre. L'hôte seul lance la roue ; les autres buzzent pour proposer une réponse.

## Prérequis

- Un navigateur récent : modules JS natifs, rendu Canvas.
- **Python 3**, uniquement pour servir les fichiers en local.
- **Minecraft 1.20.4 installé**, uniquement pour régénérer les données avec `extract.py`. Inutile pour jouer.

## Configuration

Le mode solo ne demande rien. Le mode multi s'appuie sur Firebase Realtime Database et l'authentification anonyme. La configuration du projet est en clair dans `script.js`, ce qui est le modèle attendu d'une application web Firebase : la sécurité repose sur les règles de la base, pas sur la confidentialité de cette configuration.

Pour brancher votre propre projet Firebase, remplacez l'objet de configuration en tête de `script.js`, puis définissez les règles de la base. Chaque chemin `rooms/*` écrit par un client doit être couvert par une règle, sans quoi le multi est soit bloqué, soit ouvert à tous.

## Dépannage

| Symptôme | Cause | Correction |
|---|---|---|
| Page blanche, erreurs de module dans la console | Fichier ouvert en `file://` | Servir par HTTP : `python -m http.server 8000` |
| Le multi ne démarre pas, la console parle de permissions | Règles Realtime Database absentes ou trop strictes | Couvrir les chemins `rooms/*` dans la console Firebase |
