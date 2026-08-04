#pragma once
#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"

class FItemSpawnerModule : public FDefaultGameModuleImpl
{
public:
    virtual bool IsGameModule() const override { return true; }
};
