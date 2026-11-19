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
| Archipelago: sand cay + tidal flat, rocky reef flat, granite island beach, east drop-off (terrain shapes, rock / deep shading) | Procedural heightfield + shader | `src/world/Archipelago.ts`, `src/world/TerrainSystem.ts` | V2 P1 |
| Dark boulders, smooth granite boulders, beach grass, shrubs, small palms, driftwood on the new islands | Shared procedural rock / shrub / grass / palm builders | `src/world/Archipelago.ts`, `src/world/Island.ts` | V2 P1 |
| Lagoon patch reefs and seagrass meadows (seeded scatter) | Coral factory + instanced seagrass | `src/world/Reef.ts` | V2 P1 |
| Bushy gorgonian / sea rod and black coral (3D branching, muted colours) | Recursive tapered tubes with vertex colours | `src/world/coralFactory.ts` (`gorgonianBush`) | V2 P1 |
| Pillar coral, mushroom coral, barrel sponge, sea whips, sea urchin, giant clam | Procedural geometry (lathe / parametric surfaces / tubes) with vertex colours | `src/world/coralFactory.ts` | V2 P1 |
| Wooden display base + contact shadow (Full View) | Extruded rounded slab with the procedural wood texture; canvas radial gradient | `src/world/Plinth.ts` | V2 P1 |
| Sergeant major, parrotfish, moon wrasse, yellowtail snapper, barracuda, grouper | Same lofted fish builder, new painted specs | `src/creatures/fishSpecies.ts` | V2 P1 |
| Garden eels, sea cucumber, cleaner shrimp, crawling urchins | Procedural tubes / lathes with vertex colours | `src/creatures/LagoonLife.ts` | V2 P1 |
| Ocean Journal (parchment sheet, diary lines, automatic names) | CSS + text written for this project | `src/features/OceanJournal.ts`, `src/content/journal.ts`, `src/ui/styles.css` | V2 P2 |
| Rare visitors: green turtle (teardrop carapace with painted scutes and sunburst streaks, pale plastron, lofted scaled head with beak and eyelids, lens-section swept flippers with claws), manta ray (swept-wing planform, CPU wing wave), dolphins, whale shark (broad flat head, soft vertex-colour spots, tail wave), seahorse (lofted body with bony rings and ridges, curled square tail, coronet, rippling dorsal fin), cuttlefish (shader colour bands, rippling fin skirt), moray eel (flattened body with fin fold, hinged jaw with teeth, nostril tubes; spotted or green), flying fish (translucent wing fins) | Procedural lofts / tubes / lathes / extrusions with vertex colours; scute, scale and spot textures painted into small canvases at runtime (a few rows per frame) | `src/creatures/Visitors.ts`, `src/creatures/visitorModels.ts` | V2 P3 |
| Beach traces: turtle tracks, cuttlebone | Flat ground marks / a flattened sphere, fading out | `src/features/RareVisitors.ts` | V2 P3 |
| Field Notebook sketches | Rendered from the live scene at runtime, then turned into ink + watercolour on paper in JS (no images shipped) | `src/features/FieldNotebook.ts` | V2 P3 |
| Field Notebook texts (21 residents, 9 visitors, 10 behaviours, 中文 + English) | Written for this project; common, verifiable natural history (same sources as Ocean Mail) | `src/content/notebook.ts` | V2 P3 |
| Ambient sound (swells, foam, underwater hum, reef crackle, wind, rain) | Synthesised at runtime with Web Audio from generated white / pink / brown noise; no audio files | `src/features/AmbientSound.ts` | V2 |
| View buttons, mini map | Inline SVG icons; the map is painted from the terrain heightfield at runtime | `src/features/MiniMap.ts` | V2 P1 |
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
