# Item Spawner (아이템 생성 모드)

채팅 명령어로 아이템을 인벤토리에 지급하는 SML 치트 모드.

## 명령어

```
/give <아이템> [수량]        (별칭: /gi)
```

- `<아이템>`: 클래스명(`Desc_IronPlate_C`), 축약명(`IronPlate`), **표시명**(`Iron Plate`) 지원.
  게임 언어가 한국어면 **한글 표시명**(`철판`)도 됨. 대소문자 무시, 부분 일치 지원
  (후보가 여럿이면 목록을 보여줌).
- `[수량]` 생략 시 한 스택. 인벤토리가 가득 차면 들어간 만큼만 지급하고 알려줌.
- 예: `/give IronPlate 100` · `/give 철판 100` · `/give Iron Plate` · `/gi 나사 500`

## 빌드 방법 (게임이 설치된 PC에서)

전체 안내: https://docs.ficsit.app/satisfactory-modding/latest/Development/BeginnersGuide/index.html

1. **도구 설치**: Visual Studio 2022(C++ 게임 개발 워크로드), Wwise(SML 안내 버전),
   그리고 Coffee Stain 커스텀 언리얼 엔진(Epic↔GitHub 계정 연동 후
   satisfactorymodding/UnrealEngine 릴리스에서 설치).
2. **스타터 프로젝트**: `git clone https://github.com/satisfactorymodding/SatisfactoryModLoader.git`
   → 브랜치 `master` (최신 게임 버전 대응).
3. 이 폴더(`ItemSpawner`)를 통째로 스타터 프로젝트의 **`Mods/`** 아래에 복사:
   `SatisfactoryModLoader/Mods/ItemSpawner/`
4. `FactoryGame.uproject` 우클릭 → *Generate Visual Studio project files* → `FactoryGame.sln` 열고
   `FactoryGame Editor` 구성으로 빌드 (또는 uproject 더블클릭으로 에디터 실행 시 자동 컴파일 유도).
5. 에디터에서 **Alpakit** 창 열기 → `ItemSpawner` 체크 → *Alpakit!* → 생성된
   `ItemSpawner.zip`(플랫폼별 .pak/.utoc 포함)이 게임 `FactoryGame/Mods/`에 자동 설치되거나
   Satisfactory Mod Manager 로 설치.
6. 게임 실행 → 채팅창(Enter)에서 `/give 철판 100`.

## 파일 구성

```
ItemSpawner.uplugin                  플러그인 정의 (SML ^3.11.0 의존)
Source/ItemSpawner/
  ItemSpawner.Build.cs               모듈 빌드 규칙 (FactoryGame, SML 의존)
  Public/ItemSpawnerModule.h         UE 모듈 보일러플레이트
  Private/ItemSpawnerModule.cpp
  Public/ItemSpawnerGameWorldModule.h  루트 월드 모듈 — mChatCommands 에 /give 등록
  Public/GiveItemCommand.h           /give 명령 정의
  Private/GiveItemCommand.cpp        아이템 검색 + 인벤토리 지급 로직
```

## 구현 노트 (SML master 소스 기준 확인된 API)

- 명령 등록: `UGameWorldModule::mChatCommands` — `bRootModule=true` 인 모듈은 SML이 자동 발견.
- 아이템 검색: `GetDerivedClasses(UFGItemDescriptor)` 로 로드된 디스크립터를 순회,
  클래스명/축약명/`UFGItemDescriptor::GetItemName()`(로컬라이즈 표시명) 매칭.
- 지급: `UFGInventoryComponent::AddStack(FInventoryStack(n, class), allowPartialAdd=true)` 를
  `GetStackSize()` 단위로 반복.
- 소스 파일은 한글 리터럴 때문에 **UTF-8 BOM** 유지 필요.
- 멀티플레이: 명령은 서버에서 실행되므로 호스트/데디 서버에 모드가 설치돼 있어야 함.
