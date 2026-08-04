#pragma once
#include "CoreMinimal.h"
#include "Module/GameWorldModule.h"
#include "GiveItemCommand.h"
#include "ItemSpawnerGameWorldModule.generated.h"

/**
 * 루트 게임 월드 모듈 — SML 이 자동 발견해서 mChatCommands 를 등록한다.
 */
UCLASS()
class ITEMSPAWNER_API UItemSpawnerGameWorldModule : public UGameWorldModule
{
    GENERATED_BODY()
public:
    UItemSpawnerGameWorldModule()
    {
        bRootModule = true;
        mChatCommands.Add(AGiveItemCommand::StaticClass());
    }
};
