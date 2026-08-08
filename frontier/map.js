'use strict';
/*
 * 개척 원정대 — 세계 지도
 *
 * 이 게임의 재미는 "어디에 자리 잡을 것인가" 하나에 걸려 있다.
 * 그래서 지역마다 강점과 대가가 반드시 어긋나게 짜여 있다:
 *
 *   - 순도 높은 매장지일수록 멀고(dist), 위험하고(danger), 물이 없다(water:false)
 *   - 물이 없으면 그 자리에서 발전할 수 없다 → 송전탑으로 전력을 끌어와야 한다
 *   - 매장지는 선착순이다 → 좋은 자리는 남이 먼저 잡는다
 *
 * 그래서 "순수 철 3개짜리 하늘 고원"은 최고의 자리인 동시에 최악의 자리다.
 */

const 불순 = 0.5, 보통 = 1, 순수 = 2;

/** @param res 자원 클래스명 · @param p 순도 · @param n 개수 */
const node = (res, p, n = 1) => Array.from({ length: n }, () => ({ res, purity: p }));

const REGIONS = {
  grass_hub: {
    name: '초원 개척지', dist: 0, water: true, danger: 0, home: true,
    desc: '완만한 초원 한복판. 첫 강하 지점이라 바닥에 착륙 자국이 남아 있다. ' +
      '개울이 흐르고 위험한 것은 없다 — 대신 매장지도 변변찮다.',
    nodes: [...node('Desc_OreIron_C', 보통, 2), ...node('Desc_Stone_C', 보통, 1)],
    exits: { 북: 'forest_edge', 남: 'marsh_edge', 동: 'rocky_flats', 서: 'river_bend' },
  },
  river_bend: {
    name: '굽이치는 강가', dist: 1, water: true, danger: 0,
    desc: '강이 크게 휘어 도는 자리. 물이 넉넉해 발전소를 세우기 좋다.',
    nodes: [...node('Desc_OreIron_C', 보통, 2), ...node('Desc_Stone_C', 불순, 1)],
    exits: { 북: 'copper_hollow' },
  },
  rocky_flats: {
    name: '바위 평원', dist: 1, water: false, danger: 0,
    desc: '풍화된 바위가 널린 메마른 평지. 석회암이 그대로 노출돼 있다. 물은 없다.',
    nodes: [...node('Desc_Stone_C', 순수, 1), ...node('Desc_OreIron_C', 불순, 2)],
    exits: { 동: 'limestone_cliffs', 북: 'crash_site', 남: 'cave_mouth' },
  },
  forest_edge: {
    name: '숲 가장자리', dist: 1, water: true, danger: 0,
    desc: '침엽수림이 시작되는 경계. 나무 사이로 노두가 드문드문 보인다.',
    nodes: [...node('Desc_OreCopper_C', 보통, 1), ...node('Desc_OreIron_C', 보통, 1)],
    exits: { 북: 'iron_ridge', 서: 'copper_hollow', 동: 'crash_site' },
  },
  marsh_edge: {
    name: '늪 초입', dist: 1, water: true, danger: 1,
    desc: '발이 푹푹 빠지는 진창. 물비린내와 함께 유황 냄새가 섞여 온다.',
    nodes: [...node('Desc_Stone_C', 보통, 1), ...node('Desc_Sulfur_C', 불순, 1)],
    exits: { 남: 'swamp_deep' },
  },

  copper_hollow: {
    name: '구리 웅덩이', dist: 2, water: true, danger: 0,
    desc: '움푹 팬 분지 바닥이 온통 푸른 녹빛이다. 물도 있고 위험도 없다 — ' +
      '초반에 이만한 자리가 없어서, 대개 남이 먼저 와 있다.',
    nodes: [...node('Desc_OreCopper_C', 순수, 2)],
    exits: { 남: 'river_bend' },
  },
  iron_ridge: {
    name: '철광 능선', dist: 2, water: false, danger: 1,
    desc: '붉게 녹슨 능선이 길게 뻗어 있다. 노두가 통째로 철광석이다. ' +
      '다만 능선 위라 물 한 방울 없다 — 전력은 아래에서 끌어와야 한다.',
    nodes: [...node('Desc_OreIron_C', 순수, 2), ...node('Desc_Coal_C', 불순, 1)],
    exits: { 동: 'coal_gorge', 서: 'north_forest', 위: 'sky_plateau' },
  },
  north_forest: {
    name: '북부 침엽수림', dist: 2, water: true, danger: 1,
    desc: '햇빛이 거의 들지 않는 빽빽한 숲. 무언가 큰 것이 지나간 자국이 있다.',
    nodes: [...node('Desc_OreCopper_C', 보통, 1), ...node('Desc_OreIron_C', 보통, 1)],
    exits: {},
  },
  crash_site: {
    name: '추락 지점', dist: 2, water: false, danger: 1,
    desc: '보급 캡슐이 처박혀 그을린 구덩이. 매장지는 없지만 잔해에서 ' +
      '하드 드라이브를 회수할 수 있다. (조사하면 드러난다)',
    nodes: [], salvage: true,
    exits: { 북: 'coal_gorge' },
  },
  limestone_cliffs: {
    name: '석회 절벽', dist: 2, water: false, danger: 0,
    desc: '흰 절벽이 병풍처럼 서 있다. 콘크리트 걱정은 여기서 끝난다.',
    nodes: [...node('Desc_Stone_C', 순수, 2)],
    exits: {},
  },

  coal_gorge: {
    name: '석탄 협곡', dist: 3, water: true, danger: 1,
    desc: '검은 지층이 협곡 벽면을 가로지르고, 바닥으로 물이 흐른다. ' +
      '석탄과 물이 한자리에 있다 — 이 세계에서 전력이 시작되는 곳이다.',
    nodes: [...node('Desc_Coal_C', 순수, 2), ...node('Desc_OreIron_C', 보통, 1)],
    exits: {},
  },
  cave_mouth: {
    name: '동굴 입구', dist: 3, water: false, danger: 1,
    desc: '바위 틈이 아래로 크게 벌어져 있다. 안쪽에서 찬 바람이 올라온다.',
    nodes: [...node('Desc_RawQuartz_C', 보통, 1)],
    exits: { 아래: 'quartz_caverns', 동: 'desert_dunes' },
  },
  sky_plateau: {
    name: '하늘 고원', dist: 3, water: false, danger: 2,
    desc: '수직 절벽 위의 평탄지. 순수한 철 노두가 세 군데나 드러나 있다. ' +
      '이 세계 최고의 철 자리이자, 물도 없고 오르내리기도 최악인 자리다.',
    nodes: [...node('Desc_OreIron_C', 순수, 3)],
    exits: {},
  },
  desert_dunes: {
    name: '사막 모래언덕', dist: 3, water: false, danger: 1,
    desc: '바람에 결이 진 모래언덕. 유황 냄새가 나고 석영이 반짝인다.',
    nodes: [...node('Desc_Sulfur_C', 보통, 1), ...node('Desc_RawQuartz_C', 보통, 1)],
    exits: { 동: 'sulfur_ridge', 남: 'red_jungle' },
  },
  swamp_deep: {
    name: '깊은 늪', dist: 3, water: true, danger: 2,
    desc: '수면 위로 기름막이 무지갯빛으로 떠 있다. 발밑이 어디까지 깊은지 알 수 없다.',
    nodes: [...node('Desc_LiquidOil_C', 보통, 2)],
    exits: { 남: 'oil_fields' },
  },

  quartz_caverns: {
    name: '석영 동굴', dist: 4, water: false, danger: 2,
    desc: '헤드램프에 벽 전체가 되쏘아 눈이 부시다. 결정이 천장까지 자라 있다.',
    nodes: [...node('Desc_RawQuartz_C', 순수, 2), ...node('Desc_OreGold_C', 보통, 1)],
    exits: {},
  },
  sulfur_ridge: {
    name: '유황 능선', dist: 4, water: false, danger: 2,
    desc: '노란 결정이 바위를 덮었고 공기가 맵다. 오래 있으면 안 된다.',
    nodes: [...node('Desc_Sulfur_C', 순수, 2)],
    exits: {},
  },
  red_jungle: {
    name: '붉은 정글', dist: 4, water: true, danger: 2,
    desc: '붉은 대나무가 하늘을 가린다. 시야가 몇 미터 나오지 않는다.',
    nodes: [...node('Desc_OreGold_C', 순수, 1), ...node('Desc_LiquidOil_C', 보통, 1)],
    exits: { 남: 'titan_forest' },
  },
  oil_fields: {
    name: '유전 지대', dist: 4, water: true, danger: 2,
    desc: '지면이 검게 젖어 있고 여기저기서 원유가 배어 나온다. 이 세계 최대의 유전이다.',
    nodes: [...node('Desc_LiquidOil_C', 순수, 3)],
    exits: { 서: 'bauxite_coast' },
  },

  titan_forest: {
    name: '거대 나무 숲', dist: 5, water: true, danger: 2,
    desc: '한 그루가 산만 한 나무들이 서 있다. 뿌리 사이로 카테리움 광맥이 드러났다.',
    nodes: [...node('Desc_OreGold_C', 보통, 2), ...node('Desc_LiquidOil_C', 보통, 1)],
    exits: { 동: 'ancient_ruins' },
  },
  bauxite_coast: {
    name: '보크사이트 해안', dist: 5, water: true, danger: 2,
    desc: '붉은 흙이 해안선을 따라 길게 이어진다. 파도 소리가 계속 들린다.',
    nodes: [...node('Desc_OreBauxite_C', 순수, 2)],
    exits: { 남: 'nitrogen_vents' },
  },
  ancient_ruins: {
    name: '고대 유적', dist: 5, water: false, danger: 2,
    desc: '누가 세웠는지 알 수 없는 구조물이 반쯤 묻혀 있다. 매장지는 없지만, ' +
      '여기서 회수되는 유물이 공동 프로젝트의 열쇠다.',
    nodes: [], salvage: true, relic: true,
    exits: { 남: 'uranium_crater' },
  },

  nitrogen_vents: {
    name: '질소 분출구', dist: 6, water: false, danger: 3,
    desc: '지면 갈라진 틈에서 기체가 쉭쉭 뿜어 나온다. 방독 없이는 몇 초도 못 버틴다.',
    nodes: [...node('Desc_NitrogenGas_C', 순수, 2)],
    exits: {},
  },
  uranium_crater: {
    name: '우라늄 분화구', dist: 6, water: false, danger: 3,
    desc: '가이거 계수기가 끊임없이 운다. 노란 광맥이 분화구 벽을 따라 흐른다.',
    nodes: [...node('Desc_OreUranium_C', 순수, 1), ...node('Desc_OreBauxite_C', 보통, 1)],
    exits: {},
  },
};

/* ---------- 방향 ---------- */
const OPPOSITE = { 북: '남', 남: '북', 동: '서', 서: '동', 위: '아래', 아래: '위' };
const DIRS = Object.keys(OPPOSITE);
// 영문·약자 별칭 (머드 습관대로 n/s/e/w 도 받는다)
const DIR_ALIAS = {
  n: '북', s: '남', e: '동', w: '서', u: '위', d: '아래',
  north: '북', south: '남', east: '동', west: '서', up: '위', down: '아래',
  북쪽: '북', 남쪽: '남', 동쪽: '동', 서쪽: '서', 위쪽: '위', 아래쪽: '아래',
};

/**
 * 출구는 한쪽만 적고 반대편은 자동으로 채운다.
 * 손으로 양쪽 다 적으면 반드시 어긋나므로, 어긋난 곳은 여기서 터뜨린다.
 */
function linkExits() {
  for (const [id, r] of Object.entries(REGIONS)) {
    for (const [dir, to] of Object.entries(r.exits)) {
      if (!REGIONS[to]) throw new Error(`지도 오류: ${id} ${dir} → 없는 지역 ${to}`);
      const back = OPPOSITE[dir];
      const cur = REGIONS[to].exits[back];
      if (cur && cur !== id) throw new Error(`지도 오류: ${to} ${back} 가 ${cur} 와 ${id} 로 겹침`);
      REGIONS[to].exits[back] = id;
    }
  }
  // 본거지에서 모든 지역에 갈 수 있어야 한다 (고립된 섬이 있으면 매장지가 죽는다)
  const seen = new Set(['grass_hub']);
  const queue = ['grass_hub'];
  while (queue.length) {
    for (const to of Object.values(REGIONS[queue.shift()].exits)) {
      if (!seen.has(to)) { seen.add(to); queue.push(to); }
    }
  }
  const lost = Object.keys(REGIONS).filter(id => !seen.has(id));
  if (lost.length) throw new Error(`지도 오류: 본거지에서 못 가는 지역 ${lost.join(', ')}`);
}
linkExits();

for (const [id, r] of Object.entries(REGIONS)) {
  r.id = id;
  r.nodes.forEach((n, i) => { n.idx = i; });
}

const PURITY_NAME = { 0.5: '불순', 1: '보통', 2: '순수' };
const DANGER_NAME = ['안전', '주의', '위험', '치명'];

module.exports = { REGIONS, DIRS, DIR_ALIAS, OPPOSITE, PURITY_NAME, DANGER_NAME };
