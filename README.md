# Satisfactory 작업 공간

- **공장 플래너** (`web/`) — 생산 계획 웹 앱 (아래 설명)
- **방치형 공장 게임** (`game/`) — 실제 1.0 레시피·전력·건설 비용 밸런스로 돌아가는
  브라우저 공장 건설 게임. `game/index.html` 을 열면 실행. 2D 캔버스에 채굴기·기계·발전기
  노드를 배치하고 출력→입력 포트를 드래그로 연결해 생산 체인을 설계한다 (버퍼·배압·전력
  부족 감속 시뮬레이션). 컨베이어 벨트 티어(Mk.1 60/분 ~ Mk.5 780/분, 연결선 클릭으로
  업그레이드), 자원 매장지 제한 + 순도(불순 ×0.5 / 보통 ×1 / 순수 ×2), 휠 줌 지원.
  출하 노드에 연결된 아이템만 재고로 들어오고, 그 재고로 마일스톤 8개를 달성하는 것이 목표.
  localStorage 자동 저장 + 오프라인 진행(최대 4시간).
- **Item Spawner 모드** (`mods/ItemSpawner/`) — `/give` 채팅 명령어로 아이템을 지급하는
  SML 치트 모드 소스. 빌드 방법은 `mods/ItemSpawner/README.md` 참고.

# 공장 플래너

Satisfactory 1.0 전체 레시피(대체 레시피 111종 포함) 기반 생산 계획 웹 앱.
목표 아이템과 분당 생산량을 입력하면 생산 트리, 필요 기계 수, 원자재, 총 전력, 부산물을 계산한다.

## 실행

`web/index.html` 을 브라우저에서 열면 끝 (서버 불필요, 오프라인 동작).

## 사용법

1. 아이템 검색창에 한글 또는 영문명 입력 (자동완성, 예: `철판` / `Iron Plate`) → 분당 생산량 입력 → **추가**
2. 목표는 여러 개 추가 가능, 요약(전력·기계·원자재·부산물)은 전체 합산
3. 생산 트리의 각 단계에서 드롭다운으로 레시피 변경 가능 (★ = 대체 레시피)
   - 레시피 선택은 아이템 단위 전역 적용 (같은 아이템은 트리 전체에서 동일 레시피)
4. 순환 레시피(예: Recycled Plastic ↔ Recycled Rubber 상호 참조)는 `⟳ 순환` 으로 표시되고
   해당 지점은 외부 공급으로 간주

## 계산 기준

- 기계 클럭 100% 기준. 기계 수는 소수(정확값)와 올림값(대) 병기
- 전력: 기계 수(소수) × 기계 소비 전력. 가변 전력 기계(입자 가속기 등)는 min/max 평균 사용
- 부산물은 자동 재사용(netting) 계산하지 않고 별도 표시
- 채굴기/추출기 전력은 미포함 (생산 기계만)

## 구조

```
web/index.html   앱 진입점
web/app.js       계산 로직 + UI (의존성 없는 바닐라 JS)
web/style.css    다크 테마 스타일
web/data.js      게임 데이터 (build_data.py 로 생성, 한국어 명칭 포함)
tools/build_data.py   raw_data.json + raw_ko.json → web/data.js 변환 스크립트
raw_data.json    원본 게임 데이터 (SatisfactoryTools 1.0, data1.0.json)
raw_ko.json      공식 한국어 명칭 (satisfactory-calculator.com /ko/api/game)
game/icons/      아이템·건물 아이콘 168개 (tools/fetch_icons.py 로 다운로드)
```

## 데이터 갱신

게임 업데이트 시:

```powershell
# 영문 수치 데이터 (레시피·전력·시간)
curl.exe -sL -o raw_data.json "https://raw.githubusercontent.com/greeny/SatisfactoryTools/master/data/data1.0.json"
# 한국어 명칭: 브라우저에서 https://satisfactory-calculator.com/ko/api/game 응답을 raw_ko.json 으로 저장
python tools\build_data.py
```

아이템·기계·레시피 이름은 게임 공식 한국어 번역을 따른다 (예: 철판, 제작기, 대체: 주조된 나사).
한국어 데이터에 없는 항목은 영문명으로 표시된다.
