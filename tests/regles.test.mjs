/**
 * Teste les règles Realtime Database (database.rules.json) sur l'émulateur Firebase.
 *
 * Rejoue, par l'API REST de l'émulateur, chaque écriture que fait script.js (création
 * de salon, arrivée d'un joueur, tirage, proposition, verdict, résolution, remise à
 * zéro, départ), puis les écritures qu'un joueur malveillant tenterait : se donner des
 * points, voler l'hôte, supprimer le salon, injecter du HTML dans un score, faire
 * charger un son hors du site.
 *
 * Choix non évidents :
 * - Aucune dépendance npm (fetch natif de Node 18+) : le dépôt reste zéro-build.
 * - L'identité est un jeton non signé (alg « none ») : l'émulateur l'accepte tel quel,
 *   ce qui permet de jouer plusieurs utilisateurs sans émulateur d'authentification.
 * - Les tests s'enchaînent comme une vraie partie : l'ordre compte, chaque étape
 *   part de l'état laissé par la précédente.
 *
 * Invariant : toute écriture ajoutée à script.js reçoit ici un cas « accepté », et
 * son détournement un cas « refusé ».
 *
 * Usage (Java requis par l'émulateur) :
 *   npx firebase-tools emulators:exec --only database "node tests/regles.test.mjs"
 */

const PROJET = "roulette-multijeux";
const NS = `${PROJET}-default-rtdb`;
const BASE = `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST || "127.0.0.1:9000"}`;
const SALON = "ABCDE";
const HORLOGE = { ".sv": "timestamp" };

let reussis = 0;
const echecs = [];

function jeton(uid) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const t = Math.floor(Date.now() / 1000);
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({
    iss: `https://securetoken.google.com/${PROJET}`,
    aud: PROJET,
    iat: t,
    exp: t + 3600,
    auth_time: t,
    sub: uid,
    user_id: uid,
    firebase: { sign_in_provider: "anonymous", identities: {} },
  })}.`;
}

async function requete(qui, methode, chemin, corps) {
  const auth = qui ? `&auth=${jeton(qui)}` : "";
  const entetes = qui === "admin" ? { Authorization: "Bearer owner" } : {};
  const url = `${BASE}/${chemin}.json?ns=${NS}${qui === "admin" ? "" : auth}`;
  const rep = await fetch(url, {
    method: methode,
    headers: entetes,
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  return { ok: rep.ok, statut: rep.status, corps: await rep.text() };
}

async function attendu(accepte, description, qui, methode, chemin, corps) {
  const r = await requete(qui, methode, chemin, corps);
  if (r.ok === accepte) {
    reussis += 1;
    return;
  }
  echecs.push(`${accepte ? "devait passer" : "devait être refusé"} : ${description} (${r.statut} ${r.corps.slice(0, 120)})`);
}

const accepte = (...a) => attendu(true, ...a);
const refuse = (...a) => attendu(false, ...a);
const salon = (suite = "") => `rooms/${SALON}${suite}`;

function nouveauSalon(hote, code = SALON) {
  return [`rooms/${code}`, {
    host: hote,
    createdAt: HORLOGE,
    state: { phase: "idle", round: 0 },
    players: { [hote]: { name: "Alice", points: 0, joined: HORLOGE } },
  }];
}

async function creationEtLecture() {
  await requete("admin", "DELETE", "");
  await refuse("un visiteur non connecté crée un salon", null, "PUT", ...nouveauSalon("alice"));
  await refuse("eve crée un salon au nom d'alice", "eve", "PUT", ...nouveauSalon("alice"));
  await refuse("code de salon hors alphabet (I)", "alice", "PUT", ...nouveauSalon("alice", "ABCDI"));
  await refuse("code de salon trop court", "alice", "PUT", ...nouveauSalon("alice", "ABCD"));
  await refuse("salon sans état", "alice", "PUT", salon(), { host: "alice", createdAt: HORLOGE });
  await refuse("salon avec une clé inconnue", "alice", "PUT", salon(), { ...nouveauSalon("alice")[1], pub: "x" });
  await accepte("alice crée son salon", "alice", "PUT", ...nouveauSalon("alice"));
  await refuse("eve écrase le salon d'alice", "eve", "PUT", ...nouveauSalon("eve"));
  await refuse("un visiteur non connecté lit le salon", null, "GET", salon());
  await accepte("bob lit le salon pour le rejoindre", "bob", "GET", salon());
  await refuse("eve liste tous les salons", "eve", "GET", "rooms");
  await refuse("eve lit la racine", "eve", "GET", "");
  await refuse("eve écrit hors des salons", "eve", "PUT", "pub", "x");
}

async function arriveeDesJoueurs() {
  await accepte("bob rejoint", "bob", "PUT", salon("/players/bob"), { name: "Bob", points: 0, joined: HORLOGE });
  await accepte("pseudo accentué de 20 caractères", "carl", "PUT", salon("/players/carl"), { name: "é".repeat(20), points: 0, joined: HORLOGE });
  await accepte("pseudo en émojis (20 unités UTF-16)", "dana", "PUT", salon("/players/dana"), { name: "😀".repeat(10), points: 0, joined: HORLOGE });
  await refuse("pseudo de 21 caractères", "eve", "PUT", salon("/players/eve"), { name: "x".repeat(21), points: 0 });
  await refuse("pseudo vide", "eve", "PUT", salon("/players/eve"), { name: "", points: 0 });
  await refuse("eve arrive avec 5 points", "eve", "PUT", salon("/players/eve"), { name: "Eve", points: 5 });
  await refuse("eve arrive avec un score piégé (XSS)", "eve", "PUT", salon("/players/eve"), { name: "Eve", points: "<img src=x onerror=alert(1)>" });
  await refuse("eve arrive avec un champ inconnu", "eve", "PUT", salon("/players/eve"), { name: "Eve", points: 0, admin: true });
  await refuse("eve inscrit bob à sa place", "eve", "PUT", salon("/players/bob"), { name: "Eve", points: 0 });
  await refuse("eve s'inscrit dans un salon inexistant", "eve", "PUT", "rooms/ZZZZZ/players/eve", { name: "Eve", points: 0 });
  await accepte("eve rejoint normalement", "eve", "PUT", salon("/players/eve"), { name: "Eve", points: 0, joined: HORLOGE });
  await refuse("eve se donne des points", "eve", "PUT", salon("/players/eve/points"), 99);
  await refuse("eve supprime bob", "eve", "DELETE", salon("/players/bob"));
}

async function detournementsDeLHote() {
  await refuse("eve se déclare hôte", "eve", "PUT", salon("/host"), "eve");
  await refuse("eve supprime le salon", "eve", "DELETE", salon());
  await refuse("eve change la phase", "eve", "PATCH", salon("/state"), { phase: "resolved" });
  await refuse("eve remet les scores à zéro", "eve", "PATCH", salon(), { state: { phase: "idle", round: 1 }, guesses: null, won: null });
  await refuse("eve marque une entité trouvée", "eve", "PUT", salon("/won/Creeper"), true);
  await refuse("alice cède l'hôte à bob", "alice", "PUT", salon("/host"), "bob");
  await refuse("alice réécrit la date de création", "alice", "PUT", salon("/createdAt"), 1);
}

async function tirageEtPropositions() {
  await refuse("bob propose avant le tirage", "bob", "POST", salon("/guesses"), { playerId: "bob", text: "creeper", timestamp: HORLOGE });
  const tirage = { phase: "spinning", finalRotation: 2345.5, soundUrl: "assets/sounds/creeper_say1.ogg", round: Date.now() };
  await refuse("son hors du site", "alice", "PATCH", salon("/state"), { ...tirage, soundUrl: "https://exemple.invalid/x.ogg" });
  await refuse("son qui remonte l'arborescence", "alice", "PATCH", salon("/state"), { ...tirage, soundUrl: "assets/../../x.ogg" });
  await refuse("phase inconnue", "alice", "PATCH", salon("/state"), { ...tirage, phase: "pause" });
  await refuse("champ d'état inconnu", "alice", "PATCH", salon("/state"), { ...tirage, secret: "Creeper" });
  await accepte("tirage d'une entité sans son", "alice", "PATCH", salon("/state"), { ...tirage, soundUrl: "" });
  await accepte("alice lance la roue", "alice", "PATCH", salon("/state"), tirage);
  await refuse("bob propose pendant l'animation", "bob", "POST", salon("/guesses"), { playerId: "bob", text: "creeper", timestamp: HORLOGE });
  await accepte("alice ouvre les propositions", "alice", "PATCH", salon("/state"), { phase: "guessing" });
  await accepte("bob propose", "bob", "PUT", salon("/guesses/g1"), { playerId: "bob", text: "zombie", timestamp: HORLOGE, verdict: null });
  await refuse("bob propose au nom d'eve", "bob", "PUT", salon("/guesses/g2"), { playerId: "eve", text: "creeper" });
  await refuse("bob s'attribue le verdict", "bob", "PUT", salon("/guesses/g3"), { playerId: "bob", text: "creeper", verdict: "correct" });
  await refuse("bob valide sa propre proposition", "bob", "PATCH", salon("/guesses/g1"), { verdict: "correct" });
  await refuse("proposition de 41 caractères", "bob", "PUT", salon("/guesses/g4"), { playerId: "bob", text: "x".repeat(41) });
  await refuse("frank, hors du salon, propose", "frank", "PUT", salon("/guesses/g5"), { playerId: "frank", text: "creeper" });
  await refuse("verdict inconnu", "alice", "PATCH", salon("/guesses/g1"), { verdict: "peut-etre" });
  await accepte("alice refuse la proposition", "alice", "PATCH", salon("/guesses/g1"), { verdict: "wrong" });
  await accepte("bob propose à nouveau", "bob", "PUT", salon("/guesses/g6"), { playerId: "bob", text: "creeper", timestamp: HORLOGE });
  await accepte("alice valide", "alice", "PATCH", salon("/guesses/g6"), { verdict: "correct" });
}

async function resolutionEtRemiseAZero() {
  await refuse("score piégé écrit par l'hôte (XSS)", "alice", "PUT", salon("/players/bob/points"), "<img>");
  await refuse("score négatif", "alice", "PUT", salon("/players/bob/points"), -1);
  await accepte("alice crédite bob", "alice", "PUT", salon("/players/bob/points"), 1);
  await refuse("entité trouvée non booléenne", "alice", "PUT", salon("/won/Creeper"), "oui");
  await accepte("alice marque l'entité trouvée", "alice", "PUT", salon("/won/Creeper"), true);
  await accepte("alice publie le résultat", "alice", "PATCH", salon("/state"), { phase: "resolved", winnerId: "bob", winnerName: "Bob", entityName: "Creeper" });
  await refuse("bob, crédité, renomme son pseudo", "bob", "PATCH", salon("/players/bob"), { name: "Bobby" });
  await accepte("alice remet tout à zéro", "alice", "PATCH", salon(), {
    players: {
      alice: { name: "Alice", points: 0, joined: 1 },
      bob: { name: "Bob", points: 0, joined: 1 },
    },
    state: { phase: "idle", round: Date.now() },
    guesses: null,
    won: null,
  });
}

async function departs() {
  await accepte("bob quitte le salon", "bob", "DELETE", salon("/players/bob"));
  await accepte("bob revient", "bob", "PUT", salon("/players/bob"), { name: "Bob", points: 0, joined: HORLOGE });
  await accepte("alice ferme le salon", "alice", "DELETE", salon());
  await accepte("le départ de bob après fermeture ne bloque rien", "bob", "DELETE", salon("/players/bob"));
  await refuse("bob recrée le salon en joueur seul", "bob", "PUT", salon("/players/bob"), { name: "Bob", points: 0 });
  await accepte("eve reprend le code libéré", "eve", "PUT", ...nouveauSalon("eve"));
}

await creationEtLecture();
await arriveeDesJoueurs();
await detournementsDeLHote();
await tirageEtPropositions();
await resolutionEtRemiseAZero();
await departs();

console.log(`${reussis}/${reussis + echecs.length} cas conformes`);
for (const e of echecs) console.log(`  ÉCHEC ${e}`);
process.exit(echecs.length ? 1 : 0);
