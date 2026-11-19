import type { Lang } from '../features/Prefs';

/**
 * V2 (P3) Field Notebook pages: bilingual names and two or three gentle notes per species /
 * behaviour. Facts are common, verifiable natural history (NOAA, Smithsonian Ocean, Britannica,
 * MarineBio); wording is our own. The notebook never shows how many pages exist.
 */
export interface NotePage {
  zh: string;
  en: string;
  notesZh: string;
  notesEn: string;
}

const P = (zh: string, en: string, notesZh: string, notesEn: string): NotePage => ({ zh, en, notesZh, notesEn });

export const PAGES: Record<string, NotePage> = {
  // ---------------------------------------------------------------- residents
  silverside: P('银汉鱼', 'Silverside', '成群游动，靠整齐划一的转身让捕食者眼花。身体侧面有一条闪亮的银带。', 'Moves in tight schools whose sudden, perfectly timed turns confuse predators. A bright silver stripe runs along each side.'),
  cardinal: P('天竺鲷', 'Cardinalfish', '大多在夜里活动，白天躲在珊瑚枝之间。许多种类由雄鱼把卵含在嘴里孵化。', 'Mostly active at night, sheltering among coral branches by day. In many species the male carries the eggs in his mouth until they hatch.'),
  clown: P('小丑鱼', 'Clownfish', '和海葵共生，身上的黏液让它不被触手蜇伤。群里最大的那条会变成雌鱼。', 'Lives with an anemone; a mucus coat keeps the stinging tentacles from hurting it. The largest fish of a group becomes the female.'),
  tang: P('蓝倒吊', 'Blue tang', '尾柄两侧各藏着一枚像手术刀一样的骨刺。整天啃食藻类，帮珊瑚保持干净。', 'Hides a scalpel-like spine on each side of its tail. It grazes algae all day, keeping the corals clean.'),
  butterfly: P('蝴蝶鱼', 'Butterflyfish', '常常成对生活，一起巡游。靠近尾巴的假眼斑会让捕食者弄错它的方向。', 'Often lives in pairs that patrol together. A false eyespot near the tail makes predators guess the wrong direction.'),
  angel: P('神仙鱼', 'Angelfish', '鳃盖上长着一根小刺，游得从容不迫。许多种类的幼鱼和成鱼花纹完全不同。', 'Has a small spine on its gill cover and swims without hurry. Young and adults of many species wear completely different patterns.'),
  sergeant: P('军士鱼', 'Sergeant major', '因身上五条像军装袖章的黑纹得名。产卵期的雄鱼会变成深蓝色，守着礁石上的卵。', 'Named for its five black bars, like a sergeant’s stripes. Breeding males turn dark blue and guard eggs laid on the rock.'),
  parrot: P('鹦嘴鱼', 'Parrotfish', '用喙一样的牙齿刮食珊瑚上的藻类，再排出细细的白沙——热带的白沙滩有不少来自它们。有些种类夜里会吐出一个黏液“睡袋”。', 'Scrapes algae off coral with a beak-like mouth and leaves fine white sand behind — much of a tropical beach comes from parrotfish. Some sleep in a mucus “sleeping bag”.'),
  wrasse: P('月眉鱼', 'Moon wrasse', '隆头鱼家族的一员，几乎从不停下游动。夜里会钻进岩缝里睡觉。', 'A wrasse that hardly ever stops swimming. At night it tucks itself into a crevice to sleep.'),
  snapper: P('黄尾笛鲷', 'Yellowtail snapper', '沿着礁坡成群巡游，一条黄色的纹从嘴一直延伸到尾巴。夜里更活跃。', 'Cruises the reef edge in loose schools, a yellow stripe running from snout to tail. Most active at night.'),
  barracuda: P('梭鱼', 'Barracuda', '平时几乎一动不动地悬在水里，需要时能在一瞬间冲刺。好奇心很强。', 'Hangs almost motionless in the water, then bursts away in an instant. Famously curious.'),
  grouper: P('石斑鱼', 'Grouper', '耐心地守在礁石旁。大多数石斑鱼一生中会由雌变雄；有些还会和海鳝合作捕猎。', 'Waits patiently beside the rock. Most groupers start life female and become male; some even hunt together with moray eels.'),
  jelly: P('海月水母', 'Moon jelly', '没有大脑，也没有心脏，靠伞缘一收一放前进。透过透明的伞能看见四个马蹄形的生殖腺。', 'Has no brain and no heart, and moves by pulsing its bell. Four horseshoe-shaped gonads show through the clear bell.'),
  crab: P('螃蟹', 'Crab', '横着走是因为腿的关节朝两侧弯曲。长大时要蜕掉旧壳，等新壳慢慢变硬。', 'Walks sideways because its leg joints bend that way. To grow it sheds its shell and waits for the new one to harden.'),
  hermit: P('寄居蟹', 'Hermit crab', '腹部柔软，要借空螺壳保护自己。长大了就得找更大的壳搬家。', 'Its soft abdomen needs a borrowed snail shell. As it grows, it has to move house into a bigger one.'),
  octopus: P('章鱼', 'Octopus', '有三颗心脏和蓝色的血液。皮肤能在一眨眼间改变颜色和纹理，藏进周围的环境里。', 'Has three hearts and blue blood. Its skin can change colour and texture in a blink to vanish into its surroundings.'),
  ray: P('蓝斑魟', 'Blue-spotted stingray', '常常把身体半埋在沙里休息。尾巴上的毒刺只在受到威胁时使用。', 'Often rests half-buried in the sand. The venomous spine on its tail is used only in defence.'),
  gardenEel: P('花园鳗', 'Garden eels', '一生几乎不离开自己的洞穴，迎着水流捕食漂过的浮游生物。一有动静，整片“花园”就缩回沙里。', 'Rarely leave their burrows, catching plankton from the passing current. At any disturbance the whole “garden” sinks into the sand.'),
  urchin: P('海胆', 'Sea urchin', '用管足和棘慢慢移动，多在夜里出来啃食藻类。它的嘴有个好听的名字——“亚里士多德提灯”。', 'Moves slowly on tube feet and spines, grazing algae mostly at night. Its mouth has a lovely name: “Aristotle’s lantern”.'),
  cucumber: P('海参', 'Sea cucumber', '一边慢慢爬，一边吞下沙子，吃掉其中的有机物，再排出干净的沙。', 'Crawls along swallowing sand, digesting the organic bits and leaving cleaner sand behind.'),
  shrimp: P('清洁虾', 'Cleaner shrimp', '摆动长长的白色触角招呼鱼儿来“洗澡”，替它们吃掉寄生虫。连大鱼也会张开嘴让它进去。', 'Waves its long white antennae to invite fish to a cleaning station and picks off their parasites. Even big fish open their mouths for it.'),
  // ---------------------------------------------------------------- visitors
  turtle: P('绿海龟', 'Green sea turtle', '成年后主要吃海草和藻类，名字来自它脂肪的绿色。能憋气很久，但还是要浮上水面换气。母龟会回到出生的海滩产卵。', 'Adults graze seagrass and algae; the name comes from the green colour of their fat. It can hold its breath a long time but must surface to breathe. Females return to the beach where they hatched to nest.'),
  manta: P('蝠鲼', 'Manta ray', '头前那对“角”是头鳍，帮它把浮游生物引进嘴里。常在夜里被吸引浮游生物的月光带到水面附近，缓缓翻飞。', 'The two “horns” are cephalic fins that funnel plankton into its mouth. It often feeds near the surface at night, rolling slowly as it goes.'),
  dolphin: P('海豚', 'Dolphins', '用回声定位“看”周围的世界。每只海豚都有自己的“签名哨音”，就像名字一样。', 'They “see” with echolocation. Each dolphin has its own signature whistle, much like a name.'),
  whaleShark: P('鲸鲨', 'Whale shark', '世界上最大的鱼，却只吃浮游生物和小鱼。每条鲸鲨身上的白斑都独一无二，像指纹一样。', 'The largest fish in the world, yet it eats only plankton and small fish. The pattern of white spots is unique to each one, like a fingerprint.'),
  seahorse: P('海马', 'Seahorse', '用卷起的尾巴挂在海草上。小海马是在雄海马的育儿袋里孵化的。两只眼睛能各自转动。', 'Holds on to seagrass with its curled tail. The father carries the eggs in a brood pouch until they hatch. Each eye moves on its own.'),
  cuttlefish: P('乌贼', 'Cuttlefish', '皮肤能在瞬间变出流动的花纹。身体里那块白色的“乌贼骨”帮它控制浮沉，常常被冲上海滩。', 'Its skin can ripple with moving patterns in an instant. The white “cuttlebone” inside controls its buoyancy and often washes up on beaches.'),
  moray: P('海鳝', 'Moray eel', '一张一合的嘴不是在示威，而是在呼吸——让水流过鳃。喉咙深处还有第二副颌。', 'The opening and closing mouth is not a threat — it is breathing, pumping water over the gills. It even has a second set of jaws in its throat.'),
  flyingFish: P('飞鱼', 'Flying fish', '用尾巴在水面急速拍打加速，然后展开翅膀一样的胸鳍滑翔，一次能滑出几十米远。', 'Beats its tail on the surface to speed up, then spreads wing-like fins and glides for tens of metres.'),
  fusilier: P('梅鲷', 'Fusilier', '白天成群在礁外的开阔水里捕食浮游生物，夜里躲进礁石缝里休息。', 'Schools in open water off the reef by day to feed on plankton, then shelters in the reef at night.'),
  // ---------------------------------------------------------------- behaviours
  'b:hermitSwap': P('寄居蟹换壳', 'A hermit crab changes shells', '它先仔细检查新壳的大小，再飞快地从旧壳挪进新壳——这是它最脆弱的一刻。', 'It inspects the new shell carefully, then moves over in a flash — its most vulnerable moment.'),
  'b:octopusInk': P('章鱼喷墨', 'The octopus inks', '一团墨汁像个假的影子，留在原地迷惑对手，章鱼自己趁机溜走。', 'A cloud of ink hangs like a decoy shadow while the octopus slips away.'),
  'b:octopusCamo': P('章鱼伪装', 'The octopus hides in plain sight', '它把身体半埋进沙里，皮肤的颜色和纹理也跟着变得像沙子一样。', 'Half-buried in the sand, its skin takes on the colour and texture of the seabed.'),
  'b:crabForage': P('螃蟹捡食', 'A crab picks up food', '螃蟹用小小的螯把食物一点点送进嘴里，吃得很仔细。', 'The crab carries food to its mouth bit by bit with its small claws.'),
  'b:eelsDuck': P('花园鳗缩回洞里', 'Garden eels duck', '有大鱼游过时，整片花园鳗几乎同时缩进沙里，过一会儿才慢慢探出来。', 'When a big fish passes, the whole colony sinks into the sand at once, then slowly rises again.'),
  'b:turtleBreath': P('海龟换气', 'A turtle comes up for air', '海龟浮到水面，鼻孔露出来深深吸一口气，又不慌不忙地潜下去。', 'The turtle rises, lifts its nostrils above the surface for a deep breath, and calmly dives again.'),
  'b:mantaRoll': P('蝠鲼翻飞', 'A manta somersaults', '蝠鲼在水里翻着跟头，把浮游生物聚拢在一起再吃。', 'The manta loops over and over, gathering plankton as it goes.'),
  'b:dolphinLeap': P('海豚跃出水面', 'Dolphins leap', '跃出水面能省力地快速前进，也可能只是为了好玩。', 'Leaping is an efficient way to travel fast — and maybe also just for fun.'),
  'b:cuttleColor': P('乌贼变色', 'A cuttlefish changes colour', '一道道深色的波纹从它的身上流过，像云影掠过海面。', 'Dark bands flow across its body like cloud shadows over the sea.'),
  'b:flyingGlide': P('飞鱼滑翔', 'Flying fish glide', '它们贴着海面滑翔，翅膀一样的胸鳍闪着蓝光。', 'They glide just above the waves, wing-like fins glinting blue.'),
  'b:barracudaStrike': P('梭鱼冲击鱼群', 'A barracuda strikes a school', '鱼群先收拢成一团，梭鱼冲进去的瞬间又向四周炸开。大多数时候它扑了个空。', 'The school balls up, then bursts apart the instant the barracuda dashes in. Most of the time it comes away with nothing.'),
  'b:grouperAmbush': P('石斑鱼伏击', 'A grouper ambushes', '它在礁石阴影里一动不动，等小鱼游近，猛地张嘴把水连同猎物一起吸进去。', 'It waits motionless in the shade of a rock, then opens its mouth so fast that water and prey are sucked in together.'),
};

export const pageName = (key: string, lang: Lang) => (PAGES[key] ? (lang === 'zh' ? PAGES[key].zh : PAGES[key].en) : key);
export const pageNotes = (key: string, lang: Lang) => (PAGES[key] ? (lang === 'zh' ? PAGES[key].notesZh : PAGES[key].notesEn) : '');
