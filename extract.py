"""
Extracts Minecraft entity assets from a local 1.20.4 install + community renders.
- Sounds (.ogg) from assets/objects via assets/indexes/12.json
- Brute textures (.png) from versions/1.20.4/1.20.4.jar
- Pretty renders (.png) from minecraft.wiki via MediaWiki API (fallback: brute texture)
Updates entities.json with all paths.
"""
import json
import re
import shutil
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

MC_ROOT = Path.home() / "AppData/Roaming/.minecraft"
ASSET_INDEX = MC_ROOT / "assets/indexes/12.json"
OBJECTS_DIR = MC_ROOT / "assets/objects"
JAR_PATH = MC_ROOT / "versions/1.20.4/1.20.4.jar"

PROJECT = Path(__file__).parent
SOUNDS_OUT = PROJECT / "assets/sounds"
TEXTURES_OUT = PROJECT / "assets/textures"
RENDERS_OUT = PROJECT / "assets/renders"
JSON_PATH = PROJECT / "entities.json"

WIKI_API = "https://minecraft.wiki/api.php"
UA = "MinecraftRoulettePersonalProject/1.0 (local side project)"

# name: (sound search keywords, texture path candidates in JAR, wiki page title)
ENTITIES = {
    "Creeper":         (["mob/creeper/say"],
                        ["assets/minecraft/textures/entity/creeper/creeper.png"],
                        "Creeper"),
    "Zombie":          (["mob/zombie/say"],
                        ["assets/minecraft/textures/entity/zombie/zombie.png"],
                        "Zombie"),
    "Skeleton":        (["mob/skeleton/say"],
                        ["assets/minecraft/textures/entity/skeleton/skeleton.png"],
                        "Skeleton"),
    "Wither Skeleton": (["mob/wither_skeleton/hurt", "mob/wither_skeleton/death"],
                        ["assets/minecraft/textures/entity/skeleton/wither_skeleton.png"],
                        "Wither Skeleton"),
    "Spider":          (["mob/spider/say"],
                        ["assets/minecraft/textures/entity/spider/spider.png"],
                        "Spider"),
    "Enderman":        (["mob/endermen/idle", "entity/enderman/idle"],
                        ["assets/minecraft/textures/entity/enderman/enderman.png"],
                        "Enderman"),
    "Witch":           (["entity/witch/celebrate", "mob/witch/idle", "entity/witch/ambient"],
                        ["assets/minecraft/textures/entity/witch.png",
                         "assets/minecraft/textures/entity/witch/witch.png"],
                        "Witch"),
    "Blaze":           (["mob/blaze/breathe"],
                        ["assets/minecraft/textures/entity/blaze.png"],
                        "Blaze"),
    "Ghast":           (["mob/ghast/moan", "mob/ghast/scream"],
                        ["assets/minecraft/textures/entity/ghast/ghast.png"],
                        "Ghast"),
    "Slime":           (["mob/slime/big"],
                        ["assets/minecraft/textures/entity/slime/slime.png"],
                        "Slime"),
    "Magma Cube":      (["mob/magmacube/big", "entity/magma_cube/big"],
                        ["assets/minecraft/textures/entity/slime/magmacube.png"],
                        "Magma Cube"),
    "Wither":          (["mob/wither/idle", "entity/wither/ambient"],
                        ["assets/minecraft/textures/entity/wither/wither.png"],
                        "Wither"),
    "Piglin":          (["mob/piglin/admire", "mob/piglin/angry"],
                        ["assets/minecraft/textures/entity/piglin/piglin.png"],
                        "Piglin"),
    "Phantom":         (["mob/phantom/bite", "mob/phantom/death"],
                        ["assets/minecraft/textures/entity/phantom.png",
                         "assets/minecraft/textures/entity/phantom/phantom.png"],
                        "Phantom"),
    "Shulker":         (["entity/shulker/ambient"],
                        ["assets/minecraft/textures/entity/shulker/shulker.png"],
                        "Shulker"),
    "Pillager":        (["mob/pillager/celebrate", "mob/pillager/death"],
                        ["assets/minecraft/textures/entity/illager/pillager.png"],
                        "Pillager"),
    "Evoker":          (["mob/evoker/", "mob/evocation_illager/", "mob/illager/"],
                        ["assets/minecraft/textures/entity/illager/evoker.png"],
                        "Evoker"),
    "Ravager":         (["mob/ravager/bite", "mob/ravager/celebrate"],
                        ["assets/minecraft/textures/entity/illager/ravager.png",
                         "assets/minecraft/textures/entity/ravager/ravager.png"],
                        "Ravager"),
    "Guardian":        (["entity/guardian/ambient", "mob/guardian/"],
                        ["assets/minecraft/textures/entity/guardian.png",
                         "assets/minecraft/textures/entity/guardian/guardian.png"],
                        "Guardian"),
    "Warden":          (["mob/warden/agitated", "mob/warden/", "entity/warden/"],
                        ["assets/minecraft/textures/entity/warden/warden.png"],
                        "Warden"),
    "Drowned":         (["entity/drowned/ambient", "mob/zombie/say"],
                        ["assets/minecraft/textures/entity/zombie/drowned.png"],
                        "Drowned"),
    "Cow":             (["mob/cow/say"],
                        ["assets/minecraft/textures/entity/cow/cow.png"],
                        "Cow"),
    "Pig":             (["mob/pig/say"],
                        ["assets/minecraft/textures/entity/pig/pig.png"],
                        "Pig"),
    "Chicken":         (["mob/chicken/say"],
                        ["assets/minecraft/textures/entity/chicken.png"],
                        "Chicken"),
    "Sheep":           (["mob/sheep/say"],
                        ["assets/minecraft/textures/entity/sheep/sheep.png"],
                        "Sheep"),
    "Villager":        (["mob/villager/idle"],
                        ["assets/minecraft/textures/entity/villager/villager.png"],
                        "Villager"),
    "Wolf":            (["mob/wolf/bark"],
                        ["assets/minecraft/textures/entity/wolf/wolf.png"],
                        "Wolf"),
    "Cat":             (["mob/cat/purr", "mob/cat/beg", "mob/cat/meow"],
                        ["assets/minecraft/textures/entity/cat/all_black.png",
                         "assets/minecraft/textures/entity/cat/ocelot.png"],
                        "Cat"),
    "Horse":           (["mob/horse/idle"],
                        ["assets/minecraft/textures/entity/horse/horse_brown.png",
                         "assets/minecraft/textures/entity/horse/horse_white.png"],
                        "Horse"),
    "Bee":             (["mob/bee/aggressive", "mob/bee/loop"],
                        ["assets/minecraft/textures/entity/bee/bee.png"],
                        "Bee"),
    "Fox":             (["mob/fox/aggro", "mob/fox/ambient"],
                        ["assets/minecraft/textures/entity/fox/fox.png"],
                        "Fox"),
    "Axolotl":         (["mob/axolotl/idle_air", "mob/axolotl/idle_water", "mob/axolotl/idle"],
                        ["assets/minecraft/textures/entity/axolotl/axolotl_blue.png",
                         "assets/minecraft/textures/entity/axolotl/axolotl_lucy.png"],
                        "Axolotl"),
    "Goat":            (["mob/goat/eat", "mob/goat/death"],
                        ["assets/minecraft/textures/entity/goat/goat.png"],
                        "Goat"),
    "Allay":           (["mob/allay/idle_with_item", "mob/allay/idle_without_item"],
                        ["assets/minecraft/textures/entity/allay/allay.png"],
                        "Allay"),
    "Ender Dragon":    (["mob/enderdragon/growl"],
                        ["assets/minecraft/textures/entity/enderdragon/dragon.png"],
                        "Ender Dragon"),
    "Cave Spider":     (["mob/spider/say"],
                        ["assets/minecraft/textures/entity/spider/cave_spider.png"],
                        "Cave Spider"),
    "Vindicator":      (["mob/vindicator/", "entity/vindicator/", "mob/zombie_villager/say"],
                        ["assets/minecraft/textures/entity/illager/vindicator.png"],
                        "Vindicator"),
    "Vex":             (["mob/vex/charge", "mob/vex/", "entity/vex/"],
                        ["assets/minecraft/textures/entity/illager/vex.png"],
                        "Vex"),
    "Silverfish":      (["mob/silverfish/say"],
                        ["assets/minecraft/textures/entity/silverfish.png",
                         "assets/minecraft/textures/entity/silverfish/silverfish.png"],
                        "Silverfish"),
    "Endermite":       (["mob/silverfish/say", "mob/endermite/"],
                        ["assets/minecraft/textures/entity/endermite.png",
                         "assets/minecraft/textures/entity/endermite/endermite.png"],
                        "Endermite"),
    "Elder Guardian":  (["mob/guardian/elder", "mob/elder_guardian/"],
                        ["assets/minecraft/textures/entity/guardian_elder.png",
                         "assets/minecraft/textures/entity/guardian/elder.png"],
                        "Elder Guardian"),
    "Hoglin":          (["mob/hoglin/angry", "mob/hoglin/", "entity/hoglin/"],
                        ["assets/minecraft/textures/entity/hoglin/hoglin.png"],
                        "Hoglin"),
    "Zoglin":          (["mob/zoglin/angry", "mob/zoglin/", "entity/zoglin/"],
                        ["assets/minecraft/textures/entity/hoglin/zoglin.png"],
                        "Zoglin"),
    "Piglin Brute":    (["mob/piglin_brute/", "entity/piglin_brute/"],
                        ["assets/minecraft/textures/entity/piglin/piglin_brute.png"],
                        "Piglin Brute"),
    "Zombified Piglin":(["mob/zombie_pigman/say", "mob/zombified_piglin/", "entity/zombified_piglin/"],
                        ["assets/minecraft/textures/entity/piglin/zombified_piglin.png",
                         "assets/minecraft/textures/entity/pigzombie.png"],
                        "Zombified Piglin"),
    "Husk":            (["mob/husk/", "entity/husk/", "mob/zombie/say"],
                        ["assets/minecraft/textures/entity/zombie/husk.png"],
                        "Husk"),
    "Stray":           (["mob/stray/", "entity/stray/", "mob/skeleton/say"],
                        ["assets/minecraft/textures/entity/skeleton/stray.png"],
                        "Stray"),
    "Zombie Villager": (["mob/zombievillager/", "mob/zombie_villager/", "mob/zombie/say"],
                        ["assets/minecraft/textures/entity/zombie_villager/zombie_villager.png",
                         "assets/minecraft/textures/entity/zombie/zombie_villager.png"],
                        "Zombie Villager"),
    "Iron Golem":      (["mob/irongolem/damage", "mob/irongolem/", "mob/villager_golem/"],
                        ["assets/minecraft/textures/entity/iron_golem/iron_golem.png",
                         "assets/minecraft/textures/entity/iron_golem.png"],
                        "Iron Golem"),
    "Snow Golem":      (["entity/snowman/death", "entity/snowman/", "mob/snowgolem/"],
                        ["assets/minecraft/textures/entity/snow_golem.png",
                         "assets/minecraft/textures/entity/snowman.png"],
                        "Snow Golem"),
    "Llama":           (["mob/llama/ambient", "mob/llama/idle", "entity/llama/ambient"],
                        ["assets/minecraft/textures/entity/llama/creamy.png",
                         "assets/minecraft/textures/entity/llama/brown.png"],
                        "Llama"),
    "Panda":           (["mob/panda/aggressive", "mob/panda/", "entity/panda/"],
                        ["assets/minecraft/textures/entity/panda/panda.png"],
                        "Panda"),
    "Polar Bear":      (["mob/polar_bear/ambient", "entity/polar_bear/ambient", "mob/polarbear/"],
                        ["assets/minecraft/textures/entity/bear/polarbear.png",
                         "assets/minecraft/textures/entity/polar_bear/polar_bear.png"],
                        "Polar Bear"),
    "Dolphin":         (["mob/dolphin/attack", "mob/dolphin/", "entity/dolphin/"],
                        ["assets/minecraft/textures/entity/dolphin.png",
                         "assets/minecraft/textures/entity/dolphin/dolphin.png"],
                        "Dolphin"),
    "Donkey":          (["mob/horse/donkey/angry", "mob/horse/donkey/death"],
                        ["assets/minecraft/textures/entity/horse/donkey.png"],
                        "Donkey"),
    "Mule":            (["mob/horse/donkey/angry", "mob/horse/idle"],
                        ["assets/minecraft/textures/entity/horse/mule.png"],
                        "Mule"),
    "Mooshroom":       (["mob/cow/say"],
                        ["assets/minecraft/textures/entity/cow/red_mooshroom.png",
                         "assets/minecraft/textures/entity/cow/mooshroom.png"],
                        "Mooshroom"),
    "Squid":           (["mob/squid/", "entity/squid/ambient"],
                        ["assets/minecraft/textures/entity/squid/squid.png",
                         "assets/minecraft/textures/entity/squid.png"],
                        "Squid"),
    "Glow Squid":      (["entity/glow_squid/ambient", "mob/glow_squid/"],
                        ["assets/minecraft/textures/entity/squid/glow_squid.png"],
                        "Glow Squid"),
    "Bat":             (["mob/bat/idle", "entity/bat/ambient"],
                        ["assets/minecraft/textures/entity/bat.png",
                         "assets/minecraft/textures/entity/bat/bat.png"],
                        "Bat"),
    "Rabbit":          (["mob/rabbit/idle", "entity/rabbit/ambient"],
                        ["assets/minecraft/textures/entity/rabbit/brown.png",
                         "assets/minecraft/textures/entity/rabbit/white.png"],
                        "Rabbit"),
    "Ocelot":          (["mob/cat/idle", "mob/cat/purr", "entity/ocelot/ambient"],
                        ["assets/minecraft/textures/entity/cat/ocelot.png"],
                        "Ocelot"),
    "Parrot":          (["mob/parrot/idle", "entity/parrot/ambient"],
                        ["assets/minecraft/textures/entity/parrot/parrot_blue.png",
                         "assets/minecraft/textures/entity/parrot/parrot_red_blue.png"],
                        "Parrot"),
    "Turtle":          (["mob/turtle/armor", "mob/turtle/", "entity/turtle/"],
                        ["assets/minecraft/textures/entity/turtle/big_sea_turtle.png",
                         "assets/minecraft/textures/entity/turtle/sea_turtle.png"],
                        "Turtle"),
    "Strider":         (["mob/strider/death", "mob/strider/", "entity/strider/"],
                        ["assets/minecraft/textures/entity/strider/strider.png"],
                        "Strider"),
    "Frog":            (["mob/frog/eat", "mob/frog/death", "mob/frog/"],
                        ["assets/minecraft/textures/entity/frog/temperate_frog.png",
                         "assets/minecraft/textures/entity/frog/cold_frog.png"],
                        "Frog"),
    "Tadpole":         (["entity/tadpole/", "mob/tadpole/"],
                        ["assets/minecraft/textures/entity/tadpole/tadpole.png"],
                        "Tadpole"),
    "Sniffer":         (["entity/sniffer/idle", "entity/sniffer/sniffing", "mob/sniffer/"],
                        ["assets/minecraft/textures/entity/sniffer/sniffer.png"],
                        "Sniffer"),
    "Camel":           (["entity/camel/ambient", "mob/camel/ambient"],
                        ["assets/minecraft/textures/entity/camel/camel.png"],
                        "Camel"),
    "Wandering Trader":(["mob/wanderingtrader/", "mob/wandering_trader/", "entity/wandering_trader/"],
                        ["assets/minecraft/textures/entity/wandering_trader.png",
                         "assets/minecraft/textures/entity/wandering_trader/wandering_trader.png"],
                        "Wandering Trader"),
}

TYPES = {
    # Hostile (attaque par défaut)
    **{name: "hostile" for name in [
        "Creeper", "Zombie", "Skeleton", "Wither Skeleton", "Spider", "Cave Spider",
        "Witch", "Blaze", "Ghast", "Slime", "Magma Cube", "Phantom", "Shulker",
        "Pillager", "Vindicator", "Evoker", "Ravager", "Vex", "Silverfish", "Endermite",
        "Elder Guardian", "Warden", "Drowned", "Husk", "Stray", "Zombie Villager",
        "Hoglin", "Zoglin", "Piglin Brute", "Guardian",
    ]},
    # Neutre (attaque si provoqué)
    **{name: "neutral" for name in [
        "Enderman", "Wolf", "Llama", "Bee", "Polar Bear", "Panda", "Goat",
        "Iron Golem", "Dolphin", "Piglin", "Zombified Piglin",
    ]},
    # Passif (n'attaque jamais)
    **{name: "passive" for name in [
        "Cow", "Pig", "Chicken", "Sheep", "Villager", "Cat", "Horse", "Fox",
        "Axolotl", "Allay", "Mooshroom", "Squid", "Glow Squid", "Bat", "Rabbit",
        "Ocelot", "Parrot", "Turtle", "Strider", "Frog", "Tadpole", "Sniffer",
        "Camel", "Wandering Trader", "Donkey", "Mule", "Snow Golem",
    ]},
    # Boss
    **{name: "boss" for name in ["Ender Dragon", "Wither"]},
}

COLORS = {
    "Creeper": "#3aa856", "Zombie": "#4a7a3a", "Skeleton": "#c2c2c2", "Wither Skeleton": "#3a3a3a",
    "Spider": "#5a2a2a", "Enderman": "#1a1a2e", "Witch": "#6a3a8a", "Blaze": "#ffa500",
    "Ghast": "#f0f0f0", "Slime": "#7acb5b", "Magma Cube": "#e23a1a", "Wither": "#2a2a2a",
    "Piglin": "#d9a26a", "Phantom": "#3a3a5e", "Shulker": "#7e6680", "Pillager": "#5a6a6a",
    "Evoker": "#a0a0a0", "Ravager": "#6a5a4a", "Guardian": "#4a8a6a", "Warden": "#1a3a4a",
    "Drowned": "#2a5a5a", "Cow": "#8b5a3c", "Pig": "#f4a8a8", "Chicken": "#fff5b8",
    "Sheep": "#e8e8e8", "Villager": "#a07050", "Wolf": "#909090", "Cat": "#3a3a3a",
    "Horse": "#a86a3a", "Bee": "#f4c430", "Fox": "#e88a3a", "Axolotl": "#f0a8c8",
    "Goat": "#c0a890", "Allay": "#5acbe8", "Ender Dragon": "#3a1a4a",
    "Cave Spider": "#1a4a5a", "Vindicator": "#6a8a96", "Vex": "#4a4a5a", "Silverfish": "#4a4a4a",
    "Endermite": "#2a1a3a", "Elder Guardian": "#7a8a5a", "Hoglin": "#a04a5a", "Zoglin": "#6a4a5a",
    "Piglin Brute": "#c08a5a", "Zombified Piglin": "#6a8a5a", "Husk": "#c8b078", "Stray": "#a8c8d8",
    "Zombie Villager": "#5a7a4a", "Iron Golem": "#a8a098", "Snow Golem": "#f0f5ff",
    "Llama": "#d8b888", "Panda": "#e8e8e8", "Polar Bear": "#f0e8d8", "Dolphin": "#7a98b8",
    "Donkey": "#7a5a3a", "Mule": "#5a3a2a", "Mooshroom": "#a02a2a", "Squid": "#3a3a5a",
    "Glow Squid": "#3acba8", "Bat": "#5a4a3a", "Rabbit": "#a87858", "Ocelot": "#e8a868",
    "Parrot": "#3a78d8", "Turtle": "#5a9a6a", "Strider": "#a83a4a", "Frog": "#a8c83a",
    "Tadpole": "#3a2a1a", "Sniffer": "#5a7a5a", "Camel": "#d8b878", "Wandering Trader": "#3a5a98",
}


def load_asset_index():
    with open(ASSET_INDEX, encoding="utf-8") as f:
        return json.load(f)["objects"]


def find_all_sounds(index, keywords):
    """Return list of (asset_path, hash, action, number) for every matching sound."""
    results = []
    seen = set()
    for kw in keywords:
        for asset_path, info in index.items():
            if asset_path in seen:
                continue
            if asset_path.startswith("minecraft/sounds/") and kw in asset_path and asset_path.endswith(".ogg"):
                basename = asset_path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
                m = re.match(r"^(.+?)(\d+)$", basename)
                if m:
                    action, n = m.group(1).rstrip("_"), int(m.group(2))
                else:
                    action, n = basename, 0
                action = action.replace("_", " ").strip()
                results.append((asset_path, info["hash"], action, n, basename))
                seen.add(asset_path)
    # Sort by action then number for stable ordering
    results.sort(key=lambda r: (r[2], r[3]))
    return results


def extract_sound_file(asset_hash, dest):
    src = OBJECTS_DIR / asset_hash[:2] / asset_hash
    if not src.exists():
        return False
    shutil.copy(src, dest)
    return True


def extract_texture(jar, candidates, dest):
    names = set(jar.namelist())
    for path in candidates:
        if path in names:
            with jar.open(path) as src, open(dest, "wb") as dst:
                dst.write(src.read())
            return True
    return False


def http_get(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fetch_wiki_render(page_title, dest):
    """Query MediaWiki for the page's main image and download it."""
    params = {
        "action": "query",
        "prop": "pageimages",
        "piprop": "original",
        "format": "json",
        "titles": page_title,
        "redirects": 1,
    }
    api_url = f"{WIKI_API}?{urllib.parse.urlencode(params)}"
    try:
        data = json.loads(http_get(api_url).decode("utf-8"))
    except Exception as e:
        return False, f"api error: {e}"

    pages = data.get("query", {}).get("pages", {})
    if not pages:
        return False, "no pages in response"
    page = next(iter(pages.values()))
    if "missing" in page:
        return False, f"page '{page_title}' not found"
    original = page.get("original")
    if not original or not original.get("source"):
        return False, "no main image"

    img_url = original["source"]
    try:
        img_bytes = http_get(img_url, timeout=30)
        with open(dest, "wb") as f:
            f.write(img_bytes)
        return True, img_url
    except Exception as e:
        return False, f"download error: {e}"


def main():
    SOUNDS_OUT.mkdir(parents=True, exist_ok=True)
    TEXTURES_OUT.mkdir(parents=True, exist_ok=True)
    RENDERS_OUT.mkdir(parents=True, exist_ok=True)

    if not ASSET_INDEX.exists() or not JAR_PATH.exists():
        print(f"Missing local assets — abandon")
        return

    index = load_asset_index()
    print(f"Asset index loaded: {len(index)} entries")
    print(f"JAR: {JAR_PATH.name}\n")

    new_entities = []
    with zipfile.ZipFile(JAR_PATH) as jar:
        for name, (sound_kw, tex_paths, wiki_title) in ENTITIES.items():
            slug = name.lower().replace(" ", "_")
            texture_dest = TEXTURES_OUT / f"{slug}.png"
            render_dest = RENDERS_OUT / f"{slug}.png"

            # Sounds — extract every matching variant
            sounds = []
            for asset_path, h, action, n, basename in find_all_sounds(index, sound_kw):
                dest = SOUNDS_OUT / f"{slug}_{basename}.ogg"
                if extract_sound_file(h, dest):
                    label = f"{action} {n}" if n > 0 else action
                    sounds.append({
                        "label": label,
                        "action": action,
                        "n": n,
                        "path": f"assets/sounds/{slug}_{basename}.ogg",
                    })

            texture_ok = extract_texture(jar, tex_paths, texture_dest)

            render_ok = False
            render_err = ""
            if not render_dest.exists():
                render_ok, render_info = fetch_wiki_render(wiki_title, render_dest)
                if not render_ok:
                    render_err = render_info
            else:
                render_ok = True

            entry = {
                "name": name,
                "type": TYPES.get(name, "passive"),
                "sounds": sounds,
                "sound": sounds[0]["path"] if sounds else "",  # default for spin reveal
                "texture": f"assets/textures/{slug}.png" if texture_ok else "",
                "render": f"assets/renders/{slug}.png" if render_ok else "",
                "color": COLORS.get(name, "#888888"),
            }
            new_entities.append(entry)
            tags = []
            if sounds: tags.append(f"{len(sounds)} sons")
            if texture_ok: tags.append("texture")
            if render_ok: tags.append("render")
            status = " + ".join(tags) if tags else "RIEN"
            extra = f"  [wiki: {render_err}]" if render_err and not render_ok else ""
            print(f"  {name:18} {status}{extra}")

    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump({"entities": new_entities}, f, indent=2, ensure_ascii=False)

    print(f"\nentities.json mis a jour ({len(new_entities)} entites).")


if __name__ == "__main__":
    main()
