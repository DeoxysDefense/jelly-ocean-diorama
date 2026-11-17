/**
 * Ocean Mail message library (local, bilingual). Every entry keeps one stable id so a note can
 * switch language without changing which message it is.
 *
 * Ocean facts were chosen from well-established, easy-to-verify marine biology / oceanography
 * (NOAA Ocean Service, Smithsonian Ocean, Encyclopaedia Britannica); wording stays cautious
 * ("about", "most") where numbers are estimates.
 */
export type MessageCategory = 'fact' | 'fortune' | 'thought';

export interface OceanMessage {
  id: string;
  cat: MessageCategory;
  zh: string;
  en: string;
}

const facts: [string, string][] = [
  ['章鱼有三颗心脏，血液因为含铜而呈蓝色。', 'Octopuses have three hearts, and their copper-rich blood is blue.'],
  ['小丑鱼出生时都是雄性；群体里最大的那条可以变成雌性。', 'Clownfish are all born male; the largest in a group can become female.'],
  ['地球上大约一半的氧气来自海洋，主要由浮游植物产生。', 'About half of the oxygen on Earth comes from the ocean, mostly made by phytoplankton.'],
  ['海星没有血液，它们靠海水在体内的管道系统里流动来输送养分。', 'Sea stars have no blood — they pump seawater through a water vascular system instead.'],
  ['珊瑚礁只占海底面积的不到 1%，却养活了大约四分之一的海洋物种。', 'Coral reefs cover less than 1% of the sea floor, yet support about a quarter of all marine species.'],
  ['水母没有大脑、心脏，也没有骨头。', 'Jellyfish have no brain, no heart and no bones.'],
  ['魟鱼是软骨鱼，和鲨鱼是近亲。', 'Stingrays are cartilaginous fish and close relatives of sharks.'],
  ['海马是由爸爸怀孕的：雄海马在育儿袋里孵化卵，再把小海马生出来。', 'In seahorses, the father carries the eggs in a pouch and gives birth to the young.'],
  ['海洋最深处马里亚纳海沟的挑战者深渊，深约 11 公里。', 'The deepest known point of the ocean, Challenger Deep, is about 11 kilometres down.'],
  ['海獭睡觉时有时会手牵手，以免被海流冲散。', 'Sea otters sometimes hold hands while sleeping so they do not drift apart.'],
  ['鹦嘴鱼啃食珊瑚时会把碎屑磨成细沙，一些热带白沙滩有不少沙子就是这样来的。', 'Parrotfish grind up coral as they feed — much of the white sand on some tropical beaches has passed through them.'],
  ['寄居蟹长大后会换更大的壳，有时还会按个头排队，依次交换贝壳。', 'Hermit crabs move into bigger shells as they grow, and sometimes line up by size to swap shells in turn.'],
  ['章鱼可以在不到一秒的时间里改变皮肤的颜色和纹理。', 'Octopuses can change the colour and texture of their skin in less than a second.'],
  ['蓝鲸是已知地球上出现过的最大的动物。', 'Blue whales are the largest animals known to have ever lived.'],
  ['很多雌海龟会回到自己出生的那片海滩产卵。', 'Many female sea turtles return to the beach where they hatched to lay their own eggs.'],
  ['声音在海水中的传播速度大约是空气中的四倍多。', 'Sound travels more than four times faster in seawater than in air.'],
  ['螃蟹失去的腿可以在之后几次蜕壳中慢慢长回来。', 'Crabs can regrow a lost leg over their next few moults.'],
  ['人类对深海海底的高精度测绘，至今只覆盖了一小部分。', 'Only a small part of the deep sea floor has been mapped in high detail.'],
  ['地球上约 97% 的水都在海洋里。', 'About 97% of all the water on Earth is in the ocean.'],
  ['珊瑚是动物。造礁珊瑚体内住着微小的藻类，为它们提供养分和颜色。', 'Corals are animals; reef-building corals host tiny algae that give them food and colour.'],
  ['螳螂虾出拳极快，是动物界速度最快的打击动作之一。', "A mantis shrimp's punch is one of the fastest strikes in the animal kingdom."],
  ['潮汐主要由月球的引力引起，太阳也有一部分作用。', "Tides are caused mainly by the Moon's gravity, with help from the Sun."],
  ['海水是咸的，主要因为河流把岩石中溶解的矿物质带进了海里。', 'The sea is salty mainly because rivers carry dissolved minerals from rocks into it.'],
  ['有些水母和浮游生物会发出生物荧光，夜里的海浪因此闪闪发亮。', 'Some jellyfish and plankton make their own light, which is why waves can sparkle at night.'],
];

const fortunes: [string, string][] = [
  ['有些答案，就像潮汐一样，会在合适的时候来到岸边。', 'Some answers arrive like the tide — in their own time.'],
  ['你正在等待的那阵风，已经在路上了。', 'The wind you are waiting for is already on its way.'],
  ['平静的海面下，总有新的东西在生长。', 'Beneath a calm surface, something new is always growing.'],
  ['今天捡到的小贝壳，会成为明天的好故事。', "Today's small shell will become tomorrow's good story."],
  ['顺着水流走一段，你会看到意想不到的风景。', 'Follow the current a little way — the view will surprise you.'],
  ['好运像浪花，一朵接着一朵。', 'Good luck comes like waves, one after another.'],
  ['一个小小的决定，会把你带到一片新的海域。', 'A small decision will carry you to new waters.'],
  ['别担心迷路，星星和海浪都认得回家的路。', 'Do not worry about getting lost — the stars and the waves both know the way home.'],
  ['你心里的那颗种子，正在悄悄发芽。', 'The seed in your heart is quietly sprouting.'],
  ['退潮的时候，正适合寻找宝藏。', 'Low tide is the best time to look for treasure.'],
  ['有人正想着你，就像月亮牵动着海水。', 'Someone is thinking of you, the way the moon tugs at the sea.'],
  ['慢慢来的事，往往走得最远。', 'What grows slowly often travels farthest.'],
  ['你会在不经意的时候，遇到刚刚好的人。', 'You will meet the right person when you least expect it.'],
  ['一次耐心的等待，会换来一片晴朗的海。', 'One patient wait will be repaid with a clear, bright sea.'],
  ['今天适合尝试一件新鲜的小事。', 'Today is a good day to try something small and new.'],
  ['再小的船，也能看到很远的地平线。', 'Even the smallest boat can see a far horizon.'],
  ['你曾经播下的善意，会随着海流漂回来。', 'The kindness you sent out will drift back to you on the current.'],
  ['下一个转角，有一片你喜欢的颜色。', 'Around the next corner is a colour you will love.'],
  ['一个好消息正在漂向你的岸边。', 'A piece of good news is drifting toward your shore.'],
  ['浪会退去，但美丽的贝壳会留下来。', 'The waves will pull back, but the beautiful shells will stay.'],
  ['你比自己以为的更会游泳。', 'You swim better than you think.'],
  ['把烦恼交给海风，它知道该带去哪里。', 'Give your worries to the sea breeze; it knows where to take them.'],
  ['今天的你，值得一杯冰凉的椰子水。', 'Today you deserve a glass of cold coconut water.'],
  ['不起眼的小岛上，也会长出最高的椰子树。', 'The tallest palm can grow on the smallest island.'],
  ['好奇心会为你打开一扇新的门。', 'Curiosity will open a new door for you.'],
  ['就算是最安静的海湾，也会有一场小小的庆祝。', 'Even the quietest bay will have a small celebration soon.'],
  ['你的努力就像珊瑚，一点一点筑成了礁。', 'Your effort is like coral, building a reef one small piece at a time.'],
  ['最美的日落，留给愿意停下来的人。', 'The best sunsets are saved for those who pause to watch.'],
  ['前方的水域很清澈，放心向前吧。', 'The water ahead is clear — go on with confidence.'],
  ['一只漂流瓶找到了你，这本身就是好运。', 'A bottle found its way to you — that alone is good luck.'],
];

const thoughts: [string, string][] = [
  ['今天不必完成一切，慢慢来也很好。', "You don't have to finish everything today. Going slowly is fine."],
  ['深呼吸一次，像海浪一样，涨起，然后退去。', 'Take one deep breath — rise like a wave, then let it go.'],
  ['休息不是停下，是在为下一段航程补给。', 'Resting is not stopping; it is stocking up for the next voyage.'],
  ['你已经做得很好了，记得也对自己温柔一点。', 'You are doing well. Remember to be gentle with yourself too.'],
  ['有些日子是晴天，有些日子是阴天，海依然是海。', 'Some days are sunny, some are grey — the sea is still the sea.'],
  ['允许自己发一会儿呆，看看水面的光。', 'Let yourself drift for a moment and watch the light on the water.'],
  ['小小的进步，也值得庆祝。', 'Small progress is still worth celebrating.'],
  ['喝口水吧，就像椰子树也需要雨水。', 'Have a sip of water — even palm trees need the rain.'],
  ['不是每一朵浪都要追上，挑一朵你喜欢的。', 'You do not have to catch every wave. Pick one you like.'],
  ['此刻的你，正好在这里，这就够了。', 'You are here, right now, and that is enough.'],
  ['如果累了，就让自己像海草一样随波轻轻摇摆。', 'If you are tired, sway gently like seagrass in the current.'],
  ['你的节奏，就是最适合你的节奏。', 'Your own pace is the right pace for you.'],
  ['把肩膀放松下来，海风会帮你把紧张吹走。', 'Let your shoulders drop; the sea breeze will carry the tension away.'],
  ['做不完的事情，明天的潮水还会再来。', 'What is left undone can wait — the tide comes again tomorrow.'],
  ['给自己一个微笑，像阳光落在水面上。', 'Give yourself a smile, like sunlight landing on the water.'],
  ['安静的时光，也是一种收获。', 'Quiet time is a harvest of its own.'],
  ['想念一个人的时候，就看看远方的海平线。', 'When you miss someone, look out at the far horizon for a while.'],
  ['世界很大，但你的小岛永远欢迎你回来。', 'The world is big, but your little island will always welcome you back.'],
  ['慢慢地吃一顿饭，也是在好好照顾自己。', 'Eating a meal slowly is a way of taking care of yourself.'],
  ['今晚早点睡吧，星星会替你守着这片海。', 'Go to bed a little early tonight; the stars will watch over the sea.'],
];

const build = (cat: MessageCategory, prefix: string, rows: [string, string][]): OceanMessage[] =>
  rows.map(([zh, en], i) => ({ id: `${prefix}-${String(i + 1).padStart(2, '0')}`, cat, zh, en }));

export const MESSAGES: OceanMessage[] = [...build('fact', 'fact', facts), ...build('fortune', 'fortune', fortunes), ...build('thought', 'thought', thoughts)];

export const messageById = (id: string) => MESSAGES.find((m) => m.id === id) ?? null;

/** Category weights for a new bottle (facts slightly favoured — they are the "discoveries"). */
const WEIGHTS: Record<MessageCategory, number> = { fact: 0.4, fortune: 0.35, thought: 0.25 };

/**
 * Picks a message the user has not seen recently. `recent` is the list of recently shown ids
 * (most recent last); the pick avoids all of them, and avoids repeating the last category
 * twice in a row when possible.
 */
export function pickMessage(recent: string[], random = Math.random): OceanMessage {
  const lastCat = recent.length ? messageById(recent[recent.length - 1])?.cat : undefined;
  let r = random();
  let cat: MessageCategory = 'fact';
  for (const c of Object.keys(WEIGHTS) as MessageCategory[]) {
    if (r < WEIGHTS[c]) {
      cat = c;
      break;
    }
    r -= WEIGHTS[c];
  }
  if (cat === lastCat && random() < 0.7) cat = cat === 'fact' ? 'fortune' : cat === 'fortune' ? 'thought' : 'fact';
  const seen = new Set(recent);
  let pool = MESSAGES.filter((m) => m.cat === cat && !seen.has(m.id));
  if (!pool.length) pool = MESSAGES.filter((m) => !seen.has(m.id));
  if (!pool.length) pool = MESSAGES.filter((m) => m.id !== recent[recent.length - 1]);
  return pool[Math.floor(random() * pool.length) % pool.length];
}
