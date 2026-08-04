using UnrealBuildTool;

public class ItemSpawner : ModuleRules
{
    public ItemSpawner(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new string[] {
            "Core",
            "CoreUObject",
            "Engine",
            "FactoryGame",
            "SML",
        });
    }
}
