#!/bin/bash
#
# Organize the 3D Printing folder on Sapporo NAS
# Run with --dry-run (default) to preview, --execute to actually move files
#
# Structure:
#   3D Printing/
#   ├── Wargaming/
#   │   ├── _Unsorted/          (wargaming but unknown game/faction)
#   │   ├── 40k/                (existing organized folder)
#   │   │   ├── _Unsorted/      (40k but unknown faction)
#   │   │   ├── Orks/
#   │   │   │   ├── _Unsorted/  (Orks but unknown role)
#   │   │   │   ├── 01_hq/
#   │   │   │   └── ...
#   │   │   └── ...
#   │   ├── AoS/
#   │   ├── Horus Heresy/
#   │   └── Terrain/
#   ├── Household/
#   ├── Printer Accessories/
#   ├── Gridfinity/
#   ├── Gaming/
#   ├── _Archive/               (FOLDER1/2/3, sync, etc.)
#   └── _Unsorted/              (truly unknown)

set -euo pipefail

BASE="/Volumes/Shared/3D Printing"
MODE="${1:---dry-run}"
MANIFEST="/tmp/3dprint-organize-manifest.txt"

if [ ! -d "$BASE" ]; then
    echo "ERROR: $BASE not mounted"
    exit 1
fi

> "$MANIFEST"

# Track claimed items so the catch-all doesn't double-count
CLAIMED_FILE="/tmp/3dprint-claimed.txt"
> "$CLAIMED_FILE"

move() {
    local src="$1"
    local dst="$2"

    # Strip trailing slashes
    src="${src%/}"
    dst="${dst%/}"

    local name="$(basename "$src")"
    local target="$dst/$name"

    # Skip if source doesn't exist
    if [ ! -e "$src" ]; then return; fi
    # Skip if already in the right place
    if [ "$(dirname "$src")" = "$dst" ]; then return; fi

    # Mark as claimed
    echo "$src" >> "$CLAIMED_FILE"

    echo "$src -> $target" >> "$MANIFEST"

    if [ "$MODE" = "--execute" ]; then
        mkdir -p "$dst"
        if [ -e "$target" ]; then
            echo "  SKIP (exists): $name -> $dst"
        else
            mv "$src" "$target"
            echo "  MOVED: $name -> $dst"
        fi
    fi
}

echo "=== 3D Printing Organizer ==="
echo "Mode: $MODE"
echo ""

# ============================================================
# CATEGORY: Archive (FOLDER1/2/3 are zip duplicates of 40k/)
# ============================================================
echo "--- Archive (duplicate zip collections, sync folder) ---"
move "$BASE/FOLDER1" "$BASE/_Archive"
move "$BASE/FOLDER2" "$BASE/_Archive"
move "$BASE/FOLDER3" "$BASE/_Archive"
move "$BASE/sync" "$BASE/_Archive"
move "$BASE/40K%20scale%20complete" "$BASE/_Archive"
move "$BASE/Warhammer 40K Collection Vol.1" "$BASE/_Archive"
move "$BASE/Warhammer 40K Collection Vol.2" "$BASE/_Archive"
move "$BASE/more 40k" "$BASE/_Archive"
move "$BASE/The%20File.rar" "$BASE/_Archive"
move "$BASE/The File" "$BASE/_Archive"

# ============================================================
# CATEGORY: Gridfinity
# ============================================================
echo "--- Gridfinity ---"
for f in "$BASE/"*[Gg]ridfinity*; do
    [ -e "$f" ] && move "$f" "$BASE/Gridfinity"
done
for f in "$BASE/"*gridfinity*; do
    [ -e "$f" ] && move "$f" "$BASE/Gridfinity"
done
move "$BASE/3DS XL gridfinity bins.3mf" "$BASE/Gridfinity"
move "$BASE/DS Lite gridfinity Bins.3mf" "$BASE/Gridfinity"
move "$BASE/Original DS gridfinity bins.3mf" "$BASE/Gridfinity"
move "$BASE/Gameboy Advance SP Bin.3mf" "$BASE/Gridfinity"
move "$BASE/Gameboy Color Bin.3mf" "$BASE/Gridfinity"
move "$BASE/Gameboy DMG Bin.3mf" "$BASE/Gridfinity"
move "$BASE/8bitdo M30 Gridfinity Cutout v1.3mf" "$BASE/Gridfinity"
move "$BASE/8bitdo M30 Gridfinity Cutout v2.3mf" "$BASE/Gridfinity"
move "$BASE/8bitdo M30 Gridfinity Cutout v4.3mf" "$BASE/Gridfinity"
move "$BASE/8bitdo M30 Gridfinity Cutout v5.3mf" "$BASE/Gridfinity"

# ============================================================
# CATEGORY: Printer Accessories (Bambu, AMS, dry pods, etc.)
# ============================================================
echo "--- Printer Accessories ---"
for f in \
    "$BASE/AMS Stacking System.3mf" \
    "$BASE/AMS Stacking System(2).3mf" \
    "$BASE/AMS+Stacking+System.3mf" \
    "$BASE/AMS+Stacking+System+[feet+&+heads].3mf" \
    "$BASE/AMS+Stacking+System+[plate+holder].3mf" \
    "$BASE/Accessori scatole A1 Mini.3mf" \
    "$BASE/Bambu Tool Set Holder_2C_Logo_v1.5.3mf" \
    "$BASE/Bambucutters+vertical+stackable+10x.3mf" \
    "$BASE/BambuTools-All-Tools_LABELED.3mf" \
    "$BASE/Build_Plate_Storage_V2_FINAL_P1S_Rev30.3mf" \
    "$BASE/DRY_POD_FULL_KIT.3mf" \
    "$BASE/DRY_POD_FULL_KIT(2).3mf" \
    "$BASE/DryingCover_ABS.3mf" \
    "$BASE/DryPods_FullSet_wDessicant Trays.3mf" \
    "$BASE/HotendPlugRemover.3mf" \
    "$BASE/Leadscrew Cleaner.3mf" \
    "$BASE/New bambu spool_PLA.3mf" \
    "$BASE/New bambu spool.3mf" \
    "$BASE/New bambu spool(3).3mf" \
    "$BASE/TOOLBOX_X1C.3mf" \
    "$BASE/X1C Hotend Quick Swap Plug Grips.3mf" \
    "$BASE/4x+Hot+end+1.2.3mf" \
    "$BASE/7U MKII Original AMS (Grouped Objects).3mf" \
    "$BASE/desiccant-holder-for-spools.3mf" \
    "$BASE/desiccant-holder-for-spools(2).3mf" \
    "$BASE/desiccant-holder-for-spools(3).3mf" \
    "$BASE/desiccant-holder-for-spools(4).3mf" \
    "$BASE/desiccant-holder-for-spools(5).3mf" \
    "$BASE/desiccant-holder-for-spools(6).3mf" \
    "$BASE/desiccant-holder-for-spools(7).3mf" \
    "$BASE/filament clip 30p.3mf" \
    "$BASE/filament clip.3mf" \
    "$BASE/filament clip(2).3mf" \
    "$BASE/Modular Spray Booth.3mf" \
    "$BASE/Scraper V2 - Bambu_sliced.3mf" \
    "$BASE/Scraper.3mf" \
    "$BASE/Side cutters.3mf" \
    "$BASE/Static spool holder (wide 67mm, left).3mf" \
    "$BASE/Static spool holder (wide 67mm, middle).3mf" \
    "$BASE/Static spool holder (wide 67mm, right).3mf" \
    "$BASE/VORONOI CABLE SPOOL.3mf" \
    "$BASE/20mSpool.3mf" \
    "$BASE/Printprofile Bambu Lab A1 Toolbox Gridfinity StackablePlus.3mf" \
    "$BASE/Printprofile Bambu Lab A1 Toolbox Gridfinity StackablePlus(2).3mf" \
    "$BASE/Toolkit p1s p1p x1 bambulab low profile 2x1x05 gridfinity.3mf" \
    "$BASE/Paintbooth-  Connector Top front C2.3mf" \
    "$BASE/Paintbooth-  Connector Top front C2(2).3mf" \
    "$BASE/Rubber+feet+holder+stackable+lite.3mf" \
    "$BASE/Full_8color_2AMS.3mf" \
    "$BASE/Parametric Model Maker Advanced Settings-2.3mf" \
    "$BASE/Parametric Model Maker Advanced Settings.3mf" \
    "$BASE/Magnet Holder Tube+Cap XxX.3mf" \
    "$BASE/magnet-dispenser-v5.3mf" \
; do
    [ -e "$f" ] && move "$f" "$BASE/Printer Accessories"
done

# ============================================================
# CATEGORY: Household (practical prints)
# ============================================================
echo "--- Household ---"
for f in \
    "$BASE/airpods+stand-2.3mf" \
    "$BASE/airpods+stand.3mf" \
    "$BASE/airpods+stand(2).3mf" \
    "$BASE/Alex+Lade+4x5+3x5+2x4+2x3.3mf" \
    "$BASE/Alex+Lade+4x5+3x5+2x4+2x3(2).3mf" \
    "$BASE/Alex+Lade+4x5+3x5+2x4+2x3(3).3mf" \
    "$BASE/Apple_TV_4_Bracket_Mount.3mf" \
    "$BASE/baby_gate_knee_joint_-_v5.3mf" \
    "$BASE/Cabinet Magnet Holder - Double Tall.3mf" \
    "$BASE/Cabinet Magnet Holder - Short.3mf" \
    "$BASE/Cabinet Magnet Holder.3mf" \
    "$BASE/Coffee Milk Caraffe Holder v2.3mf" \
    "$BASE/Continuity Camera Mount.3mf" \
    "$BASE/CUP.3mf" \
    "$BASE/Dewalt Mount v0.3mf" \
    "$BASE/Dyson_mount_tolerancesfix.3mf" \
    "$BASE/FastTrack_Ryobi_One+_Hanger.3mf" \
    "$BASE/iPad Pro Stand 2.3mf" \
    "$BASE/iPad Pro Stand.3mf" \
    "$BASE/iPad Pro Stand.stl" \
    "$BASE/Keyholder with extension 2025.3mf" \
    "$BASE/Mac Mini Ring.3mf" \
    "$BASE/Mac Mini Ring.stl" \
    "$BASE/Mac Mini Stand.3mf" \
    "$BASE/Mac Mini Stand.stl" \
    "$BASE/Mio Shelf Parts.3mf" \
    "$BASE/Mio Shelf.3mf" \
    "$BASE/Moen Aerator Remover - PLA Profiles.3mf" \
    "$BASE/nose_glasses_holder_rk91.3mf" \
    "$BASE/OpenRack 1U – Base (19 inch).3mf" \
    "$BASE/Perlatorschlüssel.3mf" \
    "$BASE/Portable Cable Winder.3mf" \
    "$BASE/Portable Cable Winder(2).3mf" \
    "$BASE/Portable Cable Winder(3).3mf" \
    "$BASE/Portable Cable Winder(4).3mf" \
    "$BASE/Regalo Baby Gate Hinges -RVOLT-.3mf" \
    "$BASE/Regalo Hinge.3mf" \
    "$BASE/Regalo_Toothed_Hinge_Cover_Cap_1350.3mf" \
    "$BASE/Rubbermaid FastTrack System P1S.3mf" \
    "$BASE/Ryobi Expand-it Fasttrack Mount v2.3mf" \
    "$BASE/Ryobi Expand-it Fasttrack Mount v3.3mf" \
    "$BASE/Ryobi Expand-it Fasttrack Mount v4.3mf" \
    "$BASE/Ryobi Expand-it Fasttrack Mount.3mf" \
    "$BASE/Stove+Dials+Melissa+and+Doug+Replacement.3mf" \
    "$BASE/Switch_Angle_Holder.3mf" \
    "$BASE/Tool 20V.3mf" \
    "$BASE/unifiFlex-Mini_mount-version1.3mf" \
    "$BASE/1x2x3_usb_holder_12.3mf" \
    "$BASE/FDM_0158 - RT4K SCART Brace Flange.3mf" \
    "$BASE/Dreamcast_MODE_Top.3mf" \
    "$BASE/Turbo_Grafx_16_Back_Cover.3mf" \
    "$BASE/move_stand.3mf" \
    "$BASE/sd-card-holder_a1.3mf" \
    "$BASE/box-6-2-6.3mf" \
    "$BASE/Boxes H2.3mf" \
    "$BASE/Clamshell Parts Box.3mf" \
    "$BASE/MilBox 6 Sectioned.3mf" \
    "$BASE/Small 5 Slots - Gridfinity Storage For Portable Cable Organizer.3mf" \
    "$BASE/Small 8 Slots - Gridfinity Storage For Portable Cable Organizer.3mf" \
    "$BASE/1x1 round container Print profile.3mf" \
    "$BASE/baseplate-6-3.3mf" \
    "$BASE/Grid.3mf" \
    "$BASE/Poopy Bucket - single color.3mf" \
    "$BASE/Dremel sanding disks v2.3mf" \
    "$BASE/Fillet Radius Inner Outter Bold DualColor.3mf" \
; do
    [ -e "$f" ] && move "$f" "$BASE/Household"
done

# ============================================================
# CATEGORY: Gaming & Decor (non-wargaming fun prints)
# ============================================================
echo "--- Gaming & Decor ---"
for f in \
    "$BASE/1-Zelda-EW-Adventurer-Costume-Full-3d-Print-Model-OP-.3mf" \
    "$BASE/1-Zelda-EW-Adventurer-Costume-Full-3d-Print-Model-OP-(3).3mf" \
    "$BASE/9 Panel - A Link To The Past - Map - 3MF.3mf" \
    "$BASE/echoes of wisdom map_Front_200x136.3mf" \
    "$BASE/LoZ_Frame_1AMS.3mf" \
    "$BASE/LoZ_Frame_1AMS(2).3mf" \
    "$BASE/LoZ_Frame_1AMS(3).3mf" \
    "$BASE/LoZ_Full_2AMS.3mf" \
    "$BASE/LoZ_Full_2AMS(2).3mf" \
    "$BASE/Zelda+-+A+Link+To+The+Past+-+Overworld+Map+-+Full_200x200+-+3MF+V2.3mf" \
    "$BASE/智慧的回响 塞尔达公主.3mf" \
    "$BASE/Han Solo dl44 - done.3mf" \
    "$BASE/A_wing_inf.3mf" \
    "$BASE/ssv-normandy-sr2-model-mmu-drd.3mf" \
    "$BASE/Rumi Sword (Bambu).3mf" \
    "$BASE/Arcade_Wall_Cabinet_X1C.3mf" \
    "$BASE/Arcade_Wall_Cabinet_X1C(2).3mf" \
    "$BASE/R.E.P.O._Robot_wip_v7.3mf" \
    "$BASE/Diamond V2 3MF.3mf" \
    "$BASE/Grinch.3mf" \
    "$BASE/MCM Vase.3mf" \
    "$BASE/MCM Vase(2).3mf" \
    "$BASE/MCM Vase(3).3mf" \
    "$BASE/The Tulip.3mf" \
    "$BASE/Large Pepper.3mf" \
    "$BASE/Pepper Logo v1.3mf" \
    "$BASE/maceta+aburrido_repaired bottom.3mf" \
    "$BASE/Tensegrity Table.3mf" \
    "$BASE/Tensegrity Table(2).3mf" \
    "$BASE/fidget+cube v2.3mf" \
    "$BASE/Ginormous Hex Fidget (Slice).3mf" \
    "$BASE/AHeardOfHippos.3mf" \
    "$BASE/Ninja.3mf" \
    "$BASE/tri staff.3mf" \
    "$BASE/epee dummy 3part v1.3mf" \
    "$BASE/Dummy-female-v1.0-minimal-runner-HQ.3mf" \
    "$BASE/Female-rounded-scale100-Armour.3mf" \
    "$BASE/Chainsword - Mk.1 for Makerworld.3mf" \
    "$BASE/Chainsword - Mk.2 for Makerworld.3mf" \
    "$BASE/WH40K Bolter (Bambu).3mf" \
    "$BASE/Termanid+Diorama+Scenary.3mf" \
; do
    [ -e "$f" ] && move "$f" "$BASE/Gaming & Decor"
done

# ============================================================
# CATEGORY: 40k Orks (loose models -> organized Orks folder)
# Use existing naming convention: "Real Unit Name_Proxy Name"
# ============================================================
echo "--- 40k Orks (loose -> organized) ---"
ORKS="$BASE/40k/Orks"

# HQ
move "$BASE/BEASTBOSS ORK - 6693417" "$ORKS/01_hq"
move "$BASE/Big Mek with Shokk Attack Gun by @STLHammer" "$ORKS/01_hq"
move "$BASE/Ghazzgul Thraka" "$ORKS/01_hq"
move "$BASE/Mek" "$ORKS/01_hq"
move "$BASE/Painboy (Scan) -" "$ORKS/01_hq"
move "$BASE/Weird Boy_Strange+Lad" "$ORKS/01_hq"
move "$BASE/Snikrot Scan" "$ORKS/01_hq"
move "$BASE/proxyhammer-40th-orks-9th-edition-beastboss-on-squigosaur-and-mozrog-skragbad-ork-rider-heroes-by-xenobits-model_files" "$ORKS/01_hq"
move "$BASE/Wartsnagga" "$ORKS/01_hq"

# Troops
move "$BASE/Boyz" "$ORKS/02_Troops"

# Elites
move "$BASE/Nobz" "$ORKS/03_Elites"
move "$BASE/Flash Gitz" "$ORKS/03_Elites"
move "$BASE/Mek Gunz Smasha Gun" "$ORKS/05_heavy support"

# Fast Attack
move "$BASE/Deffkoptas" "$ORKS/04_Fast Attack"
move "$BASE/Storm Boyz" "$ORKS/04_Fast Attack"
move "$BASE/Boomdakka Snazzwagon (Scan)" "$ORKS/04_Fast Attack"
move "$BASE/rucka-buggy" "$ORKS/04_Fast Attack"
move "$BASE/shocking-jump-dragster" "$ORKS/04_Fast Attack"

# Heavy Support
move "$BASE/Gargantuan Squiggoth 2.3mf" "$ORKS/05_heavy support"
move "$BASE/Gargantuan Squiggoth.3mf" "$ORKS/05_heavy support"
move "$BASE/Naked Squiggoth.stl" "$ORKS/05_heavy support"
move "$BASE/Ork Battlewagon.3mf" "$ORKS/05_heavy support"
move "$BASE/Battle Lorry" "$ORKS/05_heavy support"
move "$BASE/Looted dread" "$ORKS/05_heavy support"

# Flyers
move "$BASE/DakkaJet" "$ORKS/07_Flyers"

# Transports
move "$BASE/orc-ladz-workshop-manager-assembled" "$ORKS/06_dedicated transport"

# Non-Codex / Big models (Stompas, Gargants, etc.)
move "$BASE/Gorkabot.3mf" "$ORKS/Non-Codex Models"
move "$BASE/gorkaknight" "$ORKS/Non-Codex Models"
move "$BASE/Orc_Gorkanaut_DOW3.obj" "$ORKS/Non-Codex Models"
move "$BASE/Unsupported Morkabot V2 (Mythrodon)" "$ORKS/Non-Codex Models"
move "$BASE/brawla-bot" "$ORKS/Non-Codex Models"
move "$BASE/mosha-bot" "$ORKS/Non-Codex Models"
move "$BASE/shoota-bot" "$ORKS/Non-Codex Models"
move "$BASE/skrappin-mega-bot" "$ORKS/Non-Codex Models"
move "$BASE/The+Big+boy" "$ORKS/Non-Codex Models"
move "$BASE/The+Biggest+boy" "$ORKS/Non-Codex Models"
move "$BASE/kill-grinda-mega-fortress" "$ORKS/Non-Codex Models"
move "$BASE/krusher-fortress" "$ORKS/Non-Codex Models"
move "$BASE/Wrecka-crew-scan" "$ORKS/Non-Codex Models"
move "$BASE/Vontragg" "$ORKS/Non-Codex Models"
move "$BASE/Warn-A-Brotha97" "$ORKS/Non-Codex Models"
move "$BASE/BREXIT" "$ORKS/Non-Codex Models"
move "$BASE/Super Sun Tank" "$ORKS/Non-Codex Models"

# ============================================================
# CATEGORY: 40k other factions (loose at root)
# ============================================================
echo "--- 40k other factions (loose) ---"

# Knights
move "$BASE/Acastus Knight Porphyrion.3mf" "$BASE/40k/Knights"
move "$BASE/Castellan (Dominus)" "$BASE/40k/Knights"
move "$BASE/Dominus Knight.3mf" "$BASE/40k/Knights"
move "$BASE/Not Dominus Knight.3mf" "$BASE/40k/Knights"

# Chaos
move "$BASE/Forgefiend" "$BASE/40k/Chaos"
move "$BASE/Forgefiend.3mf" "$BASE/40k/Chaos"

# Space Marines / Imperium
move "$BASE/Astartes with Heavy Bolter" "$BASE/40k/Space Marines"
move "$BASE/Valkyrie+transport+aircraft.3mf" "$BASE/40k/Astra Militarum"
move "$BASE/arvus_lighter.3mf" "$BASE/40k/Astra Militarum"
move "$BASE/BaneBlade 400% COMPLETE TABLETOP-SCALE CONVERSION FOR A1MINI.3mf" "$BASE/40k/Astra Militarum"
move "$BASE/Legion_Artillery" "$BASE/40k/_30k"
move "$BASE/Lightning_tank_hunter" "$BASE/40k/_30k"

# Necrons
move "$BASE/Doomscythe_Necron+Flying+Croissant+Blade+of+Death" "$BASE/40k/Necrons"

# Tyranids
move "$BASE/Tyranid+2.3mf" "$BASE/40k/Tyranids"
move "$BASE/Tyranid+3-2.3mf" "$BASE/40k/Tyranids"
move "$BASE/Tyranid+3.3mf" "$BASE/40k/Tyranids"

# Tau (merge root Tau into 40k/Tau)
move "$BASE/Tau" "$BASE/40k/Tau/_merged_from_root"
move "$BASE/tau terrain files.3mf" "$BASE/40k/_Terrain"

# Titans
move "$BASE/Dire Warhound" "$BASE/40k/_Titans"
move "$BASE/Dire Wolf Warhound.3mf" "$BASE/40k/_Titans"
move "$BASE/Imperator%20titan%20AT" "$BASE/40k/_Titans"
move "$BASE/Mars Pattern Reaver Titan.3mf" "$BASE/40k/_Titans"
move "$BASE/Mars Warlord Titan.3mf" "$BASE/40k/_Titans"
move "$BASE/Reaver" "$BASE/40k/_Titans"
move "$BASE/Warbringer Nemesis.3mf" "$BASE/40k/_Titans"
move "$BASE/Warmaster" "$BASE/40k/_Titans"
move "$BASE/Warmonger parts" "$BASE/40k/_Titans"

# Terrain
move "$BASE/Bunker complete 1.3mf" "$BASE/40k/_Terrain"
move "$BASE/Bunker+complete+2.3mf" "$BASE/40k/_Terrain"
move "$BASE/Manufactorum.3mf" "$BASE/40k/_Terrain"
move "$BASE/Sanctum Imperialis.3mf" "$BASE/40k/_Terrain"
move "$BASE/Zone Mortailis.3mf" "$BASE/40k/_Terrain"
move "$BASE/ImperialTower.3mf" "$BASE/40k/_Terrain"
move "$BASE/Infected+ruin+walls.3mf" "$BASE/40k/_Terrain"
move "$BASE/Storefront 2.3mf" "$BASE/40k/_Terrain"
move "$BASE/Landing Pad.3mf" "$BASE/40k/_Terrain"
move "$BASE/Landing_pad" "$BASE/40k/_Terrain"
move "$BASE/Office Base Intact.3mf" "$BASE/40k/_Terrain"
move "$BASE/Office Roof Intact.3mf" "$BASE/40k/_Terrain"
move "$BASE/Office Upper Intact.3mf" "$BASE/40k/_Terrain"
move "$BASE/Palace Base Floor.3mf" "$BASE/40k/_Terrain"
move "$BASE/Senate+Base+Right.3mf" "$BASE/40k/_Terrain"
move "$BASE/Rock+Formation+Volcanic+8+pack.3mf" "$BASE/40k/_Terrain"
move "$BASE/Bug+Holes+and+Walls.3mf" "$BASE/40k/_Terrain"
move "$BASE/Modular_Magnetic_Trench.3mf" "$BASE/40k/_Terrain"
move "$BASE/OpenLOCK_Clip_v5.4.3mf" "$BASE/40k/_Terrain"
move "$BASE/grimdark bases.3mf" "$BASE/40k/_Terrain"
move "$BASE/kill team" "$BASE/40k/_Specialist Games"

# Bases
move "$BASE/120mm x 92mm Oval Base.3mf" "$BASE/40k/_Accessories"
move "$BASE/160mm Circular Base.3mf" "$BASE/40k/_Accessories"
move "$BASE/160mm Circular Base(2).3mf" "$BASE/40k/_Accessories"
move "$BASE/170mm x 105mm Oval Base.3mf" "$BASE/40k/_Accessories"
move "$BASE/170mm.3mf" "$BASE/40k/_Accessories"
move "$BASE/170x105mmBase.3mf" "$BASE/40k/_Accessories"
move "$BASE/170x109mm oval base.3mf" "$BASE/40k/_Accessories"
move "$BASE/25MM BASE_Magnet.3mf" "$BASE/40k/_Accessories"
move "$BASE/25MM BASE_Magnet(2).3mf" "$BASE/40k/_Accessories"
move "$BASE/bases.3mf" "$BASE/40k/_Accessories"

# Bundles (STLHammer etc — various factions)
move "$BASE/13_bundle" "$BASE/40k/_Unsorted"
move "$BASE/63_bundle" "$BASE/40k/_Unsorted"
move "$BASE/65_bundle" "$BASE/40k/_Unsorted"
move "$BASE/81_bundle" "$BASE/40k/_Unsorted"
move "$BASE/93_bundle" "$BASE/40k/_Unsorted"
move "$BASE/97_bundle" "$BASE/40k/_Unsorted"

# ============================================================
# CATEGORY: 40k _Unsorted (40k but hard to place)
# ============================================================
echo "--- 40k Unsorted ---"
move "$BASE/骑士球泰机甲.3mf" "$BASE/40k/_Unsorted"
move "$BASE/雷鹰.3mf" "$BASE/40k/_Unsorted"
move "$BASE/mech.3mf" "$BASE/40k/_Unsorted"
move "$BASE/Fuselage(fixed)_00.3mf" "$BASE/40k/_Unsorted"
move "$BASE/separate parts, 100%, recommended settings.3mf" "$BASE/40k/_Unsorted"
move "$BASE/Tersus" "$BASE/40k/_Unsorted"
move "$BASE/Tersus-2" "$BASE/40k/_Unsorted"
move "$BASE/caddyh11" "$BASE/40k/_Unsorted"
move "$BASE/caddyh11-2" "$BASE/40k/_Unsorted"
move "$BASE/mcp2-v1" "$BASE/40k/_Unsorted"
move "$BASE/3d Printing" "$BASE/40k/_Unsorted"

# ============================================================
# CATEGORY: Remaining unknowns -> _Unsorted
# ============================================================
echo "--- Unsorted (unknown) ---"
# Catch anything left at root that isn't a known folder and wasn't already claimed
for f in "$BASE/"*; do
    name="$(basename "$f")"
    # Skip our organized folders
    case "$name" in
        40k|Wargaming|Household|"Printer Accessories"|Gridfinity|"Gaming & Decor"|_Archive|_Unsorted) continue ;;
    esac
    # Skip hidden files
    [[ "$name" == .* ]] && continue
    # Skip if already claimed by a category above
    if grep -qxF "$f" "$CLAIMED_FILE" 2>/dev/null; then continue; fi
    # If it's still at the root, it's unsorted
    move "$f" "$BASE/_Unsorted"
done

# ============================================================
# Summary
# ============================================================
echo ""
echo "=== MANIFEST ==="
total=$(wc -l < "$MANIFEST")
echo "Total moves: $total"
echo ""

if [ "$MODE" = "--dry-run" ]; then
    echo "Moves by destination:"
    sed 's|.* -> ||' "$MANIFEST" | sort | uniq -c | sort -rn
    echo ""
    echo "Full manifest saved to: $MANIFEST"
    echo ""
    echo "Review the manifest, then run with --execute to apply."
else
    echo "Done! All files moved."
fi
