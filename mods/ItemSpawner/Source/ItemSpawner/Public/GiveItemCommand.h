#pragma once
#include "CoreMinimal.h"
#include "Command/ChatCommandInstance.h"
#include "GiveItemCommand.generated.h"

/**
 * /give <아이템> [수량]
 * 아이템 이름(클래스명 / 영문 표시명 / 한국어 표시명, 부분 일치 지원)으로
 * 플레이어 인벤토리에 아이템을 생성한다.
 */
UCLASS()
class ITEMSPAWNER_API AGiveItemCommand : public AChatCommandInstance
{
    GENERATED_BODY()
public:
    AGiveItemCommand();

    EExecutionStatus ExecuteCommand_Implementation(
        UCommandSender* Sender,
        const TArray<FString>& Arguments,
        const FString& Label) override;

private:
    /** 이름으로 아이템 디스크립터 클래스를 찾는다. 정확 일치 > 부분 일치 우선. */
    static TSubclassOf<class UFGItemDescriptor> ResolveItem(
        const FString& Query, TArray<FString>& OutCandidates);
};
