# Assets & Licensing

**Every visual asset in this version is generated procedurally at start-up by this project's
own source code.** No third-party models, textures, fonts, HDRIs or sounds are downloaded or
bundled, so there are no external licences to track. (Three.js itself is MIT-licensed; see
`node_modules/three/LICENSE`.)

| Asset | How it is made | Source file | Status |
|---|---|---|---|
| Sky, clouds, sun glow | Screen-space shader (gradient + value-noise fbm) | `src/world/Sky.ts` | Final |
| Jelly water volume | Swept profile mesh + custom refraction / absorption shader | `src/water/OceanRenderer.ts` | Final |
| Seabed, island mound, strata cut | Procedural heightfield + layered shader | `src/world/TerrainSystem.ts` | Final |
| Caustics | Animated Worley-noise shader chunk | `src/util/shaders.ts` | Final |
| Hut (deck, planks, door, window, ~600 instanced thatch bundles, ridge ties, fringe, bamboo trims, flower box, potted plant, tiki torches with flicker, lantern glow, net, surfboard) | Procedural geometry, canvas-painted wood & thatch textures with generated normal maps | `src/world/Island.ts`, `src/util/textures.ts` | v1.2 art pass, replaceable |
| Coconut palms (ringed trunk, crown shaft + frond boots, 17 fronds in whorls with ~70 creased leaflets each, dead hanging fronds, ridged coconuts) | Procedural geometry, canvas bark texture | `src/world/Island.ts` | v1.2 art pass, replaceable |
| Shrubs, hibiscus, beach grass | Procedural leaf geometry | `src/world/Island.ts` | Good stand-in |
| Corals (staghorn, brain, sea fan, tube sponges, plate, leather), anemone, rocks, scallop, conch, starfish, seagrass | Procedural geometry, vertex colours with baked occlusion, procedural polyp / pore relief shader, seagrass colour gradients | `src/world/coralFactory.ts`, `src/util/shaders.ts` | v1.2 art pass, replaceable |
| Fish (silverside, cardinalfish, clownfish, blue tang, butterflyfish, angelfish) | Lofted bodies, shaped dorsal/anal/caudal/pectoral/pelvic fins, painted textures with scales, gill cover, lateral line, countershading, generated normal maps, translucent fin membranes (alpha-to-coverage), separate glossy eyes with iris, clearcoat + iridescence | `src/creatures/fishSpecies.ts` | v1.2 art pass, replaceable |
| Stingray | Rounded-rhombic disc with dorsal ridge, raised eyes + spiracles, pelvic fins, banded tail with sting, painted spotted texture, clearcoat | `src/creatures/Stingray.ts` | v1.3 art pass |
| Jellyfish | Lathe bell, torus gonads, ribbon arms, CPU tentacles | `src/creatures/Jellyfish.ts` | Good stand-in |
| Crab | Toothed, spotted carapace; 3-segment jointed legs; toothed chelae; eye stalks; antennae | `src/creatures/Crab.ts`, `crabParts.ts` | v1.3 art pass |
| Hermit crab | Shared crab parts emerging from a procedural spiral shell (swappable) | `src/creatures/HermitCrab.ts` | v1.3 |
| Octopus | Wrinkled mantle with papillae relief, eye turrets with golden bar-pupil eyes, arm web, siphon, shader-bent arms with sucker rows | `src/creatures/Octopus.ts` | v1.3 art pass |
| Cave rock, empty shells, floating objects, rain, plankton | Procedural | `src/world/Reef.ts`, `Floaters.ts`, `Rain.ts`, `Plankton.ts` | v1.3 |
| UI icons | Hand-written inline SVG | `src/ui/icons.ts` | Final |
| Message bottle (lathe glass with clearcoat, rolled parchment with canvas-painted lines, twine, noise-displaced cork) | Procedural | `src/features/OceanMail.ts` | V3 |
| Coconuts on the palms / fallen coconuts | Same procedural coconut as the palms | `src/features/CoconutGrowth.ts`, `src/world/Island.ts` | V3 |
| Skipping stones (flattened, noise-displaced pebbles) | Procedural | `src/features/StoneSkipping.ts` | V3 |
| Visiting fusilier school | Same lofted fish builder as the residents, new painted spec | `src/features/OceanEvents.ts` | V3 |
| Starfish, washed-up shells, dry palm frond (events) | Reused reef / island builders | `src/features/OceanEvents.ts` | V3 |
| Parchment note, game bar, magnifier frame | CSS only (no images) | `src/ui/styles.css` | V3 |
| Ocean Mail texts (24 facts, 30 fortunes, 20 thoughts, 中文 + English) | Written for this project; facts are common, verifiable marine-science knowledge (NOAA Ocean Service, Smithsonian Ocean, Britannica) | `src/content/messages.ts` | V3 |

## Replacing procedural assets with GLB / glTF models

The procedural builders are isolated so authored models can be swapped in without touching
behaviour code:

1. Put the file in `public/models/` (e.g. `public/models/hut.glb`) and record its source and
   licence in the table above (only CC0 / public domain / clearly licensed assets).
2. Load it with `GLTFLoader` (`three/examples/jsm/loaders/GLTFLoader.js`).
3. Replace the matching builder call:
   - **Hut / palms:** `Island.buildHut()` / `Island.addPalm()` — keep the returned `Group` at the
     same origin (ground contact at y = 0). Palms must expose a crown group for wind sway.
   - **Corals / rocks / shells:** pass the loaded geometry or object to `Reef.addCoral()` /
     `addRock()` / `addShell()`; selection outlines and obstacle radii are derived automatically.
   - **Fish:** `buildFish()` must return one `BufferGeometry` (nose at +x, ~unit length) plus a
     texture; the swim deformation is applied in the vertex shader along local x, so any fish
     mesh oriented that way works with `FishSystem` instancing.
   - **Crab / octopus:** keep the public `group`, `pos` and `update()` API; skeletal GLBs can drive
     legs/arms from the same state machine.
4. Rebuild (`npm run build`) and check the result in the browser.
