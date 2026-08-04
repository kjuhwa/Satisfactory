#include "GiveItemCommand.h"
#include "Command/CommandSender.h"
#include "FGPlayerController.h"
#include "FGCharacterPlayer.h"
#include "FGInventoryComponent.h"
#include "Resources/FGItemDescriptor.h"
#include "UObject/UObjectHash.h"

AGiveItemCommand::AGiveItemCommand()
{
    CommandName = TEXT("give");
    Aliases.Add(TEXT("gi"));
    Usage = NSLOCTEXT("ItemSpawner", "GiveUsage",
        "/give <아이템> [수량] — 예: /give IronPlate 100, /give 철판 100, /give \"Iron Plate\"");
    MinNumberOfArguments = 1;
    bOnlyUsableByPlayer = true;
}

TSubclassOf<UFGItemDescriptor> AGiveItemCommand::ResolveItem(
    const FString& Query, TArray<FString>& OutCandidates)
{
    // 로드된 모든 아이템 디스크립터 클래스에서 검색.
    // (게임 월드에서는 레시피·도감이 참조하는 디스크립터가 사실상 전부 로드되어 있음)
    TArray<UClass*> ItemClasses;
    GetDerivedClasses(UFGItemDescriptor::StaticClass(), ItemClasses, true);

    const FString Q = Query.TrimStartAndEnd();
    TSubclassOf<UFGItemDescriptor> Exact = nullptr;
    TArray<TSubclassOf<UFGItemDescriptor>> Partial;

    for (UClass* Cls : ItemClasses) {
        if (Cls->HasAnyClassFlags(CLASS_Abstract)) {
            continue;
        }
        // 매칭 후보: 클래스명(Desc_IronPlate_C), 축약명(IronPlate), 표시명(Iron Plate / 철판)
        const FString ClassName = Cls->GetName();
        FString ShortName = ClassName;
        ShortName.RemoveFromStart(TEXT("Desc_"));
        ShortName.RemoveFromStart(TEXT("BP_"));
        ShortName.RemoveFromEnd(TEXT("_C"));
        const FString DisplayName = UFGItemDescriptor::GetItemName(Cls).ToString();

        if (Q.Equals(ClassName, ESearchCase::IgnoreCase) ||
            Q.Equals(ShortName, ESearchCase::IgnoreCase) ||
            Q.Equals(DisplayName, ESearchCase::IgnoreCase)) {
            Exact = Cls;
            break;
        }
        if (ShortName.Contains(Q) || DisplayName.Contains(Q)) {
            Partial.Add(Cls);
        }
    }

    if (Exact) {
        return Exact;
    }
    if (Partial.Num() == 1) {
        return Partial[0];
    }
    for (const TSubclassOf<UFGItemDescriptor>& Cls : Partial) {
        OutCandidates.Add(UFGItemDescriptor::GetItemName(*Cls).ToString());
    }
    return nullptr;
}

EExecutionStatus AGiveItemCommand::ExecuteCommand_Implementation(
    UCommandSender* Sender, const TArray<FString>& Arguments, const FString& Label)
{
    AFGPlayerController* Controller = Sender->GetPlayer();
    AFGCharacterPlayer* Character =
        Controller ? Cast<AFGCharacterPlayer>(Controller->GetCharacter()) : nullptr;
    if (!Character || !Character->GetInventory()) {
        Sender->SendChatMessage(TEXT("플레이어 캐릭터를 찾을 수 없습니다."), FLinearColor::Red);
        return EExecutionStatus::UNCOMPLETED;
    }

    // 마지막 인자가 숫자면 수량, 나머지를 아이템 이름으로 합침 (공백 포함 이름 지원)
    TArray<FString> NameParts = Arguments;
    int32 Amount = 0;
    if (NameParts.Num() > 1 && NameParts.Last().IsNumeric()) {
        Amount = FCString::Atoi(*NameParts.Last());
        NameParts.Pop();
    }
    const FString Query = FString::Join(NameParts, TEXT(" "));

    TArray<FString> Candidates;
    const TSubclassOf<UFGItemDescriptor> ItemClass = ResolveItem(Query, Candidates);
    if (!ItemClass) {
        if (Candidates.Num() > 0) {
            const int32 Shown = FMath::Min(Candidates.Num(), 8);
            Sender->SendChatMessage(FString::Printf(
                TEXT("'%s' 후보가 %d개입니다: %s"), *Query, Candidates.Num(),
                *FString::Join(TArray<FString>(Candidates.GetData(), Shown), TEXT(", "))),
                FLinearColor::Yellow);
        } else {
            Sender->SendChatMessage(FString::Printf(
                TEXT("'%s' 아이템을 찾을 수 없습니다."), *Query), FLinearColor::Red);
        }
        return EExecutionStatus::BAD_ARGUMENTS;
    }

    const int32 StackSize = FMath::Max(1, UFGItemDescriptor::GetStackSize(ItemClass));
    if (Amount <= 0) {
        Amount = StackSize; // 수량 생략 시 한 스택
    }
    Amount = FMath::Clamp(Amount, 1, 100000);

    // 스택 단위로 나눠 넣고, 실제 들어간 수량을 집계
    UFGInventoryComponent* Inventory = Character->GetInventory();
    int32 Added = 0;
    int32 Remaining = Amount;
    while (Remaining > 0) {
        const int32 Chunk = FMath::Min(Remaining, StackSize);
        const int32 AddedNow = Inventory->AddStack(FInventoryStack(Chunk, ItemClass), true);
        Added += AddedNow;
        Remaining -= Chunk;
        if (AddedNow < Chunk) {
            break; // 인벤토리 가득 참
        }
    }

    const FString ItemName = UFGItemDescriptor::GetItemName(ItemClass).ToString();
    if (Added == 0) {
        Sender->SendChatMessage(TEXT("인벤토리가 가득 찼습니다."), FLinearColor::Red);
        return EExecutionStatus::UNCOMPLETED;
    }
    if (Added < Amount) {
        Sender->SendChatMessage(FString::Printf(
            TEXT("%s × %d 지급 (요청 %d, 인벤토리 부족)"), *ItemName, Added, Amount),
            FLinearColor::Yellow);
    } else {
        Sender->SendChatMessage(FString::Printf(
            TEXT("%s × %d 지급 완료"), *ItemName, Added));
    }
    return EExecutionStatus::COMPLETED;
}
